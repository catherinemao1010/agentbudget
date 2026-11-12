# AgentBudget

**Give an AI task a budget. See where every model request went.**

An MIT-licensed tool for tracking agent task costs, token usage, latency, and budget limits. Includes a full-stack dashboard, Python SDK, and MCP reporting plugin.

**[Open AgentBudget](https://agentbudget-catherine.peiyuchen2023.chatgpt.site/)** — actual Codex usage after collector setup, alongside clearly labeled SDK simulations.

Built with **React · TypeScript · Vite · Python · FastAPI · SQLite · MCP · Cloudflare Workers/R2**.

## Automatic actual Codex usage

**Connect the local collector once. No manual sync and no API key are needed.**

1. Use **Set up with Codex** on the setup page, send the prepared request, and let Codex handle installation after sign-in and consent. No user Terminal commands are needed in a supported local Mac session. Or ask the hosted **@AgentBudget** plugin to **“set up automatic tracking”**. It returns a setup link and account code. Or open [automatic tracking setup](https://agentbudget-catherine.peiyuchen2023.chatgpt.site/?setup=1).
2. Sign in with the same ChatGPT account as the plugin. Compare the account code before connecting.
3. Download the collector from the setup page, create **your own** collector key, and download your connection file. No source checkout or API key is required.
4. With Python 3.9+ installed, run this in Terminal (adjust filenames if your browser renamed them):

```bash
python3 ~/Downloads/agentbudget-collector.py setup --config-file ~/Downloads/agentbudget-connection.json
```

Review the scope and type `yes` to opt in. Setup verifies an initial upload and installs the background collector at login. Remove the downloaded connection JSON after setup; the imported key has owner-only permissions. Never share it with other users. Automatic installation currently supports macOS only.

Each user signs in and opts in separately. Installing or mentioning the plugin alone cannot access local usage. Setup sends recorded local history and new usage; after setup the website may be closed. The hosted plugin's `get_tracking_setup` is read-only and does not install software or create credentials.

For source-checkout users, the separate `configure --site URL` and `install` commands remain available.

On macOS, this installs a user LaunchAgent that starts at login and runs every 30 seconds while your Mac is awake. The website can be closed. Open Overview for actual counts, or ask the hosted `@AgentBudget` plugin for your actual Codex usage. The web page refreshes its usage report every 10 seconds. `get_spend_summary` returns `codex_usage` with source, coverage, `observed_at`, and `received_at`; `list_runs` and `get_run_details` continue to describe SDK/dashboard tasks, not Codex sessions.

```sh
python3 scripts/codex-collector.py status
python3 scripts/codex-collector.py once       # optional diagnostic
python3 scripts/codex-collector.py uninstall # stops automatic collection
```

Click **Disconnect collector** in Integrations to revoke uploads. Replacing a key also revokes the previous key. Only one collector per account is supported. Uninstall preserves usage history. To remove the local history and key, delete `~/Library/Application Support/AgentBudget` after uninstalling.

### Coverage and accurate accounting

- Reads per-response `token_usage_record` events in local Codex `sessions` and `archived_sessions`. It does not read login credentials, make paid model calls, or change Codex configuration. Older logs without these events are not supported; missing logs cannot be reconstructed. The latest 2,000 recorded sessions are retained in each cloud snapshot.
- Deduplicates response IDs across repeated events, forks, incremental scans, and restarts. Cumulative `token_count` events are intentionally ignored. Cached tokens are part of input; reasoning tokens are part of output, never added twice.
- Sends only model identifiers, counters, timestamps, and hashed session IDs. No prompts, responses, task titles, directory paths, or Codex credentials are uploaded. The local SQLite cache keeps only usage metadata and file cursors.
- **Actual price is unavailable**, not $0. Codex session records do not provide per-request subscription charges. The app does not invent a dollar price or claim to reproduce your invoice.
- Covers local Codex activity on the connected Mac. **Ordinary ChatGPT web chats, other computers, and cloud-only activity without local logs are not included.** Selecting `@AgentBudget` alone does not install the collector. The collector observes usage; it cannot block Codex requests or enforce subscription limits.
- A separate Python `BudgetClient` integration records instrumented API calls and estimated costs in the local ledger. SDK simulations remain explicitly labeled demo records. The hosted actual-usage panel is independent of demo date filters.

The collector key is write-only and stored locally with mode 0600. Hosted storage retains only its SHA-256 hash. User identity comes from the signed-in Sites session when pairing; uploads cannot choose another user's identity. Uploads require HTTPS and never follow redirects. Offline uploads retry automatically from durable local usage records. Rotating or revoking a key requires reconnecting the local collector.

## What works

- Task-level estimated USD budgets, checked before instrumented model requests.
- Atomic SQLite reservations across concurrent clients/processes; integer nanodollar accounting.
- Token usage, cached tokens, latency, outcomes, and versioned price snapshots.
- Dashboard filters, request traces, CSV export, editable task budgets, and free simulations.
- Text-only OpenAI Responses adapter for `gpt-4.1-mini-2025-04-14`.
- Three read-only MCP tools: spend summary, list runs, run details.
- Local plugin package and marketplace manifest. The optional collector install command creates a user LaunchAgent; it does not change Codex settings.

**Status:** v0.3.0 prototype. The hosted Site includes a private MCP plugin and per-user snapshot storage. Not published to PyPI or a public plugin directory. No adoption or performance claims are implied.

## Quick start

Requires Python 3.11+, Node.js 20.19+ or 22.12+, and pnpm 11+.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
pnpm install
pnpm build
agentbudget demo
agentbudget serve
```

Open **http://127.0.0.1:8000**. The dashboard opens in a clearly labeled browser demo. Choose **Integrations → Connect local API** to see your ledger, including the simulated run created above. The database defaults to `~/.local/share/agentbudget/ledger.sqlite`; set `AGENTBUDGET_DB` to override it.

For frontend development, run `pnpm dev` alongside `agentbudget serve`; Vite proxies `/api` to port 8000. API documentation is at `/docs`.

## Real model requests

Provide your own `OPENAI_API_KEY` in the environment. No key is required for demo simulations. No paid calls were made while validating this project.

```python
from agentbudget import BudgetClient

budget = BudgetClient()
try:
    with budget.task("explain_context_managers", limit_usd=0.05,
                     agent="Documentation agent") as task:
        result = task.response("Explain Python context managers.", max_output_tokens=256)
        print(result["output"])
finally:
    budget.close()
```

A *task* contains one or more *model requests* (also called API calls). Each request reserves its estimated maximum text-token cost. Settlement replaces that hold with the estimated cost of provider-reported usage. A budget denial raises `BudgetExceeded` before the next request is sent.

### What a budget does and does not guarantee

The SDK guards **only its own instrumented requests**. It cannot intercept unrelated requests, read ChatGPT/Codex subscription usage, or impose limits on their built-in model calls. Installing the MCP plugin does not change that.

The current adapter supports one fixed model, text input, standard service pricing, and a bounded output. It does not support streaming, tools, multimodal input, batch discounts, provider retries, or additional provider fees. Input tokens use tiktoken plus a framing margin; actual usage may exceed this estimate. Therefore, this is a control on **estimated task spending**, not a guarantee about the provider invoice. Settlement records overages rather than hiding them.

Price snapshot `openai-standard-2026-11-11`: $0.40 input / $0.10 cached input / $1.60 output per million tokens, from [the official model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini). Review rates before using real funds. Each recorded request retains its pricing version.

### Concurrency and uncertain outcomes

SQLite `BEGIN IMMEDIATE` serializes the check-and-reserve transaction, so multiple clients cannot reserve the same available funds. The database is intended for one machine and a single trusted workspace; network-mounted SQLite is unsupported.

Timeouts, provider errors, and settlement failures retain the reservation and mark the request unknown when possible. There is no automatic release or retry, because a timed-out provider request may still incur charges. Reconcile known usage through `POST /api/calls/{id}/settle`. Exact repeat settlements are idempotent; conflicting usage is rejected. Unresolved holds intentionally consume budget until reconciled. Do not report unknown amounts as zero actual billing.

## ChatGPT / Codex plugin

See [plugin/README.md](plugin/README.md). The local MCP server queries the same API and exposes read-only reports. Example requests after installation:

- “Use AgentBudget to show spending by agent.”
- “List failed AgentBudget runs.”
- “Inspect the model requests in run …”

The plugin excludes simulated data by default; explicitly request demo data when testing. It is not automatically installed or submitted to a public directory. Mention syntax and availability depend on the host and account.

## Security and data

The ledger stores task names, agent names, token counts, timing, outcomes, and costs. It does **not** store prompts, model responses, or provider API keys. Task names can still be sensitive; use appropriate names.

Local server binding is loopback-only by default. Without an API key, API requests require a client header and a local hostname; no cross-origin access is enabled. To bind beyond localhost, set `AGENTBUDGET_API_KEY`. Put internet deployments behind HTTPS and access controls. The local Python service has a single workspace and shared bearer token, not multi-tenant accounts or role-based permissions. Anyone with the token can modify its ledger. The local Python service does not implement rate limiting, per-user identity, retention policies, or OAuth. The hosted Site uses Sites authentication and isolates snapshots by authenticated user.

The dashboard holds an entered ledger token in memory only. It never requests the provider API key. Demo data is stored in browser localStorage. Google Fonts is used by the dashboard with local system-font fallbacks.

## Docker

```sh
# Set a long, random AGENTBUDGET_API_KEY in your environment first.
docker compose up --build
```

Open http://127.0.0.1:8000 and enter that ledger key in Integrations. The named volume persists the ledger. Docker startup contains no demo seeding and no model requests.

## Tests

```sh
python -m pytest -q
pnpm test:worker
pnpm build
```

Tests cover concurrent reservations, cache pricing, idempotent reconciliation, uncertain outcomes, API authorization and validation, and the SDK's refusal to contact the provider after budget denial. A protocol smoke test verifies MCP initialization, tool discovery, and an actual tool invocation against a test API.

## Architecture

```text
Your Python agent → BudgetClient → FastAPI → SQLite ledger
                          ↓
                  OpenAI Responses API

Browser dashboard ──────────────→ FastAPI
ChatGPT / Codex → MCP stdio tool → FastAPI
```

The hosted dashboard starts with browser-local synthetic records. The signed-in dashboard automatically saves changed records to per-user R2 storage while open, on every page. Hosted MCP tools read the latest saved records on each invocation, even when the dashboard is closed. Real request instrumentation and budget enforcement still run through the local Python SDK/API.

## Development priorities

Validate whether task budgets help developers before expanding the feature set. Candidate next steps: additional provider adapters, explicit task success feedback, PostgreSQL for multi-host deployments, and richer task outcome evaluations. These are not implemented features.

## License

MIT. See [LICENSE](LICENSE). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosted plugin

Sites provisions the private AgentBudget plugin when publishing the Worker with the `mcp` capability. Install/connect it in Plugins → Personal → Created by you, then select AgentBudget with `@` in a new chat. Open the dashboard while signed in; **Automatic sync** saves changes without a button. Simulations are excluded by default: explicitly ask to include demo runs.

The hosted read-only tools are `get_tracking_setup`, `get_spend_summary`, `list_runs`, and `get_run_details`. The local SDK server retains the three ledger reporting tools. The summary includes actual Codex usage from the connected collector and separate saved task estimates. If Codex usage is present, the combined cost is null (unknown), while `dashboard_usage` retains task estimates. They cannot read provider bills. Cached tokens are a subset of input tokens, not additional tokens.

Hosted data is isolated by the authenticated Site user ID supplied by Sites. The automatic sync API validates and whitelists fields, checks the same-origin request, and merges changes with conditional R2 writes to preserve unrelated concurrent edits. Existing cloud records load on startup; new browser seeds cannot overwrite them. Concurrent edits to the same run use the last successful save. It stores task names and usage metadata; no API keys or prompt/response bodies. The local Python service has separate authentication and storage. Self-hosting this Worker requires a trusted authentication gateway that strips client-supplied identity headers, and a BUCKET binding; do not expose it directly without that gateway.

Build: `pnpm build`. Worker tests: `pnpm test:worker`. The build embeds Vite assets in a standalone Worker module at `dist/server/index.js`. `worker/index.js` contains the open-source MCP implementation.

### Automatic sync boundaries

The dashboard saves changes within about two seconds and retries failed saves while open. Wait for **Up to date** before closing; unsaved changes cannot be uploaded from a closed browser. Plugin calls re-read storage and include both the last save time and current read time. A read does not invent a newer save time or collect the host chat’s token usage. The hosted plugin cannot reach a laptop’s local SDK ledger. The separate opt-in collector uploads Codex usage automatically even while the website is closed. The local stdio MCP server already queries that ledger directly on every call. Anonymous demo visitors stay browser-local; hosted cloud saves require sign-in.

### Deploy your own Site

The source hosting manifest intentionally omits the original deployment’s project ID. Register your own Site and set its `project_id` before deployment. Keep the `BUCKET` storage binding and `mcp` capability. The demo URL above is a separate deployment; cloning this repository does not connect your records to it.

## Daily usage, allowance and plan comparison

Overview now shows tokens for today in the connected Mac’s time zone, daily history, tokens since each recorded Codex reset window, remaining allowance percentage, extra-usage credit balance, and a pace-based forecast. The collector reads quota metadata from local Codex usage events; it never reads or uploads login tokens. Quota observations can become stale while Codex is idle, even when collector uploads continue. A percentage is not a fixed token balance.

Use `get_usage_insights` in the hosted plugin for the same reports. The existing collector must be updated for these additional fields. **Set up with Codex** can handle that update while preserving its existing connection. Browser sign-in and local execution permissions still apply; the button prepares a request rather than silently installing software.

Cost figures are current-rate **API-equivalent estimates**, not subscription invoices. Standard and Fast scenarios account for cached inputs and API long-context surcharges. Unknown models leave the estimate unavailable. Rates were checked against official OpenAI API and ChatGPT Learn pricing on 2026-11-12; taxes, tools, image generation, cache writes, regional prices and negotiated discounts are excluded.

The planner keeps subscriptions plus extra-usage credits separate from API pay-as-you-go. A fresh Codex reading automatically identifies the plan family. Plus is selected automatically using its published USD list price; Pro stays unresolved because the feed does not identify its $100/$200/$500 tier. A saved user selection overrides the automatic default. Credit balance does not reveal purchase price: enter your credit-pack offer once and it is saved privately. Subscription prices remain list-price scenarios, not invoices. Supply a verified alternative allowance multiple for upgrade comparisons. It uses the last seven complete local days and the observed quota pace to model a 30-day workload. Without those inputs it reports missing information instead of inventing the cheapest plan. Alternative capacity is not inferred from price. Shared usage outside this Mac and changes in model mix can affect forecasts.

Comparison preferences are saved per authenticated account. No purchases, upgrades or paid calls are performed by this calculator.

Hosted usage tools return a plain-language `report` (also `usage_report` on `get_spend_summary`) that leads with time to allowance exhaustion, the reset date, and a cheaper-plan verdict. Downgrade comparisons include modeled top-ups and state missing billing or allowance inputs. Exhaustion forecasts refer to included allowance, not paid credits or total access.
