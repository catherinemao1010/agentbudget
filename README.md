# AgentBudget

**Give an AI task a budget. See where every model request went.**

An MIT-licensed tool for tracking agent task costs, token usage, latency, and budget limits. Includes a full-stack dashboard, Python SDK, and MCP reporting plugin.

**[Open AgentBudget](https://agentbudget-catherine.peiyuchen2023.chatgpt.site/)** — actual Codex usage after collector setup, alongside clearly labeled SDK simulations.

Built with **React · TypeScript · Vite · Python · FastAPI · SQLite · MCP · Cloudflare Workers/R2**.

## Automatic actual Codex usage

**Connect the local collector once. No manual sync and no API key are needed.**

1. Sign in to the hosted dashboard, open **Integrations**, and create a collector key.
2. From this checkout (Python 3.9+; no packages needed for the collector):

```sh
python3 scripts/codex-collector.py configure --site https://agentbudget-catherine.peiyuchen2023.chatgpt.site
# Paste your collector key at the hidden prompt.
python3 scripts/codex-collector.py install
```

If clipboard access is unavailable, use **Download connection file**, then run `python3 scripts/codex-collector.py configure --config-file /path/to/agentbudget-connection.json`. This file contains a private write-only key; remove the downloaded copy after importing it.

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

The three read-only tools are `get_spend_summary`, `list_runs`, and `get_run_details`. The summary includes actual Codex usage from the connected collector and separate saved task estimates. If Codex usage is present, the combined cost is null (unknown), while `dashboard_usage` retains task estimates. They cannot read provider bills. Cached tokens are a subset of input tokens, not additional tokens.

Hosted data is isolated by the authenticated Site user ID supplied by Sites. The automatic sync API validates and whitelists fields, checks the same-origin request, and merges changes with conditional R2 writes to preserve unrelated concurrent edits. Existing cloud records load on startup; new browser seeds cannot overwrite them. Concurrent edits to the same run use the last successful save. It stores task names and usage metadata; no API keys or prompt/response bodies. The local Python service has separate authentication and storage. Self-hosting this Worker requires a trusted authentication gateway that strips client-supplied identity headers, and a BUCKET binding; do not expose it directly without that gateway.

Build: `pnpm build`. Worker tests: `pnpm test:worker`. The build embeds Vite assets in a standalone Worker module at `dist/server/index.js`. `worker/index.js` contains the open-source MCP implementation.

### Automatic sync boundaries

The dashboard saves changes within about two seconds and retries failed saves while open. Wait for **Up to date** before closing; unsaved changes cannot be uploaded from a closed browser. Plugin calls re-read storage and include both the last save time and current read time. A read does not invent a newer save time or collect the host chat’s token usage. The hosted plugin cannot reach a laptop’s local SDK ledger. The separate opt-in collector uploads Codex usage automatically even while the website is closed. The local stdio MCP server already queries that ledger directly on every call. Anonymous demo visitors stay browser-local; hosted cloud saves require sign-in.

### Deploy your own Site

The source hosting manifest intentionally omits the original deployment’s project ID. Register your own Site and set its `project_id` before deployment. Keep the `BUCKET` storage binding and `mcp` capability. The demo URL above is a separate deployment; cloning this repository does not connect your records to it.
