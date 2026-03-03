# CloudZero ABX Tier Review

A local Node.js + React app for CloudZero's quarterly ABX tier review. Fetches account data from Salesforce via the Anthropic API + Sweep MCP server, applies the tiering framework locally, and presents an interactive review UI.

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

### 3. Build the React frontend

```bash
npm run build
```

### 4. Start the server

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Development

For backend-only development with nodemon:

```bash
npm run dev
```

For React hot-reload development (in a second terminal):

```bash
cd client && npm start
```

## Usage

1. Click **Fetch Salesforce Data** — this calls the Anthropic API with the Sweep MCP server attached and paginates through all three query groups. Progress is streamed in real time.
2. Review the account cards. Use the filter buttons and search box to find specific accounts.
3. **Approve ✓** or **Reject ✕** individual recommendations, or click **Approve All** to approve everything at once.
4. Click **Download Approved** to export a CSV of all approved changes.

## Architecture

```
ABX-Account-Updates/
├── src/
│   ├── server.js        Express API server (port 3000)
│   ├── fetchData.js     Anthropic + MCP data fetching with pagination
│   └── tieringLogic.js  Tiering matrix + action determination
├── client/
│   ├── src/
│   │   ├── App.js
│   │   └── components/
│   │       ├── FetchPanel.js   Loading screen with progress log
│   │       ├── Header.js       Sticky header with summary cards
│   │       ├── AccountList.js  Account card list
│   │       └── AccountCard.js  Individual account card with expand
│   └── public/
└── .env
```

## Tiering Logic

See `src/tieringLogic.js` for the full implementation. Key rules:

**Exclusions** (applied first): ParentId set · Company defunct · Qualified out · Consulting/IT filter · Stage in {Customer, Pipeline, Churned Customer, Competitor, Parent is Customer, Parent in Pipeline}

**Closed Lost routing:**
- Has tier + closed lost ≥ Aug 1 2025 → **Remove**
- No tier + closed lost ≥ Aug 1 2025 → **Ignore**
- Closed lost < Aug 1 2025 → evaluate tiering matrix (re-target)

**Tiering matrix:**
| Fit Score | High Intent | Medium Intent | Low Intent |
|-----------|-------------|---------------|------------|
| 11–12     | Tier 1      | Tier 2        | Tier 3     |
| 9–10      | Tier 2      | Tier 3        | Ignore     |
| 5–8       | Tier 3      | Ignore        | Ignore     |
| < 5       | Ignore      | Ignore        | Ignore     |

DNN/Marketplace Prospect + High Intent → minimum Tier 2.
