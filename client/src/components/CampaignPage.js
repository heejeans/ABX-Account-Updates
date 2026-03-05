import React, { useState, useMemo, useCallback } from 'react';
import FieldFilters from './FieldFilters';
import './CampaignPage.css';

const CAMPAIGN_ID   = '701VN00000VpEWvYAN';
const CAMPAIGN_NAME = '2025_09_ABX_Accounts';
const SF_BASE_URL   = 'https://cloudzero.lightning.force.com';
const SF_ACCT_BASE  = 'https://cloudzero.lightning.force.com/lightning/r/Account';

// ─── Apex code strings ────────────────────────────────────────────────────────
const APEX_TRIGGER = `/**
 * ABXCampaignSync — Apex Trigger
 * Fires after Account updates to automatically manage Campaign membership
 * when ABX_Tier__c is assigned, changed, or cleared.
 *
 * Campaign: ${CAMPAIGN_NAME} (${CAMPAIGN_ID})
 */
trigger ABXCampaignSync on Account (after update) {
    ABXCampaignSyncController.handleTierChanges(
        Trigger.new,
        Trigger.oldMap
    );
}`;

const APEX_CLASS = `/**
 * ABXCampaignSyncController
 *
 * Handles two integration paths:
 *   1. Apex Trigger  — auto-syncs on ABX_Tier__c field change
 *   2. REST Endpoint — called by the ABX Review App when user clicks
 *                      "Sync to SFDC" to bulk-apply approved changes
 *
 * REST endpoint:
 *   POST /services/apexrest/abx/campaign-sync
 *   Body: { "changes": [ { "accountId": "...", "action": "Add|Remove", "tier": "Tier 1|2|3|null" } ] }
 */
public class ABXCampaignSyncController {

    public static final Id ABX_CAMPAIGN_ID = '${CAMPAIGN_ID}';

    // ── Trigger entry point ──────────────────────────────────────────────────

    public static void handleTierChanges(
        List<Account>    newAccounts,
        Map<Id, Account> oldMap
    ) {
        List<CampaignMember> toAdd    = new List<CampaignMember>();
        Set<Id>              toRemove = new Set<Id>();

        for (Account acc : newAccounts) {
            Account old = oldMap.get(acc.Id);
            Boolean hadTier = old.ABX_Tier__c != null;
            Boolean hasTier = acc.ABX_Tier__c != null;

            if (!hadTier && hasTier) {
                // Tier assigned — add to ABX campaign
                toAdd.add(new CampaignMember(
                    CampaignId      = ABX_CAMPAIGN_ID,
                    LeadOrContactId = acc.Id,
                    Status          = 'Outreach in Progress'
                ));
            } else if (hadTier && !hasTier) {
                // Tier cleared — remove from ABX campaign
                toRemove.add(acc.Id);
            }
            // Tier reclassified: no campaign change needed (tier field already updated)
        }

        if (!toAdd.isEmpty())    insert toAdd;
        if (!toRemove.isEmpty()) removeMembersForAccounts(toRemove);
    }

    // ── REST endpoint (called by ABX Review App) ─────────────────────────────

    @RestResource(urlMapping='/abx/campaign-sync/*')
    global class ABXSyncEndpoint {
        @HttpPost
        global static SyncResult doPost() {
            SyncPayload body = (SyncPayload) JSON.deserialize(
                RestContext.request.requestBody.toString(),
                SyncPayload.class
            );
            return applyChanges(body.changes);
        }
    }

    // ── Core sync logic ──────────────────────────────────────────────────────

    public static SyncResult applyChanges(List<SyncChange> changes) {
        List<CampaignMember> toAdd    = new List<CampaignMember>();
        Set<Id>              toRemove = new Set<Id>();

        for (SyncChange c : changes) {
            Id accountId = (Id) c.accountId;

            if (c.action == 'Add') {
                toAdd.add(new CampaignMember(
                    CampaignId      = ABX_CAMPAIGN_ID,
                    LeadOrContactId = accountId,
                    Status          = 'Outreach in Progress'
                ));
            } else if (c.action == 'Remove') {
                toRemove.add(accountId);
            }
        }

        if (!toAdd.isEmpty())    insert toAdd;
        if (!toRemove.isEmpty()) removeMembersForAccounts(toRemove);

        return new SyncResult(toAdd.size(), toRemove.size(), 0);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static void removeMembersForAccounts(Set<Id> accountIds) {
        List<CampaignMember> members = [
            SELECT Id FROM CampaignMember
            WHERE CampaignId       = :ABX_CAMPAIGN_ID
            AND   LeadOrContactId IN :accountIds
        ];
        if (!members.isEmpty()) delete members;
    }

    // ── DTOs ─────────────────────────────────────────────────────────────────

    public class SyncPayload {
        public List<SyncChange> changes;
    }

    public class SyncChange {
        public String accountId;
        public String action;   // 'Add' | 'Remove'
        public String tier;     // 'Tier 1' | 'Tier 2' | 'Tier 3' | null
    }

    public class SyncResult {
        public Integer added;
        public Integer removed;
        public Integer updated;
        public SyncResult(Integer a, Integer r, Integer u) {
            this.added = a; this.removed = r; this.updated = u;
        }
    }
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Field-based: account should be in campaign iff ABX_Tier__c is currently set
function isInFinalABX(account) {
  return !!account.currentTier;
}

function TierBadge({ tier }) {
  if (!tier) return <span className="badge badge-none">No Tier</span>;
  const num = tier.replace('Tier ', '');
  return <span className={`badge badge-tier${num}`}>{tier}</span>;
}

function FitScore({ value }) {
  const num = parseFloat(value);
  if (isNaN(num)) return <span className="fit-none">—</span>;
  const cls = num >= 11 ? 'fit-high' : num >= 9 ? 'fit-medium' : num >= 5 ? 'fit-low' : 'fit-none';
  return <span className={cls}>{num}</span>;
}

// ─── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ row }) {
  const [expanded, setExpanded] = useState(false);

  const cardClass = row.syncStatus === 'needs-add'
    ? 'account-card account-card--cp-add'
    : row.syncStatus === 'needs-remove'
      ? 'account-card account-card--cp-remove'
      : 'account-card account-card--cp-synced';

  return (
    <div className={cardClass}>
      <div className="account-card__main">
        {/* Left: name + sync badge + meta */}
        <div className="account-card__info">
          <div className="account-card__name-row">
            <a
              href={`${SF_ACCT_BASE}/${row.Id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="account-card__name"
            >
              {row.Name || '(unnamed)'}
            </a>
            {row.syncStatus === 'synced' && (
              <span className="cp-status cp-status--synced">✓ Synced</span>
            )}
            {row.syncStatus === 'needs-add' && (
              <span className="cp-status cp-status--add">➕ Will Add to Campaign</span>
            )}
            {row.syncStatus === 'needs-remove' && (
              <span className="cp-status cp-status--remove">🗑 Will Remove from Campaign</span>
            )}
          </div>
          <div className="account-card__meta">
            <span className="meta-item">
              <span className="meta-label">Segment:</span>{' '}
              {row.Sales_Segment__c || '—'}
            </span>
            <span className="meta-sep">·</span>
            <span className="meta-item">
              <span className="meta-label">Fit:</span>{' '}
              <FitScore value={row.Fit_Score_Total__c} />
            </span>
            <span className="meta-sep">·</span>
            <span className="meta-item">
              <span className="meta-label">Intent:</span>{' '}
              {row.Account_Intent__c || '—'}
            </span>
            <span className="meta-sep">·</span>
            <span className="meta-item">
              <span className="meta-label">Stage:</span>{' '}
              {row.Account_Stage__c || '—'}
            </span>
          </div>
        </div>

        {/* Center: tier */}
        <div className="account-card__tier">
          <TierBadge tier={row.currentTier} />
          {row.recommendedTier && row.recommendedTier !== row.currentTier && (
            <>
              <span className="tier-arrow">→</span>
              <TierBadge tier={row.recommendedTier} />
            </>
          )}
        </div>

        {/* Right: in-campaign indicator + expand */}
        <div className="account-card__actions">
          <span className={`cp-in-badge${row.inCampaign ? ' cp-in-badge--yes' : ' cp-in-badge--no'}`}>
            {row.inCampaign ? '✓ In Campaign' : '— Not in Campaign'}
          </span>
          <button
            className="expand-btn"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? 'Collapse' : 'Expand details'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="account-card__expanded">
          <div className="expanded__reason">
            <strong>Review recommendation:</strong> {row.reason || '—'}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CampaignPage({ accounts, campaignData, filter, onFilterChange }) {
  const [showApex,      setShowApex]      = useState(false);
  const [apexTab,       setApexTab]       = useState('trigger');
  const [copiedApex,    setCopiedApex]    = useState(false);
  const [syncResult,    setSyncResult]    = useState(null);
  const [isSyncing,     setIsSyncing]     = useState(false);
  const [syncError,     setSyncError]     = useState(null);
  const [search,        setSearch]        = useState('');
  const [fieldFilters,  setFieldFilters]  = useState({});

  const handleFieldFilterChange = useCallback((key, value) => {
    if (key === '__clear__') { setFieldFilters({}); return; }
    setFieldFilters((prev) => {
      const current = prev[key] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length === 0) { const { [key]: _r, ...rest } = prev; return rest; }
      return { ...prev, [key]: next };
    });
  }, []);

  // Build a Set of account IDs currently in the campaign
  const memberSet = useMemo(() => {
    if (!campaignData?.members) return new Set();
    return new Set(campaignData.members.map((m) => m.accountId));
  }, [campaignData]);

  // Compute per-account sync status — purely field-based (ABX_Tier__c = currentTier)
  const rows = useMemo(() => {
    return accounts
      .filter((a) => a.action !== 'Ignore')
      .map((a) => {
        const inCampaign = memberSet.has(a.Id);
        const inFinalABX = isInFinalABX(a);
        let syncStatus;
        if      ( inCampaign &&  inFinalABX) syncStatus = 'synced';
        else if (!inCampaign &&  inFinalABX) syncStatus = 'needs-add';
        else if ( inCampaign && !inFinalABX) syncStatus = 'needs-remove';
        else return null; // no tier, not in campaign — skip
        return { ...a, inCampaign, inFinalABX, syncStatus };
      })
      .filter(Boolean);
  }, [accounts, memberSet]);

  const pendingChanges = useMemo(
    () => rows.filter((r) => r.syncStatus !== 'synced'),
    [rows]
  );

  // Field options for the FieldFilters dropdown
  const fieldOptions = useMemo(() => {
    const INTENT_ORDER = ['High', 'Medium', 'Low', 'None'];
    const FIT_ORDER    = ['9+ (High)', '5–8 (Med)', '< 5 (Low)', 'No Score'];
    const intents = new Set(), stages = new Set(), segments = new Set(),
          currentTiers = new Set(), fitRanges = new Set(), dnns = new Set();
    rows.forEach((a) => {
      intents.add(a.Account_Intent__c || 'None');
      if (a.Account_Stage__c) stages.add(a.Account_Stage__c);
      if (a.Sales_Segment__c) segments.add(a.Sales_Segment__c);
      currentTiers.add(a.currentTier || 'No Tier');
      const fit = parseFloat(a.Fit_Score_Total__c);
      if (isNaN(fit))       fitRanges.add('No Score');
      else if (fit < 5)     fitRanges.add('< 5 (Low)');
      else if (fit <= 8)    fitRanges.add('5–8 (Med)');
      else                  fitRanges.add('9+ (High)');
      dnns.add(a.Marketplace_Prospect__c ? 'DNN' : 'Non-DNN');
    });
    const tierSort = (a, b) => a === 'No Tier' ? 1 : b === 'No Tier' ? -1 : a.localeCompare(b);
    return {
      intent:      INTENT_ORDER.filter(v => intents.has(v)).map(v => ({ value: v, label: v })),
      stage:       [...stages].sort().map(v => ({ value: v, label: v })),
      segment:     [...segments].sort().map(v => ({ value: v, label: v })),
      currentTier: [...currentTiers].sort(tierSort).map(v => ({ value: v, label: v })),
      fitRange:    FIT_ORDER.filter(v => fitRanges.has(v)).map(v => ({ value: v, label: v })),
      isDnn:       [...dnns].sort().map(v => ({ value: v, label: v })),
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    // Status filter (from header card clicks)
    let base;
    if (!filter || filter === 'all')   base = rows;
    else if (filter === 'in-campaign') base = rows.filter((r) => r.inCampaign);
    else                               base = rows.filter((r) => r.syncStatus === filter);

    // Field filters
    const { intent, stage, segment, fitRange, currentTier, isDnn } = fieldFilters;
    base = base.filter((a) => {
      if (intent?.length      && !intent.includes(a.Account_Intent__c || 'None'))         return false;
      if (stage?.length       && !stage.includes(a.Account_Stage__c || ''))               return false;
      if (segment?.length     && !segment.includes(a.Sales_Segment__c || ''))             return false;
      if (currentTier?.length && !currentTier.includes(a.currentTier || 'No Tier'))       return false;
      if (fitRange?.length) {
        const fit = parseFloat(a.Fit_Score_Total__c);
        const bucket = isNaN(fit) ? 'No Score' : fit < 5 ? '< 5 (Low)' : fit <= 8 ? '5–8 (Med)' : '9+ (High)';
        if (!fitRange.includes(bucket)) return false;
      }
      if (isDnn?.length && !isDnn.includes(a.Marketplace_Prospect__c ? 'DNN' : 'Non-DNN')) return false;
      return true;
    });

    // Search
    if (search) {
      const q = search.toLowerCase();
      base = base.filter((r) => r.Name?.toLowerCase().includes(q));
    }
    return base;
  }, [rows, filter, fieldFilters, search]);

  // Sync payload — field-based: Add = missing from campaign but has tier, Remove = in campaign but no tier
  const syncPayload = useMemo(() => ({
    changes: pendingChanges.map((r) => ({
      accountId: r.Id,
      action: r.syncStatus === 'needs-add' ? 'Add' : 'Remove',
      tier:   r.syncStatus === 'needs-add' ? r.currentTier : null,
    })),
  }), [pendingChanges]);

  async function handleSync() {
    if (pendingChanges.length === 0) return;
    setIsSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(syncPayload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Sync failed');
      setSyncResult({ ...data.result, timestamp: new Date().toLocaleString() });
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleCopyApex() {
    const code = apexTab === 'trigger' ? APEX_TRIGGER : APEX_CLASS;
    await navigator.clipboard.writeText(code);
    setCopiedApex(true);
    setTimeout(() => setCopiedApex(false), 2000);
  }

  return (
    <div className="campaign-page">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="cp-header">
        <div className="cp-header__left">
          <div className="cp-header__name">{CAMPAIGN_NAME}</div>
          <div className="cp-header__meta">
            <a
              href={`${SF_BASE_URL}/${CAMPAIGN_ID}`}
              target="_blank"
              rel="noreferrer"
              className="cp-header__sflink cp-header__id"
            >
              {CAMPAIGN_ID} ↗
            </a>
          </div>
        </div>
        <div className="cp-header__actions">
          <button
            className={`btn btn-outline cp-apex-toggle${showApex ? ' cp-apex-toggle--open' : ''}`}
            onClick={() => setShowApex((v) => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z"/></svg>
            Apex Code
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSync}
            disabled={pendingChanges.length === 0 || isSyncing}
          >
            {isSyncing ? '⏳ Syncing…' : `⚡ Sync to SFDC (${pendingChanges.length})`}
          </button>
        </div>
      </div>

      {/* ── Sync result banner ─────────────────────────────────────────────── */}
      {syncResult && (
        <div className="cp-banner cp-banner--success">
          <span className="cp-banner__icon">✓</span>
          <span>
            <strong>{syncResult.mock ? 'Mock sync complete' : 'Synced to Salesforce'}</strong>
            {' '}— {syncResult.added} added, {syncResult.removed} removed
            {syncResult.mock && <span className="cp-banner__mock-tag">MOCK</span>}
          </span>
          <span className="cp-banner__time">{syncResult.timestamp}</span>
          <button className="cp-banner__close" onClick={() => setSyncResult(null)}>×</button>
        </div>
      )}
      {syncError && (
        <div className="cp-banner cp-banner--error">
          <span className="cp-banner__icon">✕</span>
          <span><strong>Sync failed</strong> — {syncError}</span>
          <button className="cp-banner__close" onClick={() => setSyncError(null)}>×</button>
        </div>
      )}

      {/* ── Apex code panel ────────────────────────────────────────────────── */}
      {showApex && (
        <div className="cp-apex">
          <div className="cp-apex__topbar">
            <div className="cp-apex__filetabs">
              <button
                className={`cp-apex__filetab${apexTab === 'trigger' ? ' cp-apex__filetab--active' : ''}`}
                onClick={() => setApexTab('trigger')}
              >
                ABXCampaignSync.trigger
              </button>
              <button
                className={`cp-apex__filetab${apexTab === 'class' ? ' cp-apex__filetab--active' : ''}`}
                onClick={() => setApexTab('class')}
              >
                ABXCampaignSyncController.cls
              </button>
              <button
                className={`cp-apex__filetab${apexTab === 'payload' ? ' cp-apex__filetab--active' : ''}`}
                onClick={() => setApexTab('payload')}
              >
                REST Payload Preview
              </button>
            </div>
            <button className="btn btn-outline cp-apex__copy" onClick={handleCopyApex}>
              {copiedApex ? '✓ Copied' : '⎘ Copy'}
            </button>
          </div>
          <pre className="cp-apex__code">
            {apexTab === 'trigger'  && APEX_TRIGGER}
            {apexTab === 'class'    && APEX_CLASS}
            {apexTab === 'payload'  && JSON.stringify(syncPayload, null, 2)}
          </pre>
          <div className="cp-apex__footer">
            <span className="cp-apex__badge">⚠ Mock only</span>
            Deploy <code>ABXCampaignSync.trigger</code> and{' '}
            <code>ABXCampaignSyncController.cls</code> to your Salesforce org.
            The app will call <code>POST /services/apexrest/abx/campaign-sync</code>
            {' '}with the payload above when you click <strong>Sync to SFDC</strong>.
          </div>
        </div>
      )}

      {/* ── List toolbar (matches Review page style) ───────────────────────── */}
      <div className="list-toolbar">
        <div className="record-count">
          Showing {filteredRows.length} accounts
          {search && ` matching "${search}"`}
        </div>
        <div className="list-toolbar__right">
          <div className="toolbar-search">
            <input
              type="text"
              placeholder="Search by account name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="toolbar-search__input"
            />
            {search && (
              <button className="toolbar-search__clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>
          <FieldFilters
            fieldOptions={fieldOptions}
            filters={fieldFilters}
            onFilterChange={handleFieldFilterChange}
          />
        </div>
      </div>

      {/* ── Campaign cards ─────────────────────────────────────────────────── */}
      <div className="account-list">
        {filteredRows.map((row) => (
          <CampaignCard key={row.Id} row={row} />
        ))}
        {filteredRows.length === 0 && (
          <div className="account-list__empty">No accounts match the current filters.</div>
        )}
      </div>
    </div>
  );
}
