import React, { useState, useRef, useEffect } from 'react';
import './ClosedLostFilter.css';

// ─── Fiscal year helpers (FY starts Feb 1; FY27 = Feb 1 2026 – Jan 31 2027) ──

function getFiscalYear(date) {
  return date.getMonth() >= 1 ? date.getFullYear() + 1 : date.getFullYear();
}

function getFiscalQuarter(date) {
  const m = date.getMonth(); // 0=Jan
  if (m === 0) return 4;    // Jan → Q4
  if (m <= 3)  return 1;    // Feb–Apr → Q1
  if (m <= 6)  return 2;    // May–Jul → Q2
  if (m <= 9)  return 3;    // Aug–Oct → Q3
  return 4;                 // Nov–Dec → Q4
}

function fiscalQuarterStart(fy, q) {
  const y = fy - 1; // calendar year in which Q1 of this FY begins
  if (q === 1) return new Date(y,  1, 1); // Feb 1
  if (q === 2) return new Date(y,  4, 1); // May 1
  if (q === 3) return new Date(y,  7, 1); // Aug 1
  return            new Date(y, 10, 1);   // Nov 1  (Q4)
}

function fiscalYearStart(fy) {
  return new Date(fy - 1, 1, 1); // Feb 1 of the previous calendar year
}

// ─── Public helpers (used by App.js and CampaignPage.js) ─────────────────────

/** Compute the inclusive { start, end } Date bounds for a closedLostRange value. */
export function getClosedLostBounds(range) {
  if (!range) return null;
  const now = new Date();

  if (range.type === 'relative') {
    const start = new Date(now);
    if      (range.unit === 'weeks')    start.setDate(start.getDate() - range.value * 7);
    else if (range.unit === 'months')   start.setMonth(start.getMonth() - range.value);
    else if (range.unit === 'quarters') start.setMonth(start.getMonth() - range.value * 3);
    else if (range.unit === 'years')    start.setFullYear(start.getFullYear() - range.value);
    return { start, end: now };
  }

  if (range.type === 'fiscal-quarter') {
    let fy = getFiscalYear(now);
    let q  = getFiscalQuarter(now);
    for (let i = 1; i < range.value; i++) {
      q--;
      if (q === 0) { q = 4; fy--; }
    }
    return { start: fiscalQuarterStart(fy, q), end: now };
  }

  if (range.type === 'fiscal-year') {
    const startFY = getFiscalYear(now) - range.value + 1;
    return { start: fiscalYearStart(startFY), end: now };
  }

  if (range.type === 'custom') {
    return {
      start: range.start ? new Date(range.start)              : null,
      end:   range.end   ? new Date(range.end + 'T23:59:59')  : null,
    };
  }

  return null;
}

/** Returns true if the account's CL date falls within the active range filter. */
export function matchesClosedLostFilter(account, range) {
  if (!range) return true;
  const dateStr = account.Entered_Closed_Lost_Date__c;
  if (!dateStr) return false; // exclude no-date accounts when filter is active
  const date   = new Date(dateStr);
  const bounds = getClosedLostBounds(range);
  if (!bounds) return true;
  if (bounds.start && date < bounds.start) return false;
  if (bounds.end   && date > bounds.end)   return false;
  return true;
}

// ─── Label ───────────────────────────────────────────────────────────────────

export function rangeLabel(range) {
  if (!range) return null;
  const now   = new Date();
  const curFY = getFiscalYear(now);
  const curQ  = getFiscalQuarter(now);

  if (range.type === 'relative') {
    const u = range.unit === 'weeks' ? 'w' : range.unit === 'months' ? 'mo' : range.unit === 'quarters' ? 'FQ' : 'FY';
    return `Last ${range.value}${u}`;
  }
  if (range.type === 'fiscal-quarter') {
    if (range.value === 1) return `Q${curQ} FY${curFY}`;
    return `Last ${range.value} FQs`;
  }
  if (range.type === 'fiscal-year') {
    if (range.value === 1) return `FY${curFY}`;
    return `FY${curFY - range.value + 1}–${curFY}`;
  }
  if (range.type === 'custom') {
    if (range.start && range.end) return `${range.start} → ${range.end}`;
    if (range.start) return `From ${range.start}`;
    if (range.end)   return `To ${range.end}`;
    return 'Custom';
  }
  return null;
}

export function rangesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Preset lists ─────────────────────────────────────────────────────────────

const RELATIVE_PRESETS = [
  { label: 'Last 4 weeks',   range: { type: 'relative', unit: 'weeks',  value: 4  } },
  { label: 'Last 8 weeks',   range: { type: 'relative', unit: 'weeks',  value: 8  } },
  { label: 'Last 3 months',  range: { type: 'relative', unit: 'months', value: 3  } },
  { label: 'Last 6 months',  range: { type: 'relative', unit: 'months', value: 6  } },
  { label: 'Last 12 months', range: { type: 'relative', unit: 'months', value: 12 } },
];

export function buildFiscalPresets() {
  const now   = new Date();
  const curFY = getFiscalYear(now);
  const curQ  = getFiscalQuarter(now);
  return {
    quarters: [
      { label: `Current FQ  (Q${curQ} FY${curFY})`, range: { type: 'fiscal-quarter', value: 1 } },
      { label: 'Last 2 FQs',                          range: { type: 'fiscal-quarter', value: 2 } },
      { label: 'Last 4 FQs',                          range: { type: 'fiscal-quarter', value: 4 } },
      { label: 'Last 8 FQs',                          range: { type: 'fiscal-quarter', value: 8 } },
    ],
    years: [
      { label: `Current FY  (FY${curFY})`,                       range: { type: 'fiscal-year', value: 1 } },
      { label: `Last 2 FYs  (FY${curFY - 1}–FY${curFY})`,        range: { type: 'fiscal-year', value: 2 } },
      { label: `Last 3 FYs  (FY${curFY - 2}–FY${curFY})`,        range: { type: 'fiscal-year', value: 3 } },
    ],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClosedLostFilter({ value, onChange }) {
  const [open,        setOpen]        = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const wrapRef = useRef(null);

  const { quarters, years } = buildFiscalPresets();

  // Pre-fill custom inputs when re-opening with an active custom range
  useEffect(() => {
    if (open && value?.type === 'custom') {
      setCustomStart(value.start || '');
      setCustomEnd(value.end   || '');
    }
  }, [open]); // eslint-disable-line

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const label    = rangeLabel(value);
  const isActive = !!value;

  const select = (range) => { onChange(range); setOpen(false); };

  const applyCustom = () => {
    if (!customStart && !customEnd) return;
    onChange({ type: 'custom', start: customStart || null, end: customEnd || null });
    setOpen(false);
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange(null);
    setCustomStart('');
    setCustomEnd('');
  };

  return (
    <div className="clf-wrap" ref={wrapRef}>
      <button
        className={`clf-btn${open ? ' clf-btn--open' : ''}${isActive ? ' clf-btn--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Filter by Closed Lost date"
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
        </svg>
        <span className="clf-btn__label">{label || 'CL Date'}</span>
        {isActive && (
          <span className="clf-btn__clear" onClick={clear} title="Clear filter">×</span>
        )}
      </button>

      {open && (
        <div className="clf-dropdown">

          <div className="clf-section-label">Relative</div>
          {RELATIVE_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`clf-option${rangesEqual(value, p.range) ? ' clf-option--active' : ''}`}
              onClick={() => select(p.range)}
            >{p.label}</button>
          ))}

          <div className="clf-divider" />

          <div className="clf-section-label">Fiscal Quarter</div>
          {quarters.map((p) => (
            <button
              key={p.label}
              className={`clf-option${rangesEqual(value, p.range) ? ' clf-option--active' : ''}`}
              onClick={() => select(p.range)}
            >{p.label}</button>
          ))}

          <div className="clf-divider" />

          <div className="clf-section-label">Fiscal Year</div>
          {years.map((p) => (
            <button
              key={p.label}
              className={`clf-option${rangesEqual(value, p.range) ? ' clf-option--active' : ''}`}
              onClick={() => select(p.range)}
            >{p.label}</button>
          ))}

          <div className="clf-divider" />

          <div className="clf-section-label">Custom Range</div>
          <div className="clf-custom">
            <input
              type="date"
              className="clf-date-input"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="clf-custom__sep">→</span>
            <input
              type="date"
              className="clf-date-input"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
            <button className="clf-apply-btn" onClick={applyCustom}>Apply</button>
          </div>

        </div>
      )}
    </div>
  );
}
