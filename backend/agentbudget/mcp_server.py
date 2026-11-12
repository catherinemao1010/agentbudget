"""Read-only MCP tools for records held by the AgentBudget API."""
from mcp.server.fastmcp import FastMCP
from .sdk import BudgetClient

mcp = FastMCP("AgentBudget", instructions="Report only AgentBudget instrumented usage. Costs are estimates, not provider invoices. Demo runs are simulated. No access to host ChatGPT/Codex billing or internal model calls.")


def request(path):
    client = BudgetClient()
    try:
        return client.request("GET", path)
    finally:
        client.close()


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False})
def get_spend_summary(include_demo: bool = False) -> dict:
    """Summarize estimated costs, reservations, and outcomes of tracked runs. Excludes simulated runs by default."""
    data = request("/api/snapshot")
    runs = [r for r in data["runs"] if include_demo or not r["is_demo"]]
    agents = {}
    for r in runs:
        agents[r["agent"]] = agents.get(r["agent"], 0) + r["spent_usd"]
    return {"scope": "AgentBudget tracked runs only", "estimated_spend_usd": sum(r["spent_usd"] for r in runs),
        "reserved_usd": sum(r["reserved_usd"] for r in runs), "run_count": len(runs),
        "input_tokens": sum(r["input_tokens"] for r in runs),
        "output_tokens": sum(r["output_tokens"] for r in runs),
        "cached_input_tokens": sum(r["cached_input_tokens"] for r in runs),
        "total_tokens": sum(r["total_tokens"] for r in runs),
        "by_agent": agents, "pricing_version": data["pricing_version"], "includes_demo": include_demo}


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False})
def list_runs(status: str = "all", limit: int = 20, include_demo: bool = False) -> list:
    """List tracked tasks with costs and outcomes. status: all, running, completed, failed, or blocked."""
    if status not in ("all", "running", "completed", "failed", "blocked") or not 1 <= limit <= 100:
        raise ValueError("Invalid status or limit (1–100)")
    runs = request("/api/snapshot")["runs"]
    return [{k: v for k, v in r.items() if k != "calls"} for r in runs
            if (include_demo or not r["is_demo"]) and (status == "all" or r["status"] == status)][:limit]


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False})
def get_run_details(run_id: str) -> dict:
    """Inspect one run's model calls, token counts, costs, and unresolved reservations."""
    if not run_id.isalnum() or len(run_id) > 64:
        raise ValueError("Invalid run id")
    return request("/api/runs/" + run_id)


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
