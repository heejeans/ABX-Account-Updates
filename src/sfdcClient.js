'use strict';

/**
 * sfdcClient.js — Salesforce REST API client
 *
 * Currently returns MOCK responses that log what would be sent.
 *
 * To connect to real Salesforce, add these to your .env and swap in the
 * commented-out blocks below:
 *
 *   SFDC_INSTANCE_URL=https://cloudzero.my.salesforce.com
 *   SFDC_CLIENT_ID=<Connected App consumer key>
 *   SFDC_CLIENT_SECRET=<Connected App consumer secret>
 *
 * The Apex endpoint this calls is defined in:
 *   ABXCampaignSyncController.cls  →  @RestResource(urlMapping='/abx/campaign-sync/*')
 */

const SFDC_INSTANCE_URL  = process.env.SFDC_INSTANCE_URL  || 'https://cloudzero.my.salesforce.com';
const SFDC_APEX_ENDPOINT = '/services/apexrest/abx/campaign-sync';

/**
 * Apply approved tier + campaign changes to Salesforce.
 *
 * @param {Array<{ accountId: string, action: 'Add'|'Remove'|'Reclassify', tier: string|null }>} changes
 * @returns {Promise<{ ok: boolean, added: number, removed: number, updated: number, mock: boolean }>}
 */
async function applyChanges(changes) {
  const payload = { changes };

  // ── TODO: replace this block with a real SFDC call when ready ───────────────
  //
  // const token = await getAccessToken();
  // const res   = await fetch(`${SFDC_INSTANCE_URL}${SFDC_APEX_ENDPOINT}`, {
  //   method:  'POST',
  //   headers: {
  //     'Authorization': `Bearer ${token}`,
  //     'Content-Type':  'application/json',
  //   },
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) {
  //   const text = await res.text();
  //   throw new Error(`SFDC ${res.status}: ${text}`);
  // }
  // const result = await res.json();        // { added, removed, updated }
  // return { ok: true, ...result, mock: false };
  //
  // ── end TODO ─────────────────────────────────────────────────────────────────

  // Mock: log the exact payload that would be sent, return simulated result
  console.log(`\n[sfdcClient] MOCK — would POST to ${SFDC_INSTANCE_URL}${SFDC_APEX_ENDPOINT}`);
  console.log(`[sfdcClient] Payload (${changes.length} changes):`);
  console.log(JSON.stringify(payload, null, 2));

  const added   = changes.filter((c) => c.action === 'Add').length;
  const removed = changes.filter((c) => c.action === 'Remove').length;
  const updated = changes.filter((c) => c.action === 'Reclassify').length;

  return { ok: true, added, removed, updated, mock: true };
}

/**
 * OAuth2 client_credentials token fetch.
 * Uncomment and wire up when connecting to real SFDC.
 *
 * @returns {Promise<string>} access token
 */
// async function getAccessToken() {
//   const params = new URLSearchParams({
//     grant_type:    'client_credentials',
//     client_id:     process.env.SFDC_CLIENT_ID,
//     client_secret: process.env.SFDC_CLIENT_SECRET,
//   });
//   const res = await fetch(`${SFDC_INSTANCE_URL}/services/oauth2/token`, {
//     method: 'POST',
//     body:   params,
//   });
//   if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
//   const { access_token } = await res.json();
//   return access_token;
// }

module.exports = { applyChanges };
