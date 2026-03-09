import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from './components/Header';
import AccountList from './components/AccountList';
import FieldFilters from './components/FieldFilters';
import ClosedLostFilter, { matchesClosedLostFilter } from './components/ClosedLostFilter';
import FetchPanel from './components/FetchPanel';
import CampaignPage from './components/CampaignPage';
import './App.css';

// Compute the effective tier after a review decision is applied
function effectiveTier(account, approved, rejected) {
  if (approved.has(account.Id)) {
    if (account.action === 'Remove') return null;           // approved removal → loses tier
    return account.recommendedTier || null;                  // approved add/reclassify → gains tier
  }
  return account.currentTier || null;                        // rejected / pending → unchanged
}

// Derive a short rule-group label from an account's reason string
function getRuleGroup(account) {
  const r = account.reason || '';
  const action = account.action;
  if (action === 'Add' || action === 'Reclassify') {
    const tier = r.match(/→ (Tier \d)/)?.[1];
    const isRetarget = r.includes('eligible for re-targeting');
    if (!tier) return 'Other';
    return isRetarget ? `Re-target → ${tier}` : `New → ${tier}`;
  }
  if (action === 'Remove') {
    if (r.includes('Has a parent account')) return 'Has parent account';
    if (r.includes('Account stage') && r.includes('excluded')) {
      const stage = r.match(/Account stage "([^"]+)"/)?.[1];
      return stage ? `Excluded: ${stage}` : 'Excluded stage';
    }
    if (r.includes('Consulting/IT filter')) return 'Consulting/IT filter';
    if (r.includes('defunct')) return 'Company defunct';
    if (r.includes('Qualified out')) return 'Qualified out';
    return 'Below threshold';
  }
  return 'Other';
}

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [approved, setApproved] = useState(new Set());
  const [rejected, setRejected] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const selectAllRef = useRef(null);
  const [activeFilter, setActiveFilter] = useState('Current ABX');
  const [activeReasonFilter, setActiveReasonFilter] = useState(null);
  const [fieldFilters, setFieldFilters] = useState({});
  const [closedLostRange, setClosedLostRange] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ isFetching: false, hasData: false, accountCount: 0, fetchError: null });
  const [progressLines, setProgressLines] = useState([]);
  const [view, setView] = useState('review'); // 'review' | 'campaign'
  const [campaignData, setCampaignData] = useState(null);
  const [campaignFilter, setCampaignFilter] = useState('in-campaign');
  const [cpApproved, setCpApproved] = useState(new Set());
  const [cpRejected, setCpRejected] = useState(new Set());
  const eventSourceRef = useRef(null);
  const accountsLengthRef = useRef(0);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) return;
      const data = await res.json();
      accountsLengthRef.current = data.length;
      setAccounts(data);
      setApproved(new Set());
      setRejected(new Set());
      setCpApproved(new Set());
      setCpRejected(new Set());
      setClosedLostRange(null);
    } catch (_) {}
  }, []);

  const loadCampaignData = useCallback(async () => {
    try {
      const res = await fetch('/api/campaign');
      if (!res.ok) return;
      setCampaignData(await res.json());
    } catch (_) {}
  }, []);

  // Poll status every 3 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setStatus(data);
        setProgressLines(data.progressLines || []);
        if (data.hasData && accountsLengthRef.current === 0) loadAccounts();
      } catch (_) {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [loadAccounts]);

  // Load campaign data once on mount
  useEffect(() => { loadCampaignData(); }, [loadCampaignData]);

  const startFetch = useCallback(async () => {
    setProgressLines([]);
    setAccounts([]);
    setApproved(new Set());
    setRejected(new Set());
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource('/api/progress');
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const { message } = JSON.parse(e.data);
        setProgressLines((prev) => [...prev.slice(-199), message]);
      } catch (_) {}
    };
    await fetch('/api/fetch', { method: 'POST' });
    setStatus((s) => ({ ...s, isFetching: true }));
  }, []);

  useEffect(() => {
    if (!status.isFetching && status.hasData && accounts.length === 0) {
      loadAccounts();
      if (eventSourceRef.current) {
        setTimeout(() => { if (eventSourceRef.current) eventSourceRef.current.close(); }, 2000);
      }
    }
  }, [status.isFetching, status.hasData, accounts.length, loadAccounts]);

  const handleApprove = useCallback((id) => {
    setApproved((prev) => new Set([...prev, id]));
    setRejected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const handleReject = useCallback((id) => {
    setRejected((prev) => new Set([...prev, id]));
    setApproved((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const handleApproveAll = useCallback(() => {
    const actionable = accounts.filter((a) => a.action !== 'No Change' && a.action !== 'Ignore');
    setApproved(new Set(actionable.map((a) => a.Id)));
    setRejected(new Set());
  }, [accounts]);

  const handleApproveGroup = useCallback((groupAccounts) => {
    setApproved((prev) => new Set([...prev, ...groupAccounts.map((a) => a.Id)]));
    setRejected((prev) => { const n = new Set(prev); groupAccounts.forEach((a) => n.delete(a.Id)); return n; });
  }, []);

  const handleRejectGroup = useCallback((groupAccounts) => {
    setRejected((prev) => new Set([...prev, ...groupAccounts.map((a) => a.Id)]));
    setApproved((prev) => { const n = new Set(prev); groupAccounts.forEach((a) => n.delete(a.Id)); return n; });
  }, []);

  const handleReset = useCallback(() => {
    setApproved(new Set());
    setRejected(new Set());
    setClosedLostRange(null);
    setFieldFilters({});
  }, []);

  const handleCpApprove = useCallback((id) => {
    setCpApproved((prev) => new Set([...prev, id]));
    setCpRejected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const handleCpReject = useCallback((id) => {
    setCpRejected((prev) => new Set([...prev, id]));
    setCpApproved((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  // Summary stats — currentABX reflects approved decisions so it updates live
  const currentABX   = useMemo(
    () => accounts.filter((a) => !!effectiveTier(a, approved, rejected)).length,
    [accounts, approved, rejected]
  );
  const adds         = accounts.filter((a) => a.action === 'Add').length;
  const removes      = accounts.filter((a) => a.action === 'Remove').length;
  const reclassifies = accounts.filter((a) => a.action === 'Reclassify').length;
  const pendingAdds    = accounts.filter((a) => a.action === 'Add'    && !approved.has(a.Id) && !rejected.has(a.Id)).length;
  const pendingRemoves = accounts.filter((a) => a.action === 'Remove' && !approved.has(a.Id) && !rejected.has(a.Id)).length;
  const estimatedFinalABX = accounts.length > 0
    ? currentABX + pendingAdds - pendingRemoves : null;

  const pendingReclassifies = accounts.filter((a) => a.action === 'Reclassify' && !approved.has(a.Id) && !rejected.has(a.Id)).length;

  const summary = {
    currentABX, estimatedFinalABX,
    netChange: estimatedFinalABX !== null ? estimatedFinalABX - currentABX : 0,
    adds: pendingAdds, removes: pendingRemoves, reclassifies: pendingReclassifies,
    totalAdds: adds, totalRemoves: removes, totalReclassifies: reclassifies,
    approvedCount: approved.size,
  };

  const reasonGroups = useMemo(() => {
    const WITH_REASONS = ['Add', 'Remove', 'Reclassify'];
    if (!WITH_REASONS.includes(activeFilter)) return [];
    const counts = {};
    accounts
      .filter((a) => a.action === activeFilter && !approved.has(a.Id) && !rejected.has(a.Id))
      .forEach((a) => {
        const g = getRuleGroup(a);
        counts[g] = (counts[g] || 0) + 1;
      });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  }, [accounts, activeFilter, approved, rejected]);

  // Clear selection when active filter changes
  useEffect(() => { setSelected(new Set()); }, [activeFilter]);

  const handleToggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const handleApproveSelected = useCallback(() => {
    setApproved((prev) => new Set([...prev, ...selected]));
    setRejected((prev) => { const n = new Set(prev); selected.forEach((id) => n.delete(id)); return n; });
    setSelected(new Set());
  }, [selected]);

  const handleRejectSelected = useCallback(() => {
    setRejected((prev) => new Set([...prev, ...selected]));
    setApproved((prev) => { const n = new Set(prev); selected.forEach((id) => n.delete(id)); return n; });
    setSelected(new Set());
  }, [selected]);

  const handleFilterChange = useCallback((filter) => {
    setActiveFilter(filter);
    setActiveReasonFilter(null);
    setFieldFilters({});
  }, []);

  const handleFieldFilterChange = useCallback((key, value) => {
    if (key === '__clear__') { setFieldFilters({}); return; }
    setFieldFilters((prev) => {
      const current = prev[key] || [];
      let next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (next.length === 0) { const { [key]: _r, ...rest } = prev; return rest; }
      return { ...prev, [key]: next };
    });
  }, []);

  const baseAccounts = useMemo(() => accounts.filter((a) => {
    if (search && !a.Name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeFilter === 'Current ABX') return !!effectiveTier(a, approved, rejected);
    if (activeFilter === 'Final ABX') {
      return (
        a.action === 'No Change' || a.action === 'Reclassify' ||
        (a.action === 'Remove' && rejected.has(a.Id)) ||
        (a.action === 'Add' && !rejected.has(a.Id))
      );
    }
    // For actionable filters, only show pending (not yet approved or rejected)
    if (['Add', 'Remove', 'Reclassify'].includes(activeFilter)) {
      if (a.action !== activeFilter) return false;
      if (approved.has(a.Id) || rejected.has(a.Id)) return false;
      if (activeReasonFilter && getRuleGroup(a) !== activeReasonFilter) return false;
      return true;
    }
    if (activeFilter !== 'All' && a.action !== activeFilter) return false;
    if (activeReasonFilter && getRuleGroup(a) !== activeReasonFilter) return false;
    return true;
  }), [accounts, search, activeFilter, activeReasonFilter, approved, rejected]);

  const fieldOptions = useMemo(() => {
    const INTENT_ORDER = ['High', 'Medium', 'Low', 'None'];
    const FIT_ORDER    = ['9+ (High)', '5–8 (Med)', '< 5 (Low)', 'No Score'];
    const intents = new Set(), stages = new Set(), segments = new Set(),
          currentTiers = new Set(), recTiers = new Set(),
          fitRanges = new Set(), dnns = new Set();
    baseAccounts.forEach((a) => {
      intents.add(a.Account_Intent__c || 'None');
      if (a.Account_Stage__c)  stages.add(a.Account_Stage__c);
      if (a.Sales_Segment__c)  segments.add(a.Sales_Segment__c);
      currentTiers.add(a.currentTier     || 'No Tier');
      recTiers.add(a.recommendedTier     || 'No Tier');
      const fit = parseFloat(a.Fit_Score_Total__c);
      if (isNaN(fit))  fitRanges.add('No Score');
      else if (fit < 5)  fitRanges.add('< 5 (Low)');
      else if (fit <= 8) fitRanges.add('5–8 (Med)');
      else               fitRanges.add('9+ (High)');
      dnns.add(a.Marketplace_Prospect__c ? 'DNN' : 'Non-DNN');
    });
    const tierSort = (a, b) => a === 'No Tier' ? 1 : b === 'No Tier' ? -1 : a.localeCompare(b);
    return {
      intent:          INTENT_ORDER.filter(v => intents.has(v)).map(v => ({ value: v, label: v })),
      stage:           [...stages].sort().map(v => ({ value: v, label: v })),
      segment:         [...segments].sort().map(v => ({ value: v, label: v })),
      currentTier:     [...currentTiers].sort(tierSort).map(v => ({ value: v, label: v })),
      recommendedTier: [...recTiers].sort(tierSort).map(v => ({ value: v, label: v })),
      fitRange:        FIT_ORDER.filter(v => fitRanges.has(v)).map(v => ({ value: v, label: v })),
      isDnn:           [...dnns].sort().map(v => ({ value: v, label: v })),
    };
  }, [baseAccounts]);

  const filteredAccounts = useMemo(() => baseAccounts.filter((a) => {
    const { intent, stage, segment, fitRange, currentTier, recommendedTier, isDnn } = fieldFilters;
    if (intent?.length && !intent.includes(a.Account_Intent__c || 'None')) return false;
    if (stage?.length  && !stage.includes(a.Account_Stage__c || ''))       return false;
    if (segment?.length && !segment.includes(a.Sales_Segment__c || ''))    return false;
    if (currentTier?.length && !currentTier.includes(a.currentTier || 'No Tier'))           return false;
    if (recommendedTier?.length && !recommendedTier.includes(a.recommendedTier || 'No Tier')) return false;
    if (fitRange?.length) {
      const fit = parseFloat(a.Fit_Score_Total__c);
      const bucket = isNaN(fit) ? 'No Score' : fit < 5 ? '< 5 (Low)' : fit <= 8 ? '5–8 (Med)' : '9+ (High)';
      if (!fitRange.includes(bucket)) return false;
    }
    if (isDnn?.length) {
      if (!isDnn.includes(a.Marketplace_Prospect__c ? 'DNN' : 'Non-DNN')) return false;
    }
    if (!matchesClosedLostFilter(a, closedLostRange)) return false;
    return true;
  }), [baseAccounts, fieldFilters, closedLostRange]);

  // Campaign sync stats — reflects both Review and Campaign-level approvals.
  const campaignStats = useMemo(() => {
    if (!campaignData?.members || accounts.length === 0) {
      return { currentlyInCampaign: 0, toAdd: 0, toRemove: 0, synced: 0 };
    }
    const memberSet = new Set(campaignData.members.map((m) => m.accountId));
    let toAdd = 0, toRemove = 0, synced = 0;
    accounts.filter((a) => a.action !== 'Ignore').forEach((a) => {
      const inCampaign = memberSet.has(a.Id);
      const hasTier    = !!effectiveTier(a, approved, rejected);
      let status;
      if      ( inCampaign &&  hasTier) status = 'synced';
      else if (!inCampaign &&  hasTier) status = 'needs-add';
      else if ( inCampaign && !hasTier) status = 'needs-remove';
      else return; // no tier, not in campaign — skip

      // Apply campaign-level approve decisions
      if (cpApproved.has(a.Id)) {
        if (status === 'needs-add')    status = 'synced';   // approved add → now in campaign
        else if (status === 'needs-remove') return;         // approved remove → no longer in campaign
      }

      if      (status === 'synced')       synced++;
      else if (status === 'needs-add')    toAdd++;
      else if (status === 'needs-remove') toRemove++;
    });
    return { currentlyInCampaign: synced + toRemove, toAdd, toRemove, synced };
  }, [accounts, campaignData, approved, rejected, cpApproved]);

  const pendingSyncCount = campaignStats.toAdd + campaignStats.toRemove;

  // Only show checkboxes/bulk actions on tabs that have actionable cards
  const isActionableTab = ['Add', 'Remove', 'Reclassify'].includes(activeFilter);

  // Review tab selection helpers
  const actionableFiltered = useMemo(
    () => filteredAccounts.filter((a) => a.action !== 'No Change' && a.action !== 'Ignore'),
    [filteredAccounts]
  );
  const allSelected  = actionableFiltered.length > 0 && actionableFiltered.every((a) => selected.has(a.Id));
  const someSelected = actionableFiltered.some((a) => selected.has(a.Id));

  const handleSelectAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(actionableFiltered.map((a) => a.Id)));
  }, [allSelected, actionableFiltered]);

  // Keep select-all checkbox indeterminate state in sync
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <div className="app">
      {accounts.length === 0 ? (
        <FetchPanel status={status} progressLines={progressLines} onFetch={startFetch} />
      ) : (
        <>
          <Header
            summary={summary}
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            reasonGroups={reasonGroups}
            activeReasonFilter={activeReasonFilter}
            onReasonFilterChange={setActiveReasonFilter}
            onApproveGroup={handleApproveGroup}
            onRejectGroup={handleRejectGroup}
            filteredAccounts={filteredAccounts}
            onApproveAll={handleApproveAll}
            onReset={handleReset}
            onRefetch={startFetch}
            approvedCount={approved.size}
            view={view}
            onViewChange={setView}
            pendingSyncCount={pendingSyncCount}
            campaignStats={campaignStats}
            campaignFilter={campaignFilter}
            onCampaignFilterChange={setCampaignFilter}
            campaignData={campaignData}
          />
          <main className="main-content">
            {view === 'campaign' ? (
              <CampaignPage
                accounts={accounts}
                campaignData={campaignData}
                filter={campaignFilter}
                onFilterChange={setCampaignFilter}
                approved={approved}
                rejected={rejected}
                cpApproved={cpApproved}
                cpRejected={cpRejected}
                onCpApprove={handleCpApprove}
                onCpReject={handleCpReject}
              />
            ) : (
              <>
                <div className="list-toolbar">
                  <div className="list-toolbar__left">
                    {isActionableTab && actionableFiltered.length > 0 && (
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
                      Showing {filteredAccounts.length}
                      {filteredAccounts.length !== baseAccounts.length && ` of ${baseAccounts.length}`} accounts
                      {search && ` matching "${search}"`}
                    </div>
                    {isActionableTab && actionableFiltered.length > 0 && (
                      <div className={`bulk-actions${someSelected ? ' bulk-actions--active' : ''}`}>
                        <span className={`selected-count${allSelected ? ' selected-count--all' : ''}`}>
                          {allSelected
                            ? `All ${actionableFiltered.length} selected`
                            : `${actionableFiltered.filter(a => selected.has(a.Id)).length} selected`}
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
                <AccountList
                  accounts={filteredAccounts}
                  approved={approved}
                  rejected={rejected}
                  selected={selected}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onToggleSelect={isActionableTab ? handleToggleSelect : undefined}
                />
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}
