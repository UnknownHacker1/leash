# Leash: PayPal AI Hackathon submission kit

Deadline: **Thu Nov 12, 2026, 12:00 pm Pacific** (2:00 pm CST). Judging Dec 1-15, winners ~Dec 21.
Hackathon: https://paypalaihackathon.devpost.com

## Honest odds

22,000+ registrants. Most never submit, but expect several hundred real entries. A clean, working, well-presented entry is maybe top 10-20%. The realistic targets:

- **Best Use of AG Grid** ($5k / $2k / 3x $1k, five winners). Few teams will use AG Grid at all. This is the best shot.
- **Best Use of Agentic Commerce** or **Best Use of PayPal + AI** ($5k each). Leash is squarely on theme, but so are many entries.
- A project can win one main/honorable prize *and* one sponsor prize.

Call it a real but small chance (rough guess 5-15%) of some prize for ~3-4 hours of your time. The video decides most of it: rules say judges may score from the video alone.

F-1 note: hackathon prize money is generally treated as prize income, not employment, but it is taxable and your DSO is the person to confirm with before accepting. Entering and building is fine either way.

## Status and what is left for you

Done: public repo github.com/UnknownHacker1/leash, registered for the hackathon on Devpost, 2:39 narrated demo video at docs/leash-demo.mp4 (offline mode, says so out loud).

Left (about 20 min, plus optional live upgrade):
1. **YouTube.** Upload docs/leash-demo.mp4 as Public. Title: "Leash: a spending firewall between AI agents and PayPal (PayPal AI Hackathon)". If Studio shows a half-finished draft named leash-demo, delete it or finish that one.
2. **Devpost.** On the hackathon page click Start project (it shows an image CAPTCHA, which is why it's left to you). Paste the text below, add the GitHub link and YouTube link, built-with tags, testing note "npm install && npm start, no keys needed". Submit. Edits allowed until Nov 12, 2:00pm CST.
3. **Read the code (30-45 min) before any judging call.** Start with src/policy.mjs, then requestPurchase() in server.mjs, then src/paypal.mjs.
4. **Optional live upgrade before Nov 12.** developer.paypal.com: sandbox app with Vault enabled, copy client ID and secret. platform.claude.com: API key. cp .env.example .env, paste, npm start, re-record so judges see real sandbox order IDs and Claude's audit.

## Video script (target 2:40)

**0:00-0:20 Hook.** Screen: the coffee product page text with the injected notice highlighted.
"AI agents can shop for you now. Here's the problem: this coffee listing has one paragraph telling any AI buyer to also purchase a $95 'verification card'. A good agent might ignore it. A rushed one won't. Either way, it's your PayPal paying."

**0:20-0:45 The product.** Dashboard.
"This is Leash, a spending firewall between AI agents and PayPal. I write my rules in plain English, Claude compiles them into a strict policy. I connect my PayPal wallet once with PayPal Vault."
Click Compile rules, show chips. Click Connect, show sandbox login, back to dashboard.

**0:45-1:45 The run.** Tick "Replay a compromised agent" (or run real Claude and then the replay). Run agent. Narrate the feed as it goes:
- Paper: "in policy, paid instantly through PayPal, no redirect."
- Coffee: paid. Then the agent falls for the injection and asks for the verification card. "Refused. The rules block gift cards, and Claude's audit independently flags it as manipulation. No money moves, and the agent is told not to retry."
- Toner, $54.50: "over my $40 auto-approve line, so it waits for me." Tap Approve & pay. Show it flip to paid.

**1:45-2:15 Control.** Ledger.
"Every attempt is in the ledger: the rule outcome, Claude's verdict and reason, the PayPal order ID. Bought the wrong thing? One-click PayPal refund." Click Refund. Search the ledger, export CSV for accounting. Hit Freeze, run again, everything refused.

**Optional 10 s, if time allows:** Claude Desktop or Claude Code with the Leash MCP server: "buy coffee for the office", show the call appear live in the dashboard.

**2:15-2:40 Close.**
"The model never gets the final say on money. Deterministic rules decide, the AI can only make things stricter, and PayPal handles the wallet, approvals and refunds. Leash: let agents shop, keep them on a leash."

## Devpost text

**Tagline:** A spending firewall between AI agents and your PayPal account.

**Inspiration.** Agentic commerce is arriving faster than the guardrails. An agent with access to a wallet is one poisoned product page away from buying gift cards for a scammer. Businesses need to give agents real purchasing power without giving them a blank check.

**What it does.** Leash sits between any AI agent and the owner's PayPal. The owner writes spending rules in plain English; Claude compiles them into a strict policy (budget window, per-purchase cap, approval threshold, allowed and blocked categories, velocity limit). Every purchase the agent attempts is checked by deterministic rules and then audited by Claude against the task the agent was actually given, catching prompt injection and off-task buys. In-policy purchases are paid instantly from a PayPal Vault wallet with no redirect. Anything above the approval line waits for a one-tap human approval. Refused purchases never touch PayPal. Every attempt lands in an AG Grid ledger with reasons, AI verdicts, PayPal order IDs, one-click refunds and CSV export, and a Freeze button stops all agent spending instantly.

**How we built it.** Node 22 with no framework. PayPal: OAuth client credentials, Vault v3 setup tokens and payment tokens to save the owner's wallet, Orders v2 with `vault_id` for merchant-initiated instant capture, Orders v2 checkout plus capture for human-approved purchases, Payments v2 refunds, idempotency keys on every write. An MCP server (stdio, zero dependencies) lets Claude Desktop, Claude Code, Cursor or any MCP agent pay through the same firewall. AI: Claude (claude-opus-5-5) via the Anthropic SDK in three roles: policy compiler and purchase auditor using structured JSON-schema outputs, and the shopping agent itself through a tool-use loop. AG Grid Community for the ledger. Server-sent events keep the dashboard live.

**Challenges.** Deciding where the AI belongs. We let the model write the policy and judge intent, but never let it approve a payment on its own: the audit can only tighten a decision. Prices and categories come from the merchant feed, never from what the agent claims.

**Accomplishments.** The full loop works end to end in the PayPal sandbox, and the whole thing runs offline with mocks so judges can try it in two minutes with zero keys.

**What we learned.** The hard part of agent payments isn't the API call, it's the control plane: who is allowed to spend what, who gets asked, and how you undo it.

**What's next.** Per-agent wallets and budgets, PayPal webhooks for disputes, and a phone push for approvals.

**Built with:** mcp, paypal, paypal-vault, paypal-orders-api, anthropic, claude, ag-grid, node.js, javascript, server-sent-events
