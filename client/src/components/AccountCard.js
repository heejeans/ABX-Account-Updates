import React, { useState } from 'react';
import './AccountCard.css';

const SF_BASE = 'https://cloudzero.lightning.force.com/lightning/r/Account';

function TierBadge({ tier }) {
  if (!tier) return <span className="badge badge-none">No Tier</span>;
  const num = tier.replace('Tier ', '');
  const cls = num === '1' ? 'badge-tier1' : num === '2' ? 'badge-tier2' : 'badge-tier3';
  return <span className={`badge ${cls}`}>{tier}</span>;
}

function ActionBadge({ action }) {
  const map = {
    Add: 'badge-add',
    Remove: 'badge-remove',
    Reclassify: 'badge-reclassify',
    'No Change': 'badge-nochange',
    Ignore: 'badge-ignore',
  };
  return <span className={`badge ${map[action] || 'badge-ignore'}`}>{action}</span>;
}

function FitScore({ value }) {
  const num = parseFloat(value);
  if (isNaN(num)) return <span className="fit-none">—</span>;
  const cls = num >= 11 ? 'fit-high' : num >= 9 ? 'fit-medium' : num >= 5 ? 'fit-low' : 'fit-none';
  return <span className={cls}>{num}</span>;
}

const FIELD_LABELS = {
  Id: 'Salesforce ID',
  ABX_Tier__c: 'ABX Tier',
  Fit_Score_Total__c: 'Fit Score',
  Account_Intent__c: 'Intent',
  Account_Stage__c: 'Stage',
  Marketplace_Prospect__c: 'DNN/Marketplace Prospect',
  Consulting_IT_Filter_Flow__c: 'Consulting/IT Filter',
  Company_isDefunct__c: 'Company Defunct',
  Qualified_Out_Detail__c: 'Qualified Out Detail',
  ParentId: 'Parent Account ID',
  Entered_Closed_Lost_Date__c: 'Entered Closed Lost Date',
};

const ACTION_CLASS = {
  Add: 'account-card--add',
  Remove: 'account-card--remove',
  Reclassify: 'account-card--reclassify',
  'No Change': 'account-card--nochange',
  Ignore: 'account-card--ignore',
};

export default function AccountCard({ account, isApproved, isRejected, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const isActionable = account.action !== 'No Change' && account.action !== 'Ignore';

  const tierChanged = account.currentTier !== account.recommendedTier;

  const actionCls = ACTION_CLASS[account.action] || '';
  const stateCls = isApproved ? ' account-card--approved' : isRejected ? ' account-card--rejected' : '';

  return (
    <div className={`account-card ${actionCls}${stateCls}`}>
      <div className="account-card__main">
        {/* Left: name + badges */}
        <div className="account-card__info">
          <div className="account-card__name-row">
            <a
              href={`${SF_BASE}/${account.Id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="account-card__name"
            >
              {account.Name || '(unnamed)'}
            </a>
            <ActionBadge action={account.action} />
          </div>
          <div className="account-card__meta">
            <span className="meta-item">
              <span className="meta-label">Fit:</span>{' '}
              <FitScore value={account.Fit_Score_Total__c} />
            </span>
            <span className="meta-sep">·</span>
            <span className="meta-item">
              <span className="meta-label">Intent:</span>{' '}
              {account.Account_Intent__c || '—'}
            </span>
            <span className="meta-sep">·</span>
            <span className="meta-item">
              <span className="meta-label">Stage:</span>{' '}
              {account.Account_Stage__c || '—'}
            </span>
          </div>
        </div>

        {/* Center: tier change */}
        <div className="account-card__tier">
          <TierBadge tier={account.currentTier} />
          {tierChanged && (
            <>
              <span className="tier-arrow">→</span>
              <TierBadge tier={account.recommendedTier} />
            </>
          )}
        </div>

        {/* Right: approve/reject + expand */}
        <div className="account-card__actions">
          {isActionable && (
            <div className="account-card__vote">
              <button
                className={`btn-approve${isApproved ? ' active' : ''}`}
                onClick={() => onApprove(account.Id)}
                title="Approve this change"
              >
                ✓ Approve
              </button>
              <button
                className={`btn-reject${isRejected ? ' active' : ''}`}
                onClick={() => onReject(account.Id)}
                title="Reject this change"
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

      {/* Expanded details */}
      {expanded && (
        <div className="account-card__expanded">
          <div className="expanded__reason">
            <strong>Recommendation:</strong> {account.reason}
          </div>
          <div className="expanded__fields">
            <div className="expanded__fields-title">Raw Field Values</div>
            <div className="expanded__fields-grid">
              {Object.entries(FIELD_LABELS).map(([field, label]) => (
                <div key={field} className="expanded__field-row">
                  <span className="expanded__field-label">{label}</span>
                  <span className="expanded__field-value">
                    {account[field] !== null && account[field] !== undefined
                      ? String(account[field])
                      : <em className="null-val">null</em>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
