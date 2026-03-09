require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const BATCH_SIZE = 200;

const QUERIES = {
  group1: {
    label: 'Group 1 — Currently tiered + all Closed Lost',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND (ABX_Tier__c != null OR Account_Stage__c = 'Closed Lost') ORDER BY Name`,
  },
  group2: {
    label: 'Group 2 — Prospect candidates (no tier)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' ORDER BY Name`,
  },
  group3: {
    label: 'Group 3 — Old Closed Lost candidates (no tier, before Aug 1 2025)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Closed Lost' AND Entered_Closed_Lost_Date__c < 2025-08-01 AND Sales_Segment__c != 'Commercial' ORDER BY Name`,
  },
  group4: {
    label: 'Group 4 — DNN/Marketplace Prospects without tier (low/no fit or intent)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Marketplace_Prospect__c = true AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND (Fit_Score_Total__c < 5 OR Fit_Score_Total__c = null OR Account_Intent__c = null OR Account_Intent__c = 'None') ORDER BY Name`,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract records from a Sweep MCP run-soql tool result.
 * The tool returns { records: [...] } or a JSON string.
 */
function parseRecords(result) {
  try {
    const obj = typeof result === 'string' ? JSON.parse(result) : result;
    if (Array.isArray(obj?.records)) return obj.records;
    if (Array.isArray(obj?.content)) {
      // MCP tool result content blocks
      for (const block of obj.content) {
        const text = block.text || (typeof block === 'string' ? block : null);
        if (!text) continue;
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.records)) return parsed.records;
        }
      }
    }
    if (Array.isArray(obj)) return obj;
  } catch (_) {}
  return [];
}

/**
 * Run a single SOQL group via the Sweep MCP run-soql tool, paginating until done.
 */
async function runQuery(mcpClient, groupKey, onProgress) {
  const query = QUERIES[groupKey];
  const allRecords = [];
  const seenIds = new Set();
  let offset = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const paginatedSoql = `${query.soql} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
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
      }
    }

    onProgress(
      `  [${query.label}] Batch ${batchNum} done — got ${newCount} new records (total: ${allRecords.length})`
    );

    if (batchRecords.length < BATCH_SIZE) break;

    offset += BATCH_SIZE;
    await sleep(500);
  }

  return allRecords;
}

/**
 * Main fetch function — connects directly to Sweep MCP, runs all query groups.
 */
async function fetchAllAccounts(onProgress = console.log) {
  const serverUrl = process.env.SWEEP_MCP_URL;
  if (!serverUrl) {
    throw new Error('SWEEP_MCP_URL not set in .env file');
  }

  onProgress('Connecting to Sweep MCP server...');

  const transport = new SSEClientTransport(new URL(serverUrl));
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
    onProgress(`  => ${added} unique records added from this group (running total: ${allRecords.length})`);
  }

  await client.close();
  onProgress(`\nFetch complete. Total unique accounts: ${allRecords.length}`);
  return allRecords;
}

module.exports = { fetchAllAccounts };

// Allow running directly: node src/fetchData.js
if (require.main === module) {
  fetchAllAccounts(console.log)
    .then((records) => {
      const fs = require('fs');
      const outPath = require('path').join(__dirname, '..', 'data', 'accounts.json');
      fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
      console.log(`\nWrote ${records.length} records to ${outPath}`);
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
