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
        <p className="fetch-panel__desc">
          Fetch account data from Salesforce via Anthropic + Sweep MCP, then run the tiering framework locally.
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
