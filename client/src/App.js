import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import AccountList from './components/AccountList';
import FetchPanel from './components/FetchPanel';
import './App.css';

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [approved, setApproved] = useState(new Set()); // Set of approved account Ids
  const [rejected, setRejected] = useState(new Set()); // Set of rejected account Ids
  const [activeFilter, setActiveFilter] = useState('All');
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

  // Final ABX = current + approved adds - approved removes + reclassifies (no net change)
  const approvedAdds = accounts.filter((a) => a.action === 'Add' && approved.has(a.Id)).length;
  const approvedRemoves = accounts.filter((a) => a.action === 'Remove' && approved.has(a.Id)).length;
  const finalABX = accounts.length > 0 ? currentABX + approvedAdds - approvedRemoves : null;

  const summary = {
    currentABX,
    finalABX,
    netChange: finalABX !== null ? finalABX - currentABX : 0,
    adds,
    removes,
    reclassifies,
    approvedCount: approved.size,
  };

  const filteredAccounts = accounts.filter((a) => {
    if (activeFilter !== 'All' && a.action !== activeFilter) return false;
    if (search && !a.Name?.toLowerCase().includes(search.toLowerCase())) return false;
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
            onFilterChange={setActiveFilter}
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
              Showing {filteredAccounts.length} of {accounts.filter(a => {
                if (activeFilter !== 'All' && a.action !== activeFilter) return false;
                return true;
              }).length} accounts
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
