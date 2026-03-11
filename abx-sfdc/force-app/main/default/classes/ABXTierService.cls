/**
 * ABXTierService — Tiering logic for ABX account evaluation.
 *
 * Ported from src/tieringLogic.js. Evaluates each Account against the
 * fit-score × intent matrix and returns an action recommendation:
 * Add, Remove, Reclassify, No Change, or Ignore.
 *
 * Designed as a stateless utility so it can be called from:
 *  - LWC controller (ABXTierReviewController)
 *  - Future REST endpoints
 *  - Batch Apex
 */
public class ABXTierService {

    private static final Set<String> EXCLUDE_STAGES = new Set<String>{
        'Customer', 'Pipeline', 'Churned Customer', 'Competitor',
        'Parent is Customer', 'Parent in Pipeline'
    };

    private static final Date CLOSED_LOST_CUTOFF = Date.newInstance(2025, 8, 1);

    // ─── Inner class for evaluation result ──────────────────────────────────────

    public class TierEvaluation {
        @AuraEnabled public String action;           // Add, Remove, Reclassify, No Change, Ignore
        @AuraEnabled public String currentTier;      // Tier 1, Tier 2, Tier 3, or null
        @AuraEnabled public String recommendedTier;  // Tier 1, Tier 2, Tier 3, or null
        @AuraEnabled public String reason;
        @AuraEnabled public String intentLevel;      // High, Medium, Low
    }

    private class MatrixResult {
        public Integer tier;  // 1, 2, 3, or null
        public String reason;
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    /**
     * Evaluate a list of Accounts in bulk.
     */
    public static List<TierEvaluation> processAccounts(List<Account> accounts) {
        List<TierEvaluation> results = new List<TierEvaluation>();
        for (Account acct : accounts) {
            results.add(evaluateAccount(acct));
        }
        return results;
    }

    /**
     * Evaluate a single Account and return the tier recommendation.
     */
    public static TierEvaluation evaluateAccount(Account acct) {
        String currentTier = acct.ABX_Tier__c;
        String stage = acct.Account_Stage__c != null ? acct.Account_Stage__c : '';
        Date closedLostDate = acct.Entered_Closed_Lost_Date__c;
        Boolean isClosedLost = (stage == 'Closed Lost');

        // Step 1: Check universal exclusions
        List<String> exclusionReasons = shouldExclude(acct);
        if (!exclusionReasons.isEmpty()) {
            String reason = 'Excluded from tiering: ' + String.join(exclusionReasons, '; ');
            TierEvaluation eval = new TierEvaluation();
            eval.intentLevel = classifyIntent(acct.Account_Intent__c);
            if (currentTier != null) {
                eval.action = 'Remove';
                eval.currentTier = currentTier;
                eval.recommendedTier = null;
                eval.reason = reason + '. Current tier ' + currentTier + ' should be removed.';
            } else {
                eval.action = 'Ignore';
                eval.currentTier = null;
                eval.recommendedTier = null;
                eval.reason = reason;
            }
            return eval;
        }

        // Step 2: Closed Lost routing
        if (isClosedLost) {
            Boolean isRecentClosedLost = (closedLostDate != null && closedLostDate >= CLOSED_LOST_CUTOFF);

            if (currentTier != null && isRecentClosedLost) {
                TierEvaluation eval = new TierEvaluation();
                eval.action = 'Remove';
                eval.currentTier = currentTier;
                eval.recommendedTier = null;
                eval.intentLevel = classifyIntent(acct.Account_Intent__c);
                eval.reason = 'Account is Closed Lost as of ' + String.valueOf(closedLostDate)
                    + ' (on or after Aug 1, 2025). Recently closed lost accounts with an existing tier ('
                    + currentTier + ') should be removed from ABX targeting.';
                return eval;
            }

            if (currentTier == null && isRecentClosedLost) {
                TierEvaluation eval = new TierEvaluation();
                eval.action = 'Ignore';
                eval.currentTier = null;
                eval.recommendedTier = null;
                eval.intentLevel = classifyIntent(acct.Account_Intent__c);
                eval.reason = 'Account is Closed Lost as of ' + String.valueOf(closedLostDate)
                    + ' (on or after Aug 1, 2025). Too recent to re-target — no tier assigned.';
                return eval;
            }
            // Closed lost before cutoff or no date → fall through to matrix
        }

        // Step 3: Run tiering matrix
        MatrixResult matrix = calcTierFromMatrix(acct);
        String recommendedTier = (matrix.tier != null) ? 'Tier ' + matrix.tier : null;

        // Closed lost re-target prefix
        String closedLostPrefix = '';
        if (isClosedLost && closedLostDate != null && closedLostDate < CLOSED_LOST_CUTOFF) {
            closedLostPrefix = 'Account has been Closed Lost since ' + String.valueOf(closedLostDate)
                + ' (before Aug 1, 2025) — eligible for re-targeting. ';
        }

        // Step 4: Determine action
        TierEvaluation eval = new TierEvaluation();
        eval.currentTier = currentTier;
        eval.recommendedTier = recommendedTier;
        eval.intentLevel = classifyIntent(acct.Account_Intent__c);

        if (recommendedTier == null) {
            if (currentTier != null) {
                eval.action = 'Remove';
                eval.reason = closedLostPrefix + matrix.reason + '. Current tier (' + currentTier + ') should be removed.';
            } else {
                eval.action = 'Ignore';
                eval.reason = closedLostPrefix + matrix.reason;
            }
        } else if (currentTier == null) {
            eval.action = 'Add';
            eval.reason = closedLostPrefix + 'No current tier. ' + matrix.reason;
        } else if (currentTier == recommendedTier) {
            eval.action = 'No Change';
            eval.reason = closedLostPrefix + 'Current tier (' + currentTier + ') matches recommended tier. ' + matrix.reason;
        } else {
            eval.action = 'Reclassify';
            eval.reason = closedLostPrefix + 'Current tier is ' + currentTier + ' but recommendation is '
                + recommendedTier + '. ' + matrix.reason;
        }

        return eval;
    }

    /**
     * Classify intent string into High / Medium / Low.
     */
    public static String classifyIntent(String intent) {
        if (intent == null || intent == 'None' || intent == '') return 'Low';
        String lower = intent.toLowerCase();
        if (lower.contains('high') || lower == 'very high') return 'High';
        if (lower.contains('medium') || lower.contains('moderate')) return 'Medium';
        if (lower.contains('low')) return 'Low';
        // Non-empty, non-None values with no level keyword → treat as Medium
        return 'Medium';
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    /**
     * Returns a list of exclusion reasons. Empty list means the account is eligible.
     */
    private static List<String> shouldExclude(Account acct) {
        List<String> reasons = new List<String>();

        if (acct.ParentId != null) {
            reasons.add('Has a parent account (ParentId: ' + acct.ParentId + ')');
        }
        if (acct.Company_isDefunct__c != null && acct.Company_isDefunct__c.equalsIgnoreCase('true')) {
            reasons.add('Company is marked as defunct');
        }
        if (hasValue(acct.Qualified_Out_Detail__c) || hasValue(acct.Qualified_Out_Date__c) || hasValue(acct.Qualified_Out_Reason__c)) {
            List<String> parts = new List<String>();
            if (hasValue(acct.Qualified_Out_Detail__c))  parts.add('detail: ' + acct.Qualified_Out_Detail__c);
            if (hasValue(acct.Qualified_Out_Date__c))    parts.add('date: ' + acct.Qualified_Out_Date__c);
            if (hasValue(acct.Qualified_Out_Reason__c))  parts.add('reason: ' + acct.Qualified_Out_Reason__c);
            reasons.add('Qualified out (' + String.join(parts, ', ') + ')');
        }
        if (acct.Consulting_IT_Filter_Flow__c == true) {
            reasons.add('Consulting/IT filter flow is active');
        }
        if (acct.Account_Stage__c != null && EXCLUDE_STAGES.contains(acct.Account_Stage__c)) {
            reasons.add('Account stage "' + acct.Account_Stage__c + '" is excluded from tiering');
        }
        if (acct.Sales_Segment__c == 'Commercial') {
            reasons.add('Sales segment is Commercial (excluded from ABX targeting)');
        }

        return reasons;
    }

    /**
     * Determine the recommended tier based on Fit Score, Intent, and DNN status.
     */
    private static MatrixResult calcTierFromMatrix(Account acct) {
        Double fit = (acct.Fit_Score_Total__c != null) ? acct.Fit_Score_Total__c : -1;
        Boolean isDnn = (acct.Marketplace_Prospect__c == true);
        String intentLevel = classifyIntent(acct.Account_Intent__c);

        MatrixResult result = new MatrixResult();

        // Below minimum threshold
        if (fit < 5) {
            if (isDnn) {
                result.tier = 2;
                result.reason = 'DNN/Marketplace Prospect with fit score '
                    + (fit < 0 ? '(missing)' : String.valueOf(fit))
                    + ' (below threshold) → Tier 2 (DNN minimum)';
                return result;
            }
            result.tier = null;
            result.reason = 'Fit score '
                + (fit < 0 ? '(missing)' : String.valueOf(fit))
                + ' is below minimum threshold of 5 → Ignore';
            return result;
        }

        Integer tier = null;
        String matrixReason = '';

        if (fit >= 11) {
            if (intentLevel == 'High') {
                tier = 1;
                matrixReason = 'Fit score ' + fit + ' (11-12 range) + High intent → Tier 1';
            } else if (intentLevel == 'Medium') {
                tier = 2;
                matrixReason = 'Fit score ' + fit + ' (11-12 range) + Medium intent → Tier 2';
            } else {
                tier = 3;
                matrixReason = 'Fit score ' + fit + ' (11-12 range) + Low/No intent → Tier 3';
            }
        } else if (fit >= 9) {
            if (intentLevel == 'High') {
                tier = 2;
                matrixReason = 'Fit score ' + fit + ' (9-10 range) + High intent → Tier 2';
            } else if (intentLevel == 'Medium') {
                tier = 3;
                matrixReason = 'Fit score ' + fit + ' (9-10 range) + Medium intent → Tier 3';
            } else {
                if (isDnn) {
                    result.tier = 2;
                    result.reason = 'DNN/Marketplace Prospect: fit score ' + fit + ' (9-10 range) + Low intent → Tier 2 (DNN minimum)';
                    return result;
                }
                result.tier = null;
                result.reason = 'Fit score ' + fit + ' (9-10 range) + Low intent → Ignore';
                return result;
            }
        } else { // fit >= 5 (guaranteed by earlier check)
            if (intentLevel == 'High') {
                tier = 3;
                matrixReason = 'Fit score ' + fit + ' (5-8 range) + High intent → Tier 3';
            } else {
                if (isDnn) {
                    result.tier = 2;
                    result.reason = 'DNN/Marketplace Prospect: fit score ' + fit + ' (5-8 range) + ' + intentLevel + ' intent → Tier 2 (DNN minimum)';
                    return result;
                }
                result.tier = null;
                result.reason = 'Fit score ' + fit + ' (5-8 range) + ' + intentLevel + ' intent → Ignore';
                return result;
            }
        }

        // DNN override: minimum Tier 2
        if (isDnn && tier != null && tier > 2) {
            matrixReason += '. Upgraded to Tier 2 (minimum) because account is a DNN/Marketplace Prospect';
            tier = 2;
        }

        result.tier = tier;
        result.reason = matrixReason;
        return result;
    }

    private static Boolean hasValue(String val) {
        return val != null && val.trim().length() > 0;
    }

    // Overload for Date field used in Qualified_Out_Date__c (which may be Date or String in different orgs)
    private static Boolean hasValue(Date val) {
        return val != null;
    }
}
