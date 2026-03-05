import React from 'react';
import './Header.css';

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
  onApproveAll,
  onReset,
  onRefetch,
  approvedCount,
  view,
  onViewChange,
  pendingSyncCount,
  campaignStats,
  campaignFilter,
  onCampaignFilterChange,
}) {
  const reviewCards = [
    { label: 'Current ABX', value: summary.currentABX,  filter: 'Current ABX', color: '#2563eb' },
    {
      label: 'Final ABX',
      value: summary.estimatedFinalABX !== null ? summary.estimatedFinalABX : '—',
      sub: summary.estimatedFinalABX !== null
        ? `${summary.netChange >= 0 ? '+' : ''}${summary.netChange} net`
        : null,
      filter: 'Final ABX',
      color: '#0d9488',
    },
    { label: 'Add',        value: summary.adds,        filter: 'Add',        color: '#2563eb' },
    { label: 'Remove',     value: summary.removes,     filter: 'Remove',     color: '#dc2626' },
    { label: 'Reclassify', value: summary.reclassifies, filter: 'Reclassify', color: '#7c3aed' },
  ];

  const campaignCards = [
    { label: 'Currently in Campaign', value: campaignStats?.currentlyInCampaign ?? '—', filter: 'in-campaign',  color: '#0d9488' },
    { label: 'Will Add',              value: campaignStats?.toAdd      ?? '—',           filter: 'needs-add',    color: '#2563eb' },
    { label: 'Will Remove',           value: campaignStats?.toRemove   ?? '—',           filter: 'needs-remove', color: '#dc2626' },
    { label: 'Already Synced',        value: campaignStats?.synced     ?? '—',           filter: 'synced',       color: '#059669' },
  ];

  const cards        = view === 'campaign' ? campaignCards : reviewCards;
  const activeCard   = view === 'campaign' ? campaignFilter : activeFilter;
  const onCardChange = view === 'campaign'
    ? (f) => onCampaignFilterChange(campaignFilter === f ? 'all' : f)
    : (f) => onFilterChange(activeFilter === f ? 'All' : f);

  return (
    <header className="header">
      <div className="header__inner">
        {/* Top row */}
        <div className="header__top">
          <div className="header__title-nav">
            <div className="header__title">
              <span className="header__logo-cz">CloudZero</span>
              <span className="header__logo-sep"> · </span>
              <span className="header__logo-title">ABX Tier Review</span>
            </div>
            <nav className="header__nav">
              <button
                className={`header__nav-tab${view === 'review' ? ' header__nav-tab--active' : ''}`}
                onClick={() => onViewChange('review')}
              >
                Review
                {(summary.adds + summary.removes + summary.reclassifies) > 0 && (
                  <span className="header__nav-badge">
                    {summary.adds + summary.removes + summary.reclassifies}
                  </span>
                )}
              </button>
              <button
                className={`header__nav-tab${view === 'campaign' ? ' header__nav-tab--active' : ''}`}
                onClick={() => onViewChange('campaign')}
              >
                Campaign Sync
                {pendingSyncCount > 0 && (
                  <span className="header__nav-badge">{pendingSyncCount}</span>
                )}
              </button>
            </nav>
          </div>
          <div className="header__actions">
            <button className="btn btn-outline" onClick={onRefetch}>
              ↺ Re-fetch
            </button>
            <button className="btn btn-outline" onClick={onReset}>
              Reset
            </button>
            {view === 'review' && (
              <button className="btn btn-success" onClick={onApproveAll}>
                Approve All
              </button>
            )}
          </div>
        </div>

        {/* Summary cards — review stats or campaign stats depending on active tab */}
        <div className="header__cards">
          {cards.map((card) => (
            <button
              key={card.label}
              className={`summary-card${card.filter && activeCard === card.filter ? ' summary-card--active' : ''}${card.filter ? ' summary-card--clickable' : ''}`}
              onClick={card.filter ? () => onCardChange(card.filter) : undefined}
              style={{ '--card-color': card.color }}
              disabled={false}
            >
              <div className="summary-card__value">{card.value}</div>
              <div className="summary-card__label">{card.label}</div>
              {card.sub && <div className="summary-card__sub">{card.sub}</div>}
            </button>
          ))}
        </div>

        {/* Reason group sub-filters — only for Review tab, Add / Remove / Reclassify */}
        {view === 'review' && reasonGroups && reasonGroups.length > 0 && (
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
