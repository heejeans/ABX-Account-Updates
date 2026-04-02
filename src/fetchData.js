'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const path = require('path');
const fs = require('fs');

const BATCH_SIZE = 200;
const CLAUDE_BIN = path.join(
  process.env.HOME,
  'Library/Application Support/Claude/claude-code/2.1.63/claude'
);
const MCP_CONFIG = JSON.stringify({
  mcpServers: {
    sweep: { type: 'sdk', name: '00771cb1-95f8-4d4d-a027-baadf98d1f1f' },
  },
});

const QUERIES = {
  group1: {
    label: 'Group 1 — Currently tiered + all Closed Lost',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Government_Education__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND (ABX_Tier__c != null OR Account_Stage__c = 'Closed Lost') ORDER BY Name`,
  },
  group2: {
    label: 'Group 2 — Prospect candidates (no tier)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Government_Education__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Government_Education__c = false AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' ORDER BY Name`,
  },
  group3: {
    label: 'Group 3 — Old Closed Lost candidates (no tier, before Aug 1 2025)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Government_Education__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Government_Education__c = false AND Account_Stage__c = 'Closed Lost' AND Entered_Closed_Lost_Date__c < 2025-08-01 AND Sales_Segment__c != 'Commercial' ORDER BY Name`,
  },
  group4: {
    label: 'Group 4 — DNN/Marketplace Prospects without tier (low/no fit or intent)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Government_Education__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Marketplace_Prospect__c = true AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Government_Education__c = false AND (Fit_Score_Total__c < 5 OR Fit_Score_Total__c = null OR Account_Intent__c = null OR Account_Intent__c = 'None') ORDER BY Name`,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract records from a Sweep MCP run-soql tool result.
 * Sweep MCP returns { query_result: [...], totalSize, status }
 * wrapped in MCP content blocks: [{ type: 'text', text: '<json>' }]
 */
function parseRecords(result) {
  try {
    const obj = typeof result === 'string' ? JSON.parse(result) : result;
    let payload = obj;
    if (Array.isArray(obj?.content)) {
      for (const block of obj.content) {
        const text = block.text || (typeof block === 'string' ? block : null);
        if (!text) continue;
        try { payload = JSON.parse(text); break; } catch (_) {}
      }
    }
    if (Array.isArray(payload?.query_result)) return payload.query_result;
    if (Array.isArray(payload?.records)) return payload.records;
    if (Array.isArray(payload)) return payload;
  } catch (_) {}
  return [];
}

/**
 * Run a single SOQL group via the Sweep MCP run-soql tool, paginating until done.
 * Uses OFFSET pagination up to 2000, then keyset pagination on Name.
 */
async function runQuery(mcpClient, groupKey, onProgress) {
  const query = QUERIES[groupKey];
  const allRecords = [];
  const seenIds = new Set();
  let offset = 0;
  let batchNum = 0;
  let lastFetchedName = null;
  const MAX_OFFSET = 2000;

  while (true) {
    batchNum++;
    let paginatedSoql;

    if (offset <= MAX_OFFSET) {
      paginatedSoql = `${query.soql} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    } else {
      // Keyset pagination after hitting the 2000-record OFFSET limit
      const escapedName = (lastFetchedName || '').replace(/'/g, "\\'");
      const baseWhereEnd = query.soql.indexOf(' ORDER BY');
      const baseWhere = query.soql.slice(0, baseWhereEnd);
      const orderBy = query.soql.slice(baseWhereEnd);
      paginatedSoql = `${baseWhere} AND Name > '${escapedName}'${orderBy} LIMIT ${BATCH_SIZE} OFFSET 0`;
    }

    onProgress(`  [${query.label}] Batch ${batchNum}, offset ${offset} — fetching...`);

    let result;
    try {
      result = await mcpClient.callTool({ name: 'run-soql', arguments: { query: paginatedSoql } });
    } catch (err) {
      throw new Error(`MCP tool call failed: ${err.message}`);
    }

    const batchRecords = parseRecords(result);
    let newCount = 0;
    for (const rec of batchRecords) {
      if (rec.Id && !seenIds.has(rec.Id)) {
        seenIds.add(rec.Id);
        allRecords.push(rec);
        newCount++;
        lastFetchedName = rec.Name;
      }
    }

    onProgress(`  [${query.label}] Batch ${batchNum} done — got ${newCount} new (total: ${allRecords.length})`);

    if (batchRecords.length < BATCH_SIZE) break;

    if (offset < MAX_OFFSET) {
      offset += BATCH_SIZE;
    }
    // If offset would exceed MAX_OFFSET, we stay in keyset mode (offset stays at MAX_OFFSET sentinel)
    if (offset > MAX_OFFSET) offset = MAX_OFFSET + 1; // sentinel to keep keyset mode

    await sleep(300);
  }

  return allRecords;
}

/**
 * Fetch via direct Sweep MCP SSE connection (requires SWEEP_MCP_TOKEN in .env).
 */
async function fetchViaSweepToken(onProgress) {
  const serverUrl = process.env.SWEEP_MCP_URL || 'https://sweepmcp.com/sse';
  const token = process.env.SWEEP_MCP_TOKEN;
  if (!token) {
    throw new Error('SWEEP_MCP_TOKEN not set');
  }

  onProgress('Connecting to Sweep MCP server...');
  const authHeaders = { Authorization: `Bearer ${token}` };
  const transport = new SSEClientTransport(new URL(serverUrl), {
    eventSourceInit: { headers: authHeaders },
    requestInit: { headers: authHeaders },
  });
  const client = new Client({ name: 'abx-fetch', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  onProgress(`MCP connected. Available tools: ${tools.map((t) => t.name).join(', ')}`);

  const allRecords = [];
  const seenIds = new Set();

  for (const groupKey of ['group1', 'group2', 'group3', 'group4']) {
    onProgress(`\nStarting ${QUERIES[groupKey].label}...`);
    const records = await runQuery(client, groupKey, onProgress);
    let added = 0;
    for (const rec of records) {
      if (rec.Id && !seenIds.has(rec.Id)) {
        seenIds.add(rec.Id);
        allRecords.push(rec);
        added++;
      }
    }
    onProgress(`  => ${added} unique records added (running total: ${allRecords.length})`);
  }

  await client.close();
  onProgress(`\nFetch complete. Total unique accounts: ${allRecords.length}`);
  return allRecords;
}

/**
 * Fetch via the claude CLI subprocess using the existing Sweep SDK connector.
 * The claude binary spawns with a clean environment and uses the
 * CLAUDE_CODE_OAUTH_TOKEN for auth.  It runs all 4 SOQL groups as a task
 * and writes the raw JSON to a temp file which this function reads back.
 */
async function fetchViaClaude(onProgress) {
  if (!fs.existsSync(CLAUDE_BIN)) {
    throw new Error(`Claude binary not found at: ${CLAUDE_BIN}`);
  }

  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!oauthToken) {
    throw new Error('CLAUDE_CODE_OAUTH_TOKEN not available. Please run this from within a Claude Code session.');
  }

  const outFile = path.join(__dirname, '..', 'data', 'raw-accounts-temp.json');
  const queriesJson = JSON.stringify(QUERIES);

  const prompt = `You have access to a Sweep MCP tool called run-soql. Use it to fetch Salesforce account data.

Run each of these 4 query groups with LIMIT 200 pagination (one batch at a time):
${queriesJson}

Rules:
- Use OFFSET 0, 200, 400... up to OFFSET 2000 (Salesforce max)
- After hitting the offset limit, switch to keyset: add "AND Name > 'lastFetchedName'" to WHERE clause with OFFSET 0
- Stop a group when fewer than 200 records are returned
- Deduplicate all records by Id across groups
- Write the final JSON array to: ${outFile}
- Output only: DONE:{count} when finished (e.g. DONE:3981)

Do NOT explain anything else. Just run the queries and write the file.`;

  onProgress('Connecting via Claude Code session (Sweep SDK connector)...');

  return new Promise((resolve, reject) => {
    const env = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
    };

    const proc = spawn(
      CLAUDE_BIN,
      [
        '--mcp-config', MCP_CONFIG,
        '--output-format', 'text',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        '-p', prompt,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // Stream progress lines
      text.split('\n').filter(Boolean).forEach((line) => {
        if (line.trim()) onProgress(`  claude: ${line.trim().slice(0, 120)}`);
      });
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => reject(new Error(`Spawn error: ${err.message}`)));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`claude process exited ${code}: ${stderr.slice(0, 300)}`));
      }

      // Check for DONE:{count} marker
      const doneMatch = stdout.match(/DONE:(\d+)/);
      if (!doneMatch) {
        return reject(new Error(`claude did not output DONE marker. stdout: ${stdout.slice(0, 300)}`));
      }

      // Read the temp output file
      try {
        const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        onProgress(`\nFetch complete via Claude. Total unique accounts: ${raw.length}`);
        resolve(raw);
      } catch (err) {
        reject(new Error(`Failed to read output file: ${err.message}`));
      }
    });

    // Timeout after 20 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error('Fetch timed out after 20 minutes'));
    }, 20 * 60 * 1000);
  });
}

/**
 * Main fetch function — tries SWEEP_MCP_TOKEN first, then Claude subprocess.
 */
async function fetchAllAccounts(onProgress = console.log) {
  // Method 1: Direct Sweep token (fastest, works standalone)
  if (process.env.SWEEP_MCP_TOKEN) {
    onProgress('Using direct Sweep MCP connection (SWEEP_MCP_TOKEN)...');
    try {
      return await fetchViaSweepToken(onProgress);
    } catch (err) {
      onProgress(`Direct Sweep connection failed: ${err.message}`);
      onProgress('Falling back to Claude session method...');
    }
  }

  // Method 2: Claude subprocess via OAuth token
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    onProgress('Using Claude session Sweep connector...');
    return await fetchViaClaude(onProgress);
  }

  // No auth available
  throw new Error(
    'No Salesforce authentication available.\n\n' +
    'Options:\n' +
    '  1. Add SWEEP_MCP_TOKEN to .env (find it in Sweep dashboard under Settings > MCP)\n' +
    '  2. Run the server from within a Claude Code session (which provides the Sweep connector)\n' +
    '  3. Use the /fetch-sfdc Claude command to fetch data manually via Claude chat'
  );
}

module.exports = { fetchAllAccounts };

// Allow running directly: node src/fetchData.js
if (require.main === module) {
  fetchAllAccounts(console.log)
    .then((records) => {
      const outPath = path.join(__dirname, '..', 'data', 'raw-accounts.json');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
      console.log(`\nWrote ${records.length} records to ${outPath}`);
    })
    .catch((err) => {
      console.error('Fatal error:', err.message);
      process.exit(1);
    });
}
