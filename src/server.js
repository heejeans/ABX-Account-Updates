'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchAllAccounts } = require('./fetchData');
const { processAccounts } = require('./tieringLogic');
const sfdcClient = require('./sfdcClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve React build in production
const buildPath = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(buildPath));

// In-memory state
let accountsCache = null;
let isFetching = false;
let fetchProgress = [];
let fetchError = null;

// Auto-load pre-fetched data on startup if available
const dataPath = path.join(__dirname, '..', 'data', 'accounts.json');
try {
  const fs = require('fs');
  if (fs.existsSync(dataPath)) {
    accountsCache = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log(`Loaded ${accountsCache.length} pre-fetched accounts from data/accounts.json`);
  }
} catch (e) {
  console.warn('Could not load pre-fetched data:', e.message);
}

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
    // Persist to disk so server restarts use fresh data
    const fs = require('fs');
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'raw_accounts.json'), JSON.stringify(rawAccounts));
    fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify(accountsCache));
    sendProgress('Data saved to disk.');
  } catch (err) {
    fetchError = err;
    sendProgress(`ERROR: ${err.message}`);
    console.error('Fetch error:', err);
  } finally {
    isFetching = false;
  }
});

/**
 * POST /api/reload
 * Re-reads raw_accounts.json from disk, re-runs tiering, updates cache.
 */
app.post('/api/reload', (req, res) => {
  try {
    const fs = require('fs');
    const rawPath = path.join(__dirname, '..', 'data', 'raw_accounts.json');
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    accountsCache = processAccounts(raw);
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'accounts.json'), JSON.stringify(accountsCache));
    console.log(`Reloaded: ${accountsCache.length} accounts processed.`);
    res.json({ ok: true, count: accountsCache.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 * GET /api/campaign
 * Returns campaign info + member account IDs from disk.
 */
app.get('/api/campaign', (req, res) => {
  try {
    const fs = require('fs');
    const campaignPath = path.join(__dirname, '..', 'data', 'campaign_members.json');
    if (!fs.existsSync(campaignPath)) {
      return res.status(404).json({ error: 'Campaign data not loaded.' });
    }
    res.json(JSON.parse(fs.readFileSync(campaignPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/apply
 * Builds a sync payload from the approved decisions and forwards it to
 * Salesforce via sfdcClient (currently mocked — see src/sfdcClient.js).
 *
 * Body: { changes: [{ accountId, action, tier }, ...] }
 *   - accountId : Salesforce Account ID
 *   - action    : 'Add' | 'Remove' | 'Reclassify'
 *   - tier      : 'Tier 1' | 'Tier 2' | 'Tier 3' | null
 *
 * The client sends the pre-computed payload (already filtered to pending
 * changes), so the server just validates, passes to sfdcClient, and returns
 * the result.
 */
app.post('/api/apply', async (req, res) => {
  if (!accountsCache) {
    return res.status(404).json({ error: 'No account data loaded.' });
  }

  const { changes } = req.body;
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'No changes provided.' });
  }

  // Validate each change entry
  const valid = changes.every(
    (c) => c.accountId && ['Add', 'Remove', 'Reclassify'].includes(c.action)
  );
  if (!valid) {
    return res.status(400).json({ error: 'Invalid change entries.' });
  }

  try {
    const result = await sfdcClient.applyChanges(changes);
    res.json({ ok: true, result, changeCount: changes.length });
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
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
  console.log(`API key configured: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO — set ANTHROPIC_API_KEY in .env'}`);
});
