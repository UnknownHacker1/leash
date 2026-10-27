# Leash

**A spending firewall between AI agents and your PayPal account.**

AI agents can now shop for you. The scary part isn't the shopping, it's that one poisoned product page can talk an agent into buying a $95 "verification card" with your money. Leash sits between the agent and PayPal. Every purchase the agent attempts goes through two gates before any money moves:

1. **Your rules, compiled by Claude.** Write them in plain English ("$150 a week on office supplies, software and coffee, ask me over $40, never gift cards"). Claude turns that into a strict policy: budget window, per-purchase cap, approval threshold, allowed and blocked categories, velocity limit. The policy is enforced by plain deterministic code, not by the model.
2. **An AI audit of intent.** Claude checks each purchase against the task you actually gave the agent and flags prompt injection, off-task buys and cash-out items. The audit can only make a decision *stricter*. It can never approve something the rules refused.

Then one of three things happens:

| Outcome | What Leash does with PayPal |
|---|---|
| In policy | Pays instantly from your saved PayPal wallet (Vault v3 payment token, merchant-initiated Orders v2 capture). No redirect. |
| Needs you | Holds it in your queue. One tap approves and pays, or you go through normal PayPal checkout if no wallet is saved. |
| Refused | Nothing is charged. The agent is told why and told not to retry. |

Every attempt lands in an AG Grid ledger with the rule outcome, the AI verdict and reason, the PayPal order and capture IDs, and a one-click PayPal refund. A big red **Freeze** button stops all agent spending instantly.

## Run it (2 minutes, no keys needed)

Requires Node 22.9+.

```bash
git clone <this repo> && cd leash
npm install
npm start
```

Open http://localhost:8787, click **Connect PayPal wallet**, then **Run agent**.

With no keys, Leash runs fully offline and says so in the header: a mock PayPal, a scripted agent and a keyword heuristic in place of Claude. Every flow (pay, hold, refuse, approve, refund, freeze) works end to end.

## Run it for real (PayPal sandbox + Claude)

```bash
cp .env.example .env
```

Fill in:

- `ANTHROPIC_API_KEY`: from console.anthropic.com. Claude then compiles your rules, audits every purchase, and *is* the shopping agent (manual tool-use loop over `search_catalog`, `get_product`, `request_purchase`).
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: developer.paypal.com > Apps & Credentials > your **Sandbox** app. Under the app's features make sure **Vault** (save payment methods) is enabled.

`npm start`, then **Connect PayPal wallet** and log in with your sandbox *personal* (buyer) account to save it. Purchases now create real sandbox orders you can see in the sandbox merchant account.

A real agent may be too smart to fall for the planted injection. To show the firewall catching a compromised agent, tick **Replay a compromised agent**: it replays a run where the agent believes the coffee listing and tries to buy the "Merchant Verification Card".

## Use it from any agent (MCP)

`mcp.mjs` is a stdio MCP server, so Claude Desktop, Claude Code, Cursor or any MCP client can shop through the same firewall. Keep `npm start` running, then add to your client's MCP config:

```json
{ "mcpServers": { "leash": { "command": "node", "args": ["/path/to/leash/mcp.mjs"] } } }
```

Claude Code: `claude mcp add leash -- node /path/to/leash/mcp.mjs`. The agent gets `search_catalog`, `get_product` and `request_purchase`; every call shows up live in the dashboard as "external agent over MCP", and every purchase is checked and audited exactly like the built-in agent's.

## How it fits together

```
agent (Claude tool loop)  ──request_purchase──▶  Leash
                                                  ├─ price + category from the merchant feed (never from the agent)
                                                  ├─ policy.evaluate()      deterministic rules → allow / approve / deny
                                                  ├─ Claude audit           ok / suspicious / malicious (can only tighten)
                                                  └─ PayPal
                                                       allow   → Orders v2 with vault_id (instant capture)
                                                       approve → owner queue → vault charge or Orders v2 checkout + capture
                                                       refund  → Payments v2 captures/{id}/refund
```

| File | What it is |
|---|---|
| `src/policy.mjs` | The rules engine. Pure functions, unit tested. |
| `src/ai.mjs` | Claude: rule compiler (structured output), purchase auditor (structured output), shopping agent (tool use). Offline fallbacks. |
| `src/paypal.mjs` | PayPal sandbox client: OAuth, Vault v3 setup and payment tokens, Orders v2 create and capture, refunds. Plus a mock with the same interface. |
| `src/catalog.mjs` | Demo merchant feed, including one listing with a planted prompt injection. |
| `server.mjs` | Zero-framework Node server, JSON API, server-sent events for live updates. |
| `mcp.mjs` | MCP server (stdio, no dependencies) that lets any outside agent pay through Leash. |
| `public/cards.html` | Title and closing cards used in the demo video. |
| `public/` | Dashboard. AG Grid Community for the ledger (sorting, filters, quick search, pinned totals, change flashing, CSV export). |

Model: `claude-opus-5-5` by default (`LEASH_MODEL` to change), with server-side refusal fallback enabled.

## Recording a demo

`LEASH_SCRIPT_DELAY=<ms>` slows the scripted agent down, and `/?static` renders one snapshot of the dashboard without a live connection, which makes headless screenshots easy.

## Tests

```bash
npm test
```

## Why this matters

Agentic commerce is coming whether or not the guardrails are ready. Card networks and PayPal are building agent payment rails; what small businesses and individuals are missing is the control layer that answers "what is my agent allowed to do with my money, and who checks?" Leash is that layer: rules a non-technical owner can write, enforcement that doesn't trust the model, an AI second opinion that catches what rules can't express, and PayPal underneath for the money, the wallet, approvals and refunds.

## License

MIT
