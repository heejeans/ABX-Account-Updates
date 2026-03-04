import React from 'react';
import './Header.css';

const FILTERS = ['All', 'Add', 'Remove', 'Reclassify', 'No Change'];

export default function Header({
  summary,
  activeFilter,
  onFilterChange,
  reasonGroups,
  activeReasonFilter,
  onReasonFilterChange,
  onApproveGroup,
  onRejectGroup,
  filteredAccounts,
  search,
  onSearchChange,
  onApproveAll,
  onReset,
  onDownload,
  onRefetch,
  approvedCount,
}) {
  const cards = [
    {
      label: 'Current ABX',
      value: summary.currentABX,
      filter: 'Current ABX',
      color: '#2563eb',
    },
    {
      label: 'Final ABX',
      value: summary.estimatedFinalABX !== null ? summary.estimatedFinalABX : '—',
      sub: summary.estimatedFinalABX !== null
        ? `${summary.netChange >= 0 ? '+' : ''}${summary.netChange} net`
        : null,
      filter: 'Final ABX',
      color: '#0d9488',
    },
    {
      label: 'Add',
      value: summary.adds,
      filter: 'Add',
      color: '#2563eb',
      badgeClass: 'badge-add',
    },
    {
      label: 'Remove',
      value: summary.removes,
      filter: 'Remove',
      color: '#dc2626',
      badgeClass: 'badge-remove',
    },
    {
      label: 'Reclassify',
      value: summary.reclassifies,
      filter: 'Reclassify',
      color: '#7c3aed',
      badgeClass: 'badge-reclassify',
    },
  ];

  return (
    <header className="header">
      <div className="header__inner">
        {/* Top row */}
        <div className="header__top">
          <div className="header__title">
            <span className="header__logo-cz">CloudZero</span>
            <span className="header__logo-sep"> · </span>
            <span className="header__logo-title">ABX Tier Review</span>
          </div>
          <div className="header__actions">
            <button className="btn btn-outline" onClick={onRefetch}>
              ↺ Re-fetch
            </button>
            <button className="btn btn-outline" onClick={onReset}>
              Reset
            </button>
            <button className="btn btn-success" onClick={onApproveAll}>
              Approve All
            </button>
            <button
              className="btn btn-download"
              onClick={onDownload}
              disabled={approvedCount === 0}
            >
              ↓ Download Approved ({approvedCount})
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="header__cards">
          {cards.map((card) => (
            <button
              key={card.label}
              className={`summary-card${card.filter && activeFilter === card.filter ? ' summary-card--active' : ''}${card.filter ? ' summary-card--clickable' : ''}`}
              onClick={card.filter ? () => onFilterChange(activeFilter === card.filter ? 'All' : card.filter) : undefined}
              style={{ '--card-color': card.color }}
            >
              <div className="summary-card__value">{card.value}</div>
              <div className="summary-card__label">{card.label}</div>
              {card.sub && <div className="summary-card__sub">{card.sub}</div>}
            </button>
          ))}
        </div>

        {/* Filters + search */}
        <div className="header__filters">
          <div className="filter-buttons">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`filter-btn${activeFilter === f ? ' filter-btn--active' : ''}`}
                onClick={() => onFilterChange(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="header__search">
            <input
              type="text"
              placeholder="Search by account name…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="search-input"
            />
            {search && (
              <button className="search-clear" onClick={() => onSearchChange('')}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* Reason group sub-filters — only shown for Add / Remove / Reclassify */}
        {reasonGroups && reasonGroups.length > 0 && (
          <div className="header__reason-row">
            <div className="reason-pills">
              {reasonGroups.map(({ label, count }) => {
                const isActive = activeReasonFilter === label;
                return (
                  <button
                    key={label}
                    className={`reason-pill${isActive ? ' reason-pill--active' : ''}`}
                    onClick={() => onReasonFilterChange(isActive ? null : label)}
                  >
                    {label}
                    <span className="reason-pill__count">{count}</span>
                  </button>
                );
              })}
            </div>
            {activeReasonFilter && (
              <div className="reason-bulk-actions">
                <span className="reason-bulk-label">
                  {filteredAccounts.length} accounts:
                </span>
                <button
                  className="btn btn-sm btn-approve-group"
                  onClick={() => onApproveGroup(filteredAccounts)}
                >
                  ✓ Approve all
                </button>
                <button
                  className="btn btn-sm btn-reject-group"
                  onClick={() => onRejectGroup(filteredAccounts)}
                >
                  ✕ Reject all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
