require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const MCP_SERVER_URL = 'https://sweepmcp.com/sse';
const BATCH_SIZE = 200;

const QUERIES = {
  group1: {
    label: 'Group 1 — Currently tiered + all Closed Lost',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND (ABX_Tier__c != null OR Account_Stage__c = 'Closed Lost') ORDER BY Name`,
  },
  group2: {
    label: 'Group 2 — Prospect candidates (no tier)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Prospect' ORDER BY Name`,
  },
  group3: {
    label: 'Group 3 — Old Closed Lost candidates (no tier, before Aug 1 2025)',
    soql: `SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Closed Lost' AND Entered_Closed_Lost_Date__c < 2025-08-01 ORDER BY Name`,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse SOQL records from a tool result content string.
 * The MCP tool returns JSON with a records array.
 */
function parseRecords(text) {
  try {
    // Try to extract JSON object from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.records)) return parsed.records;
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

/**
 * Extract text content from MCP tool result blocks.
 */
function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return String(content);
}

/**
 * Run a single SOQL query via Anthropic + MCP, paginating until all records fetched.
 * Uses a single persistent Anthropic client with one MCP session.
 */
async function runQuery(client, mcpSession, groupKey, onProgress) {
  const query = QUERIES[groupKey];
  const allRecords = [];
  const seenIds = new Set();
  let offset = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const paginatedSoql = `${query.soql} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;

    onProgress(`  [${query.label}] Batch ${batchNum}, offset ${offset} — fetching...`);

    // Build the message asking Claude to run the SOQL via the MCP tool
    const messages = [
      {
        role: 'user',
        content: `Run this SOQL query using the run-soql tool and return the full JSON response with all records:\n\n${paginatedSoql}`,
      },
    ];

    let response;
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        tools: mcpSession.tools,
        messages,
      });
    } catch (err) {
      console.error(`  Error calling Anthropic API: ${err.message}`);
      throw err;
    }

    // Agentic loop: keep going until we get tool results back
    let loopMessages = [...messages];
    let loopResponse = response;
    let batchRecords = [];

    while (loopResponse.stop_reason === 'tool_use') {
      const assistantMsg = { role: 'assistant', content: loopResponse.content };
      loopMessages.push(assistantMsg);

      // Process all tool uses in this turn
      const toolResultBlocks = [];
      for (const block of loopResponse.content) {
        if (block.type !== 'tool_use') continue;

        let toolResult;
        try {
          toolResult = await mcpSession.callTool(block.name, block.input);
        } catch (err) {
          toolResult = { error: err.message };
        }

        const resultText =
          typeof toolResult === 'string'
            ? toolResult
            : JSON.stringify(toolResult);

        // Parse records from this tool result
        const parsed = parseRecords(resultText);
        batchRecords.push(...parsed);

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultText,
        });
      }

      loopMessages.push({ role: 'user', content: toolResultBlocks });

      // Continue the agentic loop
      loopResponse = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        tools: mcpSession.tools,
        messages: loopMessages,
      });
    }

    // If we didn't get records from tool results, try parsing final text response
    if (batchRecords.length === 0) {
      const finalText = extractText(loopResponse.content);
      batchRecords = parseRecords(finalText);
    }

    // Deduplicate
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

    // If we got fewer than BATCH_SIZE records, we've reached the end
    if (batchRecords.length < BATCH_SIZE) {
      break;
    }

    offset += BATCH_SIZE;
    // Small delay to avoid rate limits
    await sleep(500);
  }

  return allRecords;
}

/**
 * MCP session wrapper that manages tool definitions and tool calls
 * via the Anthropic SDK's MCP beta support.
 */
async function createMcpSession(client) {
  // Use Anthropic's MCP connector to get tools from the SSE server
  const mcpTools = await client.beta.mcp.listTools({
    server_url: MCP_SERVER_URL,
  });

  const tools = mcpTools.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  async function callTool(name, input) {
    const result = await client.beta.mcp.callTool({
      server_url: MCP_SERVER_URL,
      tool_name: name,
      tool_input: input,
    });
    return result;
  }

  return { tools, callTool };
}

/**
 * Main fetch function — fetches all three query groups and returns combined records.
 */
async function fetchAllAccounts(onProgress = console.log) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY not set in .env file');
  }

  const client = new Anthropic({ apiKey });

  onProgress('Connecting to Sweep MCP server...');
  const mcpSession = await createMcpSession(client);
  onProgress(`MCP connected. Available tools: ${mcpSession.tools.map((t) => t.name).join(', ')}`);

  const allRecords = [];
  const seenIds = new Set();

  for (const groupKey of ['group1', 'group2', 'group3']) {
    onProgress(`\nStarting ${QUERIES[groupKey].label}...`);
    const records = await runQuery(client, mcpSession, groupKey, onProgress);
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
