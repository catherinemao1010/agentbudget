# AgentBudget local plugin

This package exposes the AgentBudget ledger through a read-only MCP server. It is source-ready for local installation, not preinstalled or publicly listed.

## First run

From the repository root, follow the main README to install the Python package, build the dashboard, and start `agentbudget serve`. Keep that API running. Create an optional free demo run with `agentbudget demo`.

### Direct Codex MCP installation

Use the absolute executable path in your checkout:

```sh
codex mcp add agentbudget -- /absolute/path/to/agentbudget/.venv/bin/agentbudget-mcp
codex mcp list
```

This changes your Codex configuration only when you run it. No such command has been run by this project. The MCP server connects to `http://127.0.0.1:8000` by default. Set `AGENTBUDGET_URL` and `AGENTBUDGET_API_KEY` in its launch environment for another protected ledger. Do not place credentials in a committed manifest.

### Packaged plugin / @ selection

The repo includes `.agents/plugins/marketplace.json`, pointing to `./plugin`. It provides a local plugin catalog for compatible desktop hosts. `plugin.json` supplies the display name and skill; `mcp.json` launches the MCP executable. Ensure `agentbudget-mcp` is on the host process's PATH, or replace its command with the absolute executable path for your own installation. A desktop app may not inherit an activated terminal virtual environment.

Open the compatible host's plugin browser, install AgentBudget from the local catalog, and enable it. Once exposed by the host, select it with the host's plugin picker or mention interface. A bare MCP server registration may expose tools without creating a separately @-selectable plugin entry.

In ChatGPT on the web, a local stdio server is not a remote URL: use a supported secure tunnel or implement and deploy an authenticated HTTPS MCP endpoint. This repository does not provide a public remote endpoint, OAuth service, or directory submission. The private demo Site URL serves static UI only and must not be used as an MCP server URL.

Official references: [plugin packaging](https://developers.openai.com/plugins/build/plugins), [custom MCP connections](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Codex MCP configuration example](https://developers.openai.com/resources/docs-mcp).

## Try it

“Use AgentBudget to summarize my tracked spending.”

For the initial seeded data, explicitly ask: “Include demo records and show budget-stopped runs.”

Tools: `get_spend_summary(include_demo=False)`, `list_runs(status='all', limit=20, include_demo=False)`, `get_run_details(run_id)`.

Budget enforcement belongs to the SDK. The MCP plugin can read only the instrumented records, not host internal usage. A completed run means the SDK context finished without an exception; it is not a judgment of answer quality.
