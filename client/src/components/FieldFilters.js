import React, { useState, useRef, useEffect } from 'react';
import './FieldFilters.css';

const FIELD_CONFIGS = [
  { key: 'intent',          label: 'Intent' },
  { key: 'stage',           label: 'Stage' },
  { key: 'segment',         label: 'Segment' },
  { key: 'fitRange',        label: 'Fit Score' },
  { key: 'currentTier',     label: 'Current Tier' },
  { key: 'recommendedTier', label: 'Projected Tier' },
  { key: 'isDnn',           label: 'DNN' },
  { key: 'closedLostYear',  label: 'CL Date' },
];

export default function FieldFilters({ fieldOptions, filters, onFilterChange }) {
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setActivePanel(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // filters[key] is now an array of selected values
  const activeCount = Object.keys(filters).filter((k) => filters[k]?.length > 0).length;
  const visibleFields = FIELD_CONFIGS.filter(
    ({ key }) => (fieldOptions[key] || []).length > 1
  );

  const handleToggle = () => {
    if (open) setActivePanel(null);
    setOpen((v) => !v);
  };

  const handleCategoryClick = (key) => {
    setActivePanel((prev) => (prev === key ? null : key));
  };

  // Toggle a value in/out of the array for this filter key
  const handleValueClick = (key, value) => {
    onFilterChange(key, value);
  };

  const activePanelOptions = activePanel ? (fieldOptions[activePanel] || []) : [];

  if (visibleFields.length === 0) return null;

  return (
    <div className="ff-wrap" ref={wrapRef}>
      <button
        className={`ff-btn${open ? ' ff-btn--open' : ''}${activeCount > 0 ? ' ff-btn--active' : ''}`}
        onClick={handleToggle}
        title="Filters"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-.553.894l-4-2A1 1 0 018 15V10.414L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
        </svg>
        {activeCount > 0 && <span className="ff-btn__count">{activeCount}</span>}
      </button>

      {open && (
        <div className="ff-dropdown">
          {/* Left panel: filter categories */}
          <div className="ff-categories">
            {visibleFields.map(({ key, label }) => {
              const isOpen = activePanel === key;
              const selectedValues = filters[key] || [];
              const hasValue = selectedValues.length > 0;
              const badgeText = selectedValues.length === 1
                ? selectedValues[0]
                : selectedValues.length > 1
                  ? `${selectedValues.length} selected`
                  : null;
              return (
                <button
                  key={key}
                  className={`ff-category${isOpen ? ' ff-category--open' : ''}${hasValue ? ' ff-category--selected' : ''}`}
                  onClick={() => handleCategoryClick(key)}
                >
                  <span className="ff-category__label">{label}</span>
                  {badgeText && (
                    <span className="ff-category__value">{badgeText}</span>
                  )}
                  <span className="ff-category__arrow">›</span>
                </button>
              );
            })}
            {activeCount > 0 && (
              <button
                className="ff-clear-all"
                onClick={() => { onFilterChange('__clear__', null); setActivePanel(null); }}
              >
                × Clear all
              </button>
            )}
          </div>

          {/* Right panel: values for the active category (multi-select) */}
          {activePanel && (
            <div className="ff-values">
              {activePanelOptions.map(({ value, label }) => {
                const isSelected = (filters[activePanel] || []).includes(value);
                return (
                  <button
                    key={value}
                    className={`ff-value${isSelected ? ' ff-value--selected' : ''}`}
                    onClick={() => handleValueClick(activePanel, value)}
                  >
                    <span className="ff-value__check">{isSelected ? '✓' : ''}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
