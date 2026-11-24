# StockPilot — Agentic AI-Assisted Inventory Management

MIS 6308 · Fall 2026 · Phase III prototype.

A store manager's inventory flow from **purchase request to put-away**, driven by AI agents that only **draft and recommend**, while deterministic rules and humans **decide**. Every AI action and human decision is written to the Agent Activity Log.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (mock AI mode, no API key needed)
npm test           # 41 domain unit tests + end-to-end demo-script test
npm run build      # type-check + production build to dist/
```

## Demo logins (password `demo123`)

| Role | Email |
|---|---|
| Store Manager | manager@stockpilot.demo |
| Receiving Clerk | clerk@stockpilot.demo |
| Stock Associate | associate@stockpilot.demo |
| Vendor (simulator) | vendor@stockpilot.demo |
| Regional Manager | regional@stockpilot.demo |

Use the **Role** dropdown in the header to jump between roles during a presentation.

## 90-second demo script

1. Sign in as Store Manager. Click **Run POS day** twice. Five items fall below their reorder point.
2. The Replenishment agent drafts two PRs. The paper PR (under $1,000) is **auto-approved**, and its PO is sent automatically. The dairy PR (about $3,900) waits for approval. Open it, read the AI rationale, edit one quantity, then **Approve**.
3. The PO screen shows the vendor scores. FreshFarm Dairy is cheapest, but its 7-day lead time exceeds days of cover, so it takes a −25 stock-out penalty. Click **Approve & send**.
4. Switch to **Vendor**. Click **Short 12 + 12 damaged**, then **Ship & send ASN**.
5. Switch to **Receiving Clerk**. Click **Receive** on the PO and enter 12 damaged on the first line. The live chips show **Short** and **Damaged**. Click **Submit receipt**.
6. Switch to **Store Manager** and open **Discrepancies**. Review the AI-drafted claim and the rule check on the credit amount, then **Approve & send**.
7. Switch to **Stock Associate** and open a put-away task. Type a wrong bin to see the warning, then the right bin, then **Confirm**.
8. **Inventory** shows the new on-hand. **Agent Log** shows the full trail (with CSV export), and **Database** shows every table.

## Architecture

```
src/
  domain/      Pure TypeScript rules + Vitest tests (never call the LLM)
               reorder.ts · approval.ts · vendors.ts · match.ts · putaway.ts
  agents/      prompts.ts (5 system prompts) · schemas.ts (zod) · mocks.ts · client.ts (single LLM entry point)
  services/    workflow.ts — orchestrates rules, agents and the database
  db/          Dexie (IndexedDB) schema + seed (30 SKUs, 46 bins, 5 vendors, 26 weeks of sales)
  sim/         Deterministic POS sales generator (weekday pattern + Thanksgiving bump)
  pages/       11 screens
netlify/functions/agent.ts   Serverless proxy to the Anthropic Messages API
```

**Controls enforced in code**
- Agents never write inventory, approve, or change limits. The Procurement agent's vendor, quantity and price must exactly match the in-house scoring, or they are ignored.
- Every agent response is validated with zod. If it is invalid, the app shows an error card and uses the rule-based result.
- Segregation of duties: a user cannot approve a PR they created (it escalates to the Regional Manager), and the PO approver cannot receive that PO.
- Inventory on hand changes only through POS sales and confirmed put-away to the correct bin.

## Live AI mode (optional)

1. Deploy to Netlify (the build settings are in `netlify.toml`).
2. Set these environment variables: `ANTHROPIC_API_KEY` (required) and `AGENT_MODEL` (default `claude-haiku-5-5`). Set `VITE_AGENT_MODE=live` to make live the default, or switch to **Live** under **Settings → AI agent mode**.
3. For local testing of the function, run `npx netlify dev`.

## Deployed link

_Add the Netlify URL here and in the report's Project Prototype section._
