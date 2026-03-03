'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchAllAccounts } = require('./fetchData');
const { processAccounts } = require('./tieringLogic');
const { RAW_MOCK_ACCOUNTS } = require('./mockData');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve React build in production
const buildPath = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(buildPath));

// Auto-seed mock data when no real API key is present
const USE_MOCK = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here' || process.env.MOCK === 'true';

// In-memory state
let accountsCache = USE_MOCK ? processAccounts(RAW_MOCK_ACCOUNTS) : null;
let isFetching = false;
let fetchProgress = [];
let fetchError = null;

// SSE clients for progress streaming
let sseClients = [];

function sendProgress(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fetchProgress.push(line);
  // Keep last 500 messages
  if (fetchProgress.length > 500) fetchProgress = fetchProgress.slice(-500);
  // Broadcast to SSE clients
  sseClients.forEach((res) => {
    try {
      res.write(`data: ${JSON.stringify({ message: line })}\n\n`);
    } catch (_) {}
  });
}

/**
 * GET /api/status
 * Returns current fetch status and cached account count.
 */
app.get('/api/status', (req, res) => {
  res.json({
    isFetching,
    accountCount: accountsCache ? accountsCache.length : 0,
    hasData: !!accountsCache,
    fetchError: fetchError ? fetchError.message : null,
    progressLines: fetchProgress.slice(-50),
  });
});

/**
 * GET /api/progress (SSE)
 * Streams fetch progress events to the browser.
 */
app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  // Send recent history
  fetchProgress.slice(-20).forEach((msg) => {
    res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
  });

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

/**
 * POST /api/fetch
 * Triggers data fetch from Salesforce via Anthropic + MCP.
 */
app.post('/api/fetch', async (req, res) => {
  if (isFetching) {
    return res.status(409).json({ error: 'Fetch already in progress' });
  }

  isFetching = true;
  fetchError = null;
  fetchProgress = [];
  res.json({ started: true });

  try {
    const rawAccounts = await fetchAllAccounts(sendProgress);
    accountsCache = processAccounts(rawAccounts);
    sendProgress(`Processing complete. ${accountsCache.length} accounts evaluated.`);
  } catch (err) {
    fetchError = err;
    sendProgress(`ERROR: ${err.message}`);
    console.error('Fetch error:', err);
  } finally {
    isFetching = false;
  }
});

/**
 * GET /api/accounts
 * Returns processed accounts.
 */
app.get('/api/accounts', (req, res) => {
  if (!accountsCache) {
    return res.status(404).json({ error: 'No data. Run /api/fetch first.' });
  }
  res.json(accountsCache);
});

/**
 * GET /api/download
 * Returns CSV of approved actionable accounts.
 * Query param: approved=id1,id2,...
 */
app.get('/api/download', (req, res) => {
  if (!accountsCache) {
    return res.status(404).json({ error: 'No data available' });
  }

  const approvedIds = req.query.approved
    ? new Set(req.query.approved.split(','))
    : new Set();

  const rows = accountsCache.filter(
    (a) => approvedIds.has(a.Id) && a.action !== 'No Change' && a.action !== 'Ignore'
  );

  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = ['Id', 'Name', 'Action', 'Current_ABX_Tier', 'New_ABX_Tier', 'Fit_Score', 'Intent', 'Stage', 'Reason'];
  const csvRows = [
    headers.join(','),
    ...rows.map((a) =>
      [
        escape(a.Id),
        escape(a.Name),
        escape(a.action),
        escape(a.currentTier),
        escape(a.recommendedTier),
        escape(a.Fit_Score_Total__c),
        escape(a.Account_Intent__c),
        escape(a.Account_Stage__c),
        escape(a.reason),
      ].join(',')
    ),
  ];

  const csv = csvRows.join('\n');
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="abx-approved-changes-${date}.csv"`);
  res.send(csv);
});

// Fallback to React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\nABX Account Updates server running on http://localhost:${PORT}`);
  if (USE_MOCK) {
    console.log(`Mode: MOCK — ${accountsCache.length} sample accounts pre-loaded (no Salesforce connection needed)`);
  } else {
    console.log(`Mode: LIVE — API key configured, ready to fetch from Salesforce`);
  }
});
