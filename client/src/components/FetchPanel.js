import React, { useRef, useEffect } from 'react';
import './FetchPanel.css';

export default function FetchPanel({ status, progressLines, onFetch }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progressLines]);

  return (
    <div className="fetch-panel">
      <div className="fetch-panel__card">
        <div className="fetch-panel__logo">
          <span className="fetch-panel__logo-cz">CloudZero</span>
          <span className="fetch-panel__logo-sep"> · </span>
          <span className="fetch-panel__logo-title">ABX Tier Review</span>
        </div>
        <div className="fetch-panel__subtitle">Salesforce Account Tiering Module</div>
        <p className="fetch-panel__desc">
          Connects to your Salesforce org via Sweep MCP, evaluates every account against the ABX tiering matrix (Fit Score + Intent), and surfaces Add / Remove / Reclassify recommendations for your review.
        </p>

        {status.fetchError && (
          <div className="fetch-panel__error">
            <strong>Error:</strong> {status.fetchError}
          </div>
        )}

        <button
          className="btn btn-primary fetch-panel__btn"
          onClick={onFetch}
          disabled={status.isFetching}
        >
          {status.isFetching ? (
            <>
              <span className="spinner" />
              Fetching data...
            </>
          ) : (
            'Fetch Salesforce Data'
          )}
        </button>

        {progressLines.length > 0 && (
          <div className="fetch-panel__log-wrap">
            <div className="fetch-panel__log-label">Progress</div>
            <div className="fetch-panel__log" ref={logRef}>
              {progressLines.map((line, i) => (
                <div key={i} className="fetch-panel__log-line">{line}</div>
              ))}
              {status.isFetching && <div className="fetch-panel__log-line fetch-panel__log-cursor">▋</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
