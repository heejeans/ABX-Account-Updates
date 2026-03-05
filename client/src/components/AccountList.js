import React from 'react';
import AccountCard from './AccountCard';
import './AccountList.css';

export default function AccountList({ accounts, approved, rejected, selected, onApprove, onReject, onToggleSelect }) {
  if (accounts.length === 0) {
    return (
      <div className="account-list__empty">
        No accounts match the current filters.
      </div>
    );
  }

  return (
    <div className="account-list">
      {accounts.map((account) => (
        <AccountCard
          key={account.Id}
          account={account}
          isApproved={approved.has(account.Id)}
          isRejected={rejected.has(account.Id)}
          isSelected={selected?.has(account.Id) || false}
          onApprove={onApprove}
          onReject={onReject}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
