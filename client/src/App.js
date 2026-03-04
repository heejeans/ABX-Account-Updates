import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from './components/Header';
import AccountList from './components/AccountList';
import FetchPanel from './components/FetchPanel';
import './App.css';

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
  const [approved, setApproved] = useState(new Set()); // Set of approved account Ids
  const [rejected, setRejected] = useState(new Set()); // Set of rejected account Ids
  const [activeFilter, setActiveFilter] = useState('All');
  const [activeReasonFilter, setActiveReasonFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ isFetching: false, hasData: false, accountCount: 0, fetchError: null });
  const [progressLines, setProgressLines] = useState([]);
  const eventSourceRef = useRef(null);
  const accountsLengthRef = useRef(0);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) return;
      const data = await res.json();
      accountsLengthRef.current = data.length;
      setAccounts(data);
      // Reset approvals on new data
      setApproved(new Set());
      setRejected(new Set());
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
        if (data.hasData && accountsLengthRef.current === 0) {
          loadAccounts();
        }
      } catch (_) {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [loadAccounts]);

  const startFetch = useCallback(async () => {
    setProgressLines([]);
    setAccounts([]);
    setApproved(new Set());
    setRejected(new Set());

    // Start SSE stream
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource('/api/progress');
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const { message } = JSON.parse(e.data);
        setProgressLines((prev) => [...prev.slice(-199), message]);
      } catch (_) {}
    };

    // Trigger fetch
    await fetch('/api/fetch', { method: 'POST' });
    setStatus((s) => ({ ...s, isFetching: true }));
  }, []);

  // When fetching stops, close SSE and load data
  useEffect(() => {
    if (!status.isFetching && status.hasData && accounts.length === 0) {
      loadAccounts();
      if (eventSourceRef.current) {
        setTimeout(() => {
          if (eventSourceRef.current) eventSourceRef.current.close();
        }, 2000);
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
    setRejected((prev) => {
      const n = new Set(prev);
      groupAccounts.forEach((a) => n.delete(a.Id));
      return n;
    });
  }, []);

  const handleRejectGroup = useCallback((groupAccounts) => {
    setRejected((prev) => new Set([...prev, ...groupAccounts.map((a) => a.Id)]));
    setApproved((prev) => {
      const n = new Set(prev);
      groupAccounts.forEach((a) => n.delete(a.Id));
      return n;
    });
  }, []);

  const handleReset = useCallback(() => {
    setApproved(new Set());
    setRejected(new Set());
  }, []);

  const handleDownload = useCallback(() => {
    const ids = [...approved].join(',');
    window.location.href = `/api/download?approved=${encodeURIComponent(ids)}`;
  }, [approved]);

  // Compute summary stats
  const actionable = accounts.filter((a) => a.action !== 'No Change' && a.action !== 'Ignore');
  const currentABX = accounts.filter((a) => a.currentTier).length;
  const adds = accounts.filter((a) => a.action === 'Add').length;
  const removes = accounts.filter((a) => a.action === 'Remove').length;
  const reclassifies = accounts.filter((a) => a.action === 'Reclassify').length;

  // Estimated Final ABX: assumes all non-rejected changes will happen.
  // Rejected adds won't be added; rejected removes stay in ABX.
  const rejectedAdds = accounts.filter((a) => a.action === 'Add' && rejected.has(a.Id)).length;
  const rejectedRemoves = accounts.filter((a) => a.action === 'Remove' && rejected.has(a.Id)).length;
  const estimatedFinalABX = accounts.length > 0
    ? currentABX + (adds - rejectedAdds) - (removes - rejectedRemoves)
    : null;

  const summary = {
    currentABX,
    estimatedFinalABX,
    netChange: estimatedFinalABX !== null ? estimatedFinalABX - currentABX : 0,
    adds,
    removes,
    reclassifies,
    approvedCount: approved.size,
  };

  // Compute reason groups for current action filter (only for Add/Remove/Reclassify)
  const reasonGroups = useMemo(() => {
    const ACTION_FILTERS_WITH_REASONS = ['Add', 'Remove', 'Reclassify'];
    if (!ACTION_FILTERS_WITH_REASONS.includes(activeFilter)) return [];
    const actionAccounts = accounts.filter((a) => a.action === activeFilter);
    const counts = {};
    actionAccounts.forEach((a) => {
      const g = getRuleGroup(a);
      counts[g] = (counts[g] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [accounts, activeFilter]);

  // Reset reason filter when action filter changes
  const handleFilterChange = useCallback((filter) => {
    setActiveFilter(filter);
    setActiveReasonFilter(null);
  }, []);

  const filteredAccounts = accounts.filter((a) => {
    if (search && !a.Name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeFilter === 'Current ABX') return !!a.currentTier;
    if (activeFilter === 'Final ABX') {
      // Include: No Change & Reclassify (already in ABX and staying),
      // rejected Removes (removal rejected → account stays in ABX),
      // non-rejected Adds (pending or approved → will be added).
      return (
        a.action === 'No Change' ||
        a.action === 'Reclassify' ||
        (a.action === 'Remove' && rejected.has(a.Id)) ||
        (a.action === 'Add' && !rejected.has(a.Id))
      );
    }
    if (activeFilter !== 'All' && a.action !== activeFilter) return false;
    if (activeReasonFilter && getRuleGroup(a) !== activeReasonFilter) return false;
    return true;
  });

  return (
    <div className="app">
      {accounts.length === 0 ? (
        <FetchPanel
          status={status}
          progressLines={progressLines}
          onFetch={startFetch}
        />
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
            search={search}
            onSearchChange={setSearch}
            onApproveAll={handleApproveAll}
            onReset={handleReset}
            onDownload={handleDownload}
            onRefetch={startFetch}
            approvedCount={approved.size}
          />
          <main className="main-content">
            <div className="record-count">
              Showing {filteredAccounts.length}{
                activeFilter === 'Current ABX' || activeFilter === 'Final ABX'
                  ? ''
                  : ` of ${accounts.filter(a => activeFilter === 'All' || a.action === activeFilter).length}`
              } accounts
              {search && ` matching "${search}"`}
            </div>
            <AccountList
              accounts={filteredAccounts}
              approved={approved}
              rejected={rejected}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          </main>
        </>
      )}
    </div>
  );
}
