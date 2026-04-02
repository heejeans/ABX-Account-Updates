'use strict';

const EXCLUDE_STAGES = new Set([
  'Customer',
  'Pipeline',
  'Churned Customer',
  'Competitor',
  'Parent is Customer',
  'Parent in Pipeline',
]);

const CLOSED_LOST_CUTOFF = new Date('2025-08-01T00:00:00.000Z');

/**
 * Returns true if the account should be unconditionally excluded from tiering.
 */
function shouldExclude(account) {
  const reasons = [];

  if (account.ParentId) {
    reasons.push(`Has a parent account (ParentId: ${account.ParentId})`);
  }
  if (String(account.Company_isDefunct__c).toLowerCase() === 'true') {
    reasons.push('Company is marked as defunct');
  }
  if (
    (account.Qualified_Out_Detail__c && String(account.Qualified_Out_Detail__c).trim() !== '') ||
    (account.Qualified_Out_Date__c && String(account.Qualified_Out_Date__c).trim() !== '') ||
    (account.Qualified_Out_Reason__c && String(account.Qualified_Out_Reason__c).trim() !== '')
  ) {
    const detail = account.Qualified_Out_Detail__c ? `detail: ${account.Qualified_Out_Detail__c}` : null;
    const date = account.Qualified_Out_Date__c ? `date: ${account.Qualified_Out_Date__c}` : null;
    const reason = account.Qualified_Out_Reason__c ? `reason: ${account.Qualified_Out_Reason__c}` : null;
    reasons.push(`Qualified out (${[detail, date, reason].filter(Boolean).join(', ')})`);
  }
  if (account.Consulting_IT_Filter_Flow__c === true || account.Consulting_IT_Filter_Flow__c === 'true') {
    reasons.push('Consulting/IT filter flow is active');
  }
  if (account.Government_Education__c === true || account.Government_Education__c === 'true') {
    reasons.push('Government/Education filter is active');
  }
  if (account.Account_Stage__c && EXCLUDE_STAGES.has(account.Account_Stage__c)) {
    reasons.push(`Account stage "${account.Account_Stage__c}" is excluded from tiering`);
  }
  if (account.Sales_Segment__c === 'Commercial') {
    reasons.push('Sales segment is Commercial (excluded from ABX targeting)');
  }

  return reasons;
}

/**
 * Determine the recommended tier based on Fit Score, Intent, and Marketplace flag.
 * Returns { tier: number|null, reason: string }
 */
function calcTierFromMatrix(account) {
  const fit = parseFloat(account.Fit_Score_Total__c);
  const intent = account.Account_Intent__c || '';
  const isDnn = account.Marketplace_Prospect__c === true || account.Marketplace_Prospect__c === 'true';

  const intentLevel = classifyIntent(intent);
  let tier = null;
  let matrixReason = '';

  if (isNaN(fit) || fit < 5) {
    if (isDnn) {
      // DNN/Marketplace accounts bypass the fit threshold — assign Tier 2 minimum
      matrixReason = `DNN/Marketplace Prospect with fit score ${isNaN(fit) ? '(missing)' : fit} (below threshold) → Tier 2 (DNN minimum)`;
      return { tier: 2, reason: matrixReason };
    }
    matrixReason = `Fit score ${isNaN(fit) ? '(missing)' : fit} is below minimum threshold of 5 → Ignore`;
    return { tier: null, reason: matrixReason };
  }

  if (fit >= 11) {
    if (intentLevel === 'High') {
      tier = 1;
      matrixReason = `Fit score ${fit} (11-12 range) + High intent → Tier 1`;
    } else if (intentLevel === 'Medium') {
      tier = 2;
      matrixReason = `Fit score ${fit} (11-12 range) + Medium intent → Tier 2`;
    } else {
      tier = 3;
      matrixReason = `Fit score ${fit} (11-12 range) + Low/No intent → Tier 3`;
    }
  } else if (fit >= 9) {
    if (intentLevel === 'High') {
      tier = 2;
      matrixReason = `Fit score ${fit} (9-10 range) + High intent → Tier 2`;
    } else if (intentLevel === 'Medium') {
      tier = 3;
      matrixReason = `Fit score ${fit} (9-10 range) + Medium intent → Tier 3`;
    } else {
      if (isDnn) {
        matrixReason = `DNN/Marketplace Prospect: fit score ${fit} (9-10 range) + Low intent → Tier 2 (DNN minimum)`;
        return { tier: 2, reason: matrixReason };
      }
      matrixReason = `Fit score ${fit} (9-10 range) + Low intent → Ignore`;
      return { tier: null, reason: matrixReason };
    }
  } else if (fit >= 5) {
    if (intentLevel === 'High') {
      tier = 3;
      matrixReason = `Fit score ${fit} (5-8 range) + High intent → Tier 3`;
    } else {
      if (isDnn) {
        matrixReason = `DNN/Marketplace Prospect: fit score ${fit} (5-8 range) + ${intentLevel} intent → Tier 2 (DNN minimum)`;
        return { tier: 2, reason: matrixReason };
      }
      matrixReason = `Fit score ${fit} (5-8 range) + ${intentLevel} intent → Ignore`;
      return { tier: null, reason: matrixReason };
    }
  }

  // DNN / Marketplace override: minimum Tier 2 for High intent
  if (isDnn && tier !== null && tier > 2) {
    matrixReason += `. Upgraded to Tier 2 (minimum) because account is a DNN/Marketplace Prospect`;
    tier = 2;
  }

  return { tier, reason: matrixReason };
}

/**
 * Classify intent string into High / Medium / Low.
 */
function classifyIntent(intent) {
  if (!intent || intent === 'None' || intent === '') return 'Low';
  const lower = intent.toLowerCase();
  if (lower.includes('high') || lower === 'very high') return 'High';
  if (lower.includes('medium') || lower.includes('moderate')) return 'Medium';
  if (lower.includes('low')) return 'Low';
  // Non-empty, non-None values with no level word → treat as Medium
  return 'Medium';
}

/**
 * Parse a date string safely. Returns null if falsy.
 */
function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Determine tier recommendation for a single account.
 * Returns:
 * {
 *   action: 'Add' | 'Remove' | 'Reclassify' | 'No Change' | 'Ignore',
 *   currentTier: string|null,
 *   recommendedTier: string|null,
 *   reason: string,
 * }
 */
function evaluateAccount(account) {
  const currentTier = account.ABX_Tier__c || null;
  const stage = account.Account_Stage__c || '';
  const closedLostDate = parseDate(account.Entered_Closed_Lost_Date__c);
  const isClosedLost = stage === 'Closed Lost';

  // Step 1: Check universal exclusions
  const exclusionReasons = shouldExclude(account);
  if (exclusionReasons.length > 0) {
    const reason = `Excluded from tiering: ${exclusionReasons.join('; ')}`;
    if (currentTier) {
      return {
        action: 'Remove',
        currentTier,
        recommendedTier: null,
        reason: `${reason}. Current tier ${currentTier} should be removed.`,
      };
    }
    return {
      action: 'Ignore',
      currentTier: null,
      recommendedTier: null,
      reason,
    };
  }

  // Step 2: Closed Lost routing
  if (isClosedLost) {
    const isRecentClosedLost = closedLostDate && closedLostDate >= CLOSED_LOST_CUTOFF;

    if (currentTier && isRecentClosedLost) {
      // Has tier + recently closed lost → Remove
      return {
        action: 'Remove',
        currentTier,
        recommendedTier: null,
        reason: `Account is Closed Lost as of ${account.Entered_Closed_Lost_Date__c} (on or after Aug 1, 2025). Recently closed lost accounts with an existing tier (${currentTier}) should be removed from ABX targeting.`,
      };
    }

    if (!currentTier && isRecentClosedLost) {
      // No tier + recently closed lost → Ignore
      return {
        action: 'Ignore',
        currentTier: null,
        recommendedTier: null,
        reason: `Account is Closed Lost as of ${account.Entered_Closed_Lost_Date__c} (on or after Aug 1, 2025). Too recent to re-target — no tier assigned.`,
      };
    }

    // Closed lost before cutoff → evaluate framework (re-target candidate)
    // Fall through to tiering matrix below
    if (isRecentClosedLost === false || closedLostDate === null) {
      // continue to matrix
    }
  }

  // Step 3: Run tiering matrix
  const { tier: recommendedTierNum, reason: matrixReason } = calcTierFromMatrix(account);
  const recommendedTier = recommendedTierNum !== null ? `Tier ${recommendedTierNum}` : null;

  // Closed lost re-target prefix
  const closedLostPrefix =
    isClosedLost && closedLostDate && closedLostDate < CLOSED_LOST_CUTOFF
      ? `Account has been Closed Lost since ${account.Entered_Closed_Lost_Date__c} (before Aug 1, 2025) — eligible for re-targeting. `
      : '';

  // Step 4: Determine action
  if (recommendedTier === null) {
    if (currentTier) {
      return {
        action: 'Remove',
        currentTier,
        recommendedTier: null,
        reason: `${closedLostPrefix}${matrixReason}. Current tier (${currentTier}) should be removed.`,
      };
    }
    return {
      action: 'Ignore',
      currentTier: null,
      recommendedTier: null,
      reason: `${closedLostPrefix}${matrixReason}`,
    };
  }

  if (!currentTier) {
    return {
      action: 'Add',
      currentTier: null,
      recommendedTier,
      reason: `${closedLostPrefix}No current tier. ${matrixReason}`,
    };
  }

  if (currentTier === recommendedTier) {
    return {
      action: 'No Change',
      currentTier,
      recommendedTier,
      reason: `${closedLostPrefix}Current tier (${currentTier}) matches recommended tier. ${matrixReason}`,
    };
  }

  return {
    action: 'Reclassify',
    currentTier,
    recommendedTier,
    reason: `${closedLostPrefix}Current tier is ${currentTier} but recommendation is ${recommendedTier}. ${matrixReason}`,
  };
}

/**
 * Process all accounts and return enriched results.
 */
function processAccounts(accounts) {
  return accounts.map((account) => {
    const evaluation = evaluateAccount(account);
    return {
      ...account,
      ...evaluation,
      intentLevel: classifyIntent(account.Account_Intent__c),
    };
  });
}

module.exports = { processAccounts, evaluateAccount, classifyIntent };
