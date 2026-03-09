import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import FieldFilters from './FieldFilters';
import ClosedLostFilter, { matchesClosedLostFilter } from './ClosedLostFilter';
import './CampaignPage.css';

const SF_ACCT_BASE = 'https://cloudzero.lightning.force.com/lightning/r/Account';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Mirrors App.js — returns the tier an account will have after review decisions
function effectiveTier(account, approved, rejected) {
  if (approved.has(account.Id)) {
    if (account.action === 'Remove') return null;
    return account.recommendedTier || null;
  }
  return account.currentTier || null;
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

function CampaignCard({ row, isApproved, isRejected, isSelected, onApprove, onReject, onToggleSelect }) {
  const [expanded, setExpanded] = useState(false);
  const isActionable = row.syncStatus !== 'synced';

  const cardClass = [
    row.syncStatus === 'needs-add'    ? 'account-card account-card--cp-add'    :
    row.syncStatus === 'needs-remove' ? 'account-card account-card--cp-remove' :
                                        'account-card account-card--cp-synced',
    isRejected ? 'account-card--rejected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <div className="account-card__main">
        {isActionable && !isApproved && onToggleSelect && (
          <div className="account-card__checkbox">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(row.Id)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

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
            {isApproved ? (
              <span className="badge badge-nochange">No Change</span>
            ) : (
              <>
                {row.syncStatus === 'synced' && (
                  <span className="badge badge-nochange">No Change</span>
                )}
                {row.syncStatus === 'needs-add' && (
                  <span className="badge badge-add">Add</span>
                )}
                {row.syncStatus === 'needs-remove' && (
                  <span className="badge badge-remove">Remove</span>
                )}
              </>
            )}
            {isRejected && (
              <span className="badge badge-rejected-inline">✕ Rejected</span>
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

        <div className="account-card__tier">
          <TierBadge tier={row.effectiveTier} />
        </div>

        <div className="account-card__actions">
          {isActionable && !isApproved && (
            <div className="account-card__vote">
              <button
                className="btn-approve"
                onClick={() => onApprove(row.Id)}
              >
                ✓ Approve
              </button>
              <button
                className={`btn-reject${isRejected ? ' active' : ''}`}
                onClick={() => onReject(row.Id)}
              >
                ✕ Reject
              </button>
            </div>
          )}
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
            <strong>Campaign action:</strong>{' '}
            {row.syncStatus === 'needs-add' && (
              <>Add to campaign — this account has <strong>{row.effectiveTier}</strong> but is not yet a campaign member.</>
            )}
            {row.syncStatus === 'needs-remove' && (
              <>Remove from campaign — this account is a campaign member but has no current tier.</>
            )}
            {row.syncStatus === 'synced' && (
              <>No change needed — this account is already in the campaign with an active tier.</>
            )}
          </div>
          {row.reason && (
            <div className="expanded__reason expanded__reason--secondary">
              <strong>ABX review note:</strong> {row.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CampaignPage({
  accounts, campaignData, filter,
  approved = new Set(), rejected = new Set(),
  cpApproved = new Set(), cpRejected = new Set(),
  onCpApprove, onCpReject,
}) {
  const [search,          setSearch]          = useState('');
  const [fieldFilters,    setFieldFilters]    = useState({});
  const [closedLostRange, setClosedLostRange] = useState(null);
  const [cpSelected,      setCpSelected]      = useState(new Set());
  const selectAllRef = useRef(null);

  useEffect(() => { setCpSelected(new Set()); }, [filter]);

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

  const handleToggleSelect = useCallback((id) => {
    setCpSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const memberSet = useMemo(() => {
    if (!campaignData?.members) return new Set();
    return new Set(campaignData.members.map((m) => m.accountId));
  }, [campaignData]);

  const rows = useMemo(() => {
    return accounts
      .filter((a) => a.action !== 'Ignore')
      .map((a) => {
        const inCampaign = memberSet.has(a.Id);
        const tier       = effectiveTier(a, approved, rejected);
        const inFinalABX = !!tier;
        let syncStatus;
        if      ( inCampaign &&  inFinalABX) syncStatus = 'synced';
        else if (!inCampaign &&  inFinalABX) syncStatus = 'needs-add';
        else if ( inCampaign && !inFinalABX) syncStatus = 'needs-remove';
        else return null;
        return { ...a, inCampaign, inFinalABX, syncStatus, effectiveTier: tier };
      })
      .filter(Boolean);
  }, [accounts, memberSet, approved, rejected]);

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
      if (isNaN(fit))    fitRanges.add('No Score');
      else if (fit < 5)  fitRanges.add('< 5 (Low)');
      else if (fit <= 8) fitRanges.add('5–8 (Med)');
      else               fitRanges.add('9+ (High)');
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
    let base;
    if (!filter || filter === 'all')        base = rows.filter((r) => r.syncStatus !== 'synced');
    else if (filter === 'in-campaign') {
      // Exclude accounts whose removal was approved — they're effectively out of campaign
      base = rows.filter((r) => r.inCampaign && !(cpApproved.has(r.Id) && r.syncStatus === 'needs-remove'));
    }
    else {
      // Actionable tabs: exclude approved/rejected rows (queue behavior, mirrors Review tab)
      base = rows.filter((r) => r.syncStatus === filter && !cpApproved.has(r.Id) && !cpRejected.has(r.Id));
    }

    const { intent, stage, segment, fitRange, currentTier, isDnn } = fieldFilters;
    base = base.filter((a) => {
      if (intent?.length      && !intent.includes(a.Account_Intent__c || 'None'))   return false;
      if (stage?.length       && !stage.includes(a.Account_Stage__c || ''))         return false;
      if (segment?.length     && !segment.includes(a.Sales_Segment__c || ''))       return false;
      if (currentTier?.length && !currentTier.includes(a.currentTier || 'No Tier')) return false;
      if (fitRange?.length) {
        const fit = parseFloat(a.Fit_Score_Total__c);
        const bucket = isNaN(fit) ? 'No Score' : fit < 5 ? '< 5 (Low)' : fit <= 8 ? '5–8 (Med)' : '9+ (High)';
        if (!fitRange.includes(bucket)) return false;
      }
      if (isDnn?.length && !isDnn.includes(a.Marketplace_Prospect__c ? 'DNN' : 'Non-DNN')) return false;
      if (!matchesClosedLostFilter(a, closedLostRange)) return false;
      return true;
    });

    if (search) {
      const q = search.toLowerCase();
      base = base.filter((r) => r.Name?.toLowerCase().includes(q));
    }
    return base;
  }, [rows, filter, fieldFilters, closedLostRange, search, cpApproved, cpRejected]);

  const isActionableTab = ['needs-add', 'needs-remove'].includes(filter);

  const actionableVisible = useMemo(
    () => filteredRows.filter((r) => r.syncStatus !== 'synced'),
    [filteredRows]
  );

  const allSelected  = actionableVisible.length > 0 && actionableVisible.every((r) => cpSelected.has(r.Id));
  const someSelected = actionableVisible.some((r) => cpSelected.has(r.Id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  const handleSelectAll = useCallback(() => {
    if (allSelected) setCpSelected(new Set());
    else setCpSelected(new Set(actionableVisible.map((r) => r.Id)));
  }, [allSelected, actionableVisible]);

  const handleApproveSelected = useCallback(() => {
    cpSelected.forEach((id) => onCpApprove?.(id));
    setCpSelected(new Set());
  }, [cpSelected, onCpApprove]);

  const handleRejectSelected = useCallback(() => {
    cpSelected.forEach((id) => onCpReject?.(id));
    setCpSelected(new Set());
  }, [cpSelected, onCpReject]);


  return (
    <div className="campaign-page">

      {/* ── List toolbar ───────────────────────────────────────────────────── */}
      <div className="list-toolbar">
        <div className="list-toolbar__left">
          {isActionableTab && actionableVisible.length > 0 && (
            <label className="select-all-label">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="select-all-cb"
                checked={allSelected}
                onChange={handleSelectAll}
              />
            </label>
          )}
          <div className="record-count">
            Showing {filteredRows.length} accounts
            {search && ` matching "${search}"`}
          </div>
          {isActionableTab && actionableVisible.length > 0 && (
            <div className={`bulk-actions${someSelected ? ' bulk-actions--active' : ''}`}>
              <span className={`selected-count${allSelected ? ' selected-count--all' : ''}`}>
                {allSelected
                  ? `All ${actionableVisible.length} selected`
                  : `${actionableVisible.filter(r => cpSelected.has(r.Id)).length} selected`}
              </span>
              <button className="btn-approve" onClick={handleApproveSelected}>✓ Approve</button>
              <button className="btn-reject" onClick={handleRejectSelected}>✕ Reject</button>
            </div>
          )}
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
          <ClosedLostFilter
            value={closedLostRange}
            onChange={setClosedLostRange}
          />
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
          <CampaignCard
            key={row.Id}
            row={row}
            isApproved={cpApproved.has(row.Id)}
            isRejected={cpRejected.has(row.Id)}
            isSelected={cpSelected.has(row.Id)}
            onApprove={onCpApprove}
            onReject={onCpReject}
            onToggleSelect={isActionableTab ? handleToggleSelect : undefined}
          />
        ))}
        {filteredRows.length === 0 && (
          <div className="account-list__empty">No accounts match the current filters.</div>
        )}
      </div>
    </div>
  );
}
