import React, { useState, useRef, useEffect, useMemo } from 'react';
import { rangeLabel, buildFiscalPresets, rangesEqual } from './ClosedLostFilter';
import './FieldFilters.css';

const FIELD_CONFIGS = [
  { key: 'intent',          label: 'Intent' },
  { key: 'stage',           label: 'Stage' },
  { key: 'segment',         label: 'Segment' },
  { key: 'fitRange',        label: 'Fit Score' },
  { key: 'currentTier',     label: 'Current Tier' },
  { key: 'recommendedTier', label: 'Projected Tier' },
  { key: 'isDnn',           label: 'DNN' },
  { key: 'closedLostDate',  label: 'Entered Closed Lost Date', custom: true },
];

export default function FieldFilters({ fieldOptions, filters, onFilterChange, closedLostRange, onClosedLostRangeChange }) {
  const [open,         setOpen]         = useState(false);
  const [activePanel,  setActivePanel]  = useState(null);
  const [relativeNum,  setRelativeNum]  = useState('');
  const [relativeUnit, setRelativeUnit] = useState('months');
  const [customStart,  setCustomStart]  = useState('');
  const [customEnd,    setCustomEnd]    = useState('');
  const wrapRef = useRef(null);

  const fiscalPresets = useMemo(() => buildFiscalPresets(), []); // eslint-disable-line

  // Pre-fill inputs when the date panel is opened
  useEffect(() => {
    if (activePanel !== 'closedLostDate') return;
    if (closedLostRange?.type === 'relative') {
      setRelativeNum(String(closedLostRange.value));
      setRelativeUnit(closedLostRange.unit);
    } else if (closedLostRange?.type === 'custom') {
      setCustomStart(closedLostRange.start || '');
      setCustomEnd(closedLostRange.end   || '');
    }
  }, [activePanel]); // eslint-disable-line

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

  const activeCount = Object.keys(filters).filter((k) => filters[k]?.length > 0).length
    + (closedLostRange ? 1 : 0);

  const visibleFields = FIELD_CONFIGS.filter(
    ({ key, custom }) => custom || (fieldOptions[key] || []).length > 1
  );

  const handleToggle = () => {
    if (open) setActivePanel(null);
    setOpen((v) => !v);
  };

  const handleCategoryClick = (key) => {
    setActivePanel((prev) => (prev === key ? null : key));
  };

  const handleValueClick = (key, value) => {
    onFilterChange(key, value);
  };

  const applyRelative = () => {
    const num = parseInt(relativeNum, 10);
    if (!num || num < 1) return;
    onClosedLostRangeChange?.({ type: 'relative', unit: relativeUnit, value: num });
  };

  const applyCustom = () => {
    if (!customStart && !customEnd) return;
    onClosedLostRangeChange?.({ type: 'custom', start: customStart || null, end: customEnd || null });
  };

  const activePanelOptions = activePanel && activePanel !== 'closedLostDate'
    ? (fieldOptions[activePanel] || [])
    : [];

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
              let hasValue, badgeText;
              if (key === 'closedLostDate') {
                const lbl = rangeLabel(closedLostRange);
                hasValue  = !!lbl;
                badgeText = lbl;
              } else {
                const sel = filters[key] || [];
                hasValue  = sel.length > 0;
                badgeText = sel.length === 1 ? sel[0] : sel.length > 1 ? `${sel.length} selected` : null;
              }
              return (
                <button
                  key={key}
                  className={`ff-category${isOpen ? ' ff-category--open' : ''}${hasValue ? ' ff-category--selected' : ''}`}
                  onClick={() => handleCategoryClick(key)}
                >
                  <span className="ff-category__label">{label}</span>
                  {badgeText && <span className="ff-category__value">{badgeText}</span>}
                  <span className="ff-category__arrow">›</span>
                </button>
              );
            })}
            {activeCount > 0 && (
              <button
                className="ff-clear-all"
                onClick={() => { onFilterChange('__clear__', null); onClosedLostRangeChange?.(null); setActivePanel(null); }}
              >
                × Clear all
              </button>
            )}
          </div>

          {/* Right panel: date picker or value list */}
          {activePanel === 'closedLostDate' ? (
            <div className="ff-date-panel">
              <div className="ff-date-section-label">Relative</div>
              {closedLostRange?.type === 'relative' && (
                <div className="ff-date-active-chip">
                  <span>Last {closedLostRange.value} {closedLostRange.unit === 'quarters' ? 'fiscal quarters' : closedLostRange.unit === 'years' ? 'fiscal years' : closedLostRange.unit}</span>
                  <button className="ff-date-chip-clear" onClick={() => onClosedLostRangeChange?.(null)}>×</button>
                </div>
              )}
              <div className="ff-date-relative-row">
                <span className="ff-date-last">Last</span>
                <input
                  type="number"
                  className="ff-date-num"
                  value={relativeNum}
                  onChange={(e) => setRelativeNum(e.target.value)}
                  min="1"
                  max="999"
                  placeholder="—"
                />
                <select
                  className="ff-date-unit"
                  value={relativeUnit}
                  onChange={(e) => setRelativeUnit(e.target.value)}
                >
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                  <option value="quarters">fiscal quarters</option>
                  <option value="years">fiscal years</option>
                </select>
                <button
                  className="ff-date-apply"
                  onClick={applyRelative}
                  disabled={!relativeNum || parseInt(relativeNum, 10) < 1}
                >
                  Apply
                </button>
              </div>

              <div className="ff-date-divider" />
              <div className="ff-date-section-label">Fiscal Quarter</div>
              {fiscalPresets.quarters.map((p) => (
                <button
                  key={p.label}
                  className={`ff-value${rangesEqual(closedLostRange, p.range) ? ' ff-value--selected' : ''}`}
                  onClick={() => onClosedLostRangeChange?.(rangesEqual(closedLostRange, p.range) ? null : p.range)}
                >
                  <span className="ff-value__check">{rangesEqual(closedLostRange, p.range) ? '✓' : ''}</span>
                  {p.label}
                </button>
              ))}

              <div className="ff-date-divider" />
              <div className="ff-date-section-label">Fiscal Year</div>
              {fiscalPresets.years.map((p) => (
                <button
                  key={p.label}
                  className={`ff-value${rangesEqual(closedLostRange, p.range) ? ' ff-value--selected' : ''}`}
                  onClick={() => onClosedLostRangeChange?.(rangesEqual(closedLostRange, p.range) ? null : p.range)}
                >
                  <span className="ff-value__check">{rangesEqual(closedLostRange, p.range) ? '✓' : ''}</span>
                  {p.label}
                </button>
              ))}

              <div className="ff-date-divider" />
              <div className="ff-date-section-label">Custom Range</div>
              <div className="ff-date-custom-row">
                <input
                  type="date"
                  className="ff-date-input"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="ff-date-sep">→</span>
                <input
                  type="date"
                  className="ff-date-input"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
                <button
                  className="ff-date-apply"
                  onClick={applyCustom}
                  disabled={!customStart && !customEnd}
                >
                  Apply
                </button>
              </div>

              {closedLostRange && (
                <button
                  className="ff-clear-all"
                  onClick={() => onClosedLostRangeChange?.(null)}
                >
                  × Clear date filter
                </button>
              )}
            </div>
          ) : (
            activePanel && (
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
            )
          )}
        </div>
      )}
    </div>
  );
}
