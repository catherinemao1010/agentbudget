import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  Gauge,
  Layers3,
  Loader2,
  Play,
  Plug,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Wallet,
  X,
  Zap,
  Info,
  RefreshCw,
  Menu,
  CheckCircle2,
  AlertTriangle,
  Clock3,
} from "lucide-react";
import {
  agents,
  loadDemo,
  saveDemo,
  seed,
  simulate,
  usd,
  short,
  type Run,
} from "./data";
import "./style.css";
import { McpConnections } from "./McpConnections";
import { usePluginSync } from "./usePluginSync";
type Page = "Overview" | "Runs" | "Budgets" | "Integrations";
const pages = [
  { name: "Overview" as Page, icon: BarChart3 },
  { name: "Runs" as Page, icon: Layers3 },
  { name: "Budgets" as Page, icon: ShieldCheck },
  { name: "Integrations" as Page, icon: Plug },
];
const snippet = `from agentbudget import BudgetClient\n\nbudget = BudgetClient()\nwith budget.task("review_pr", limit_usd=0.05) as task:\n    response = task.response(\n        "Explain Python context managers",\n        max_output_tokens=256,\n    )`;
function App() {
  const [page, setPage] = useState<Page>("Overview"),
    [runs, setRuns] = useState<Run[]>(loadDemo),
    [mode, setMode] = useState<"demo" | "live">("demo");
  const pluginSync = usePluginSync(runs, setRuns);
  const [days, setDays] = useState(7),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [agent, setAgent] = useState("all");
  const [modal, setModal] = useState<"run" | "connect" | "help" | null>(null),
    [selected, setSelected] = useState<Run | null>(null),
    [editing, setEditing] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [key, setKey] = useState(""),
    [mobile, setMobile] = useState(false);
  const [name, setName] = useState("Review pull request #129"),
    [runAgent, setRunAgent] = useState(agents[0]),
    [limit, setLimit] = useState("0.025");
  const [tab, setTab] = useState<"Python SDK" | "Local MCP">(
    "Python SDK",
  );
  const filtered = useMemo(
    () =>
      runs.filter(
        (r) =>
          new Date(r.created_at).getTime() >=
            new Date(new Date().setHours(0, 0, 0, 0)).getTime() -
              (days - 1) * 86400000 &&
          (status === "all" || r.status === status) &&
          (agent === "all" || r.agent === agent) &&
          `${r.name} ${r.agent} ${r.id}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [runs, days, status, agent, query],
  );
  const calls = filtered.flatMap((r) => r.calls),
    spent = filtered.reduce((s, r) => s + r.spent_usd, 0),
    blocked = filtered.filter((r) => r.status === "blocked").length;
  const latency = calls.length
    ? calls.reduce((s, c) => s + c.latency_ms, 0) / calls.length
    : 0;
  const byAgent = Array.from(new Set(filtered.map((r) => r.agent)))
    .map((a) => ({
      name: a,
      value: filtered
        .filter((r) => r.agent === a)
        .reduce((s, r) => s + r.spent_usd, 0),
    }))
    .sort((a, b) => b.value - a.value);
  const budgetTotal = filtered.reduce((s, r) => s + r.budget_usd, 0),
    held = filtered.reduce((s, r) => s + r.reserved_usd, 0);
  const success = filtered.length
    ? Math.round(
        (filtered.filter((r) => r.status === "completed").length /
          filtered.length) *
          100,
      )
    : 0;
  useEffect(() => {
    if (mode === "demo") {
      try {
        saveDemo(runs);
      } catch {
        setError(
          "Browser storage is full. Your demo changes will not persist.",
        );
      }
    }
  }, [runs, mode]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-AgentBudget-Client": "dashboard",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) {
      let detail = "Could not connect to the local API.";
      try {
        detail = (await r.json()).detail || detail;
      } catch {}
      throw new Error(
        typeof detail === "string" ? detail : JSON.stringify(detail),
      );
    }
    return r.json();
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/snapshot");
      if (!Array.isArray(d.runs))
        throw new Error(
          "Start the AgentBudget API to connect. This hosted page is a standalone demo.",
        );
      setMode("live");
      setRuns(d.runs);
      setModal(null);
      setNotice("Connected to your AgentBudget ledger");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function runDemo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let r: Run;
      if (mode === "live")
        r = await api("/demo", "POST", {
          name,
          agent: runAgent,
          budget_usd: Number(limit),
        });
      else r = simulate(name, runAgent, Number(limit));
      setRuns([r, ...runs]);
      setModal(null);
      setSelected(r);
      setNotice("Simulation complete. No model API was called.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const value = Number(limit);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value < editing.spent_usd + editing.reserved_usd
    ) {
      setError("Budget must cover spent and reserved funds.");
      return;
    }
    setBusy(true);
    try {
      const updated =
        mode === "live"
          ? await api(`/runs/${editing.id}`, "PATCH", { budget_usd: value })
          : { ...editing, budget_usd: value };
      setRuns(runs.map((r) => (r.id === updated.id ? updated : r)));
      setEditing(null);
      setNotice("Task budget updated");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard");
    } catch {
      setError("Clipboard is unavailable. Select and copy the code instead.");
    }
  }
  function exportCsv() {
    const safe = (v: unknown) =>
      `"${String(v)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      [
        "run_id",
        "task",
        "agent",
        "status",
        "estimated_usd",
        "budget_usd",
        "model_requests",
        "input_tokens",
        "output_tokens",
        "cached_input_tokens",
        "total_tokens",
        "simulated",
        "created_at",
      ],
      ...filtered.map((r) => [
        r.id,
        r.name,
        r.agent,
        r.status,
        r.spent_usd.toFixed(6),
        r.budget_usd,
        r.calls.length,
        r.calls.reduce((s, c) => s + c.input_tokens, 0),
        r.calls.reduce((s, c) => s + c.output_tokens, 0),
        r.calls.reduce((s, c) => s + c.cached_tokens, 0),
        r.calls.reduce((s, c) => s + c.input_tokens + c.output_tokens, 0),
        r.is_demo,
        r.created_at,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(safe).join(",")).join("\n")], {
        type: "text/csv",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "agentbudget-runs.csv";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Filtered runs exported");
  }
  function navigate(p: Page) {
    setPage(p);
    setMobile(false);
    setQuery("");
    setStatus("all");
    setAgent("all");
  }
  const runButton = (
    <button
      className="primary"
      onClick={() => {
        setLimit("0.025");
        setModal("run");
        setError("");
      }}
    >
      <Play size={14} /> Run simulation
    </button>
  );
  return (
    <div className="app-shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          AgentBudget<span className="version">β</span>
        </a>
        <button className="workspace" onClick={() => setModal("connect")}>
          <span className="workspace-avatar">A</span>
          <span>
            <strong>Personal workspace</strong>
            <small>
              {mode === "demo" ? "Demo environment" : "Local API connected"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {pages.map((p) => (
            <button
              key={p.name}
              className={page === p.name ? "active" : ""}
              onClick={() => navigate(p.name)}
            >
              <p.icon size={18} />
              {p.name}
              {p.name === "Runs" && (
                <span className="nav-count">{runs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-logo">
            <ShieldCheck size={18} />
          </span>
          <strong>
            A little visibility.
            <br />A lot more control.
          </strong>
          <p>
            Give every agent a budget.
            <br />
            Make every token count.
          </p>
          <button onClick={() => navigate("Integrations")}>
            Connect your first agent <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("help")}>
            <Code2 size={17} />
            Open-source toolkit <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span>Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Self-hosted · v0.1.0</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-btn"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={18} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span className="mode-tag">
              <span />
              {mode === "demo" ? "Demo data" : "Live ledger"}
            </span>
            <button
              className="icon-btn"
              title="Refresh API data"
              aria-label="Refresh API data"
              onClick={() =>
                mode === "live"
                  ? refresh()
                  : setNotice(
                      "Demo data is stored in this browser. Run a simulation to add a task.",
                    )
              }
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
            </button>
            <span className="top-avatar">Y</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR AGENTS. YOUR BUDGET.</div>
              <h1>
                {page === "Overview"
                  ? "Every token accounted for."
                  : page === "Runs"
                    ? "Follow the work."
                    : page === "Budgets"
                      ? "Set the boundaries."
                      : "Bring your agents along."}
              </h1>
              <p>
                {page === "Overview"
                  ? "Understand your AI spend. Catch runaway tasks. Build with confidence."
                  : page === "Runs"
                    ? "Inspect model requests, tokens, costs, and outcomes for every task."
                    : page === "Budgets"
                      ? "Task-level limits that keep your agents on track."
                      : "A small integration. A clearer picture of every run."}
              </p>
            </div>
            <div className="heading-actions">
              {page === "Integrations" ? (
                <span className="pill">MIT licensed</span>
              ) : (
                <>
                  <button className="secondary" onClick={exportCsv}>
                    <ArrowDownToLine size={15} />
                    Export
                  </button>
                  {runButton}
                </>
              )}
            </div>
          </div>
          {mode === "demo" && (
            <div className="demo-banner">
              <span>
                <span className="demo-label">SANDBOX</span> You’re exploring
                simulated activity. No API keys or real charges.
              </span>
              <button onClick={() => navigate("Integrations")}>
                Connect your agent <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && !modal && !editing && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {page !== "Integrations" && (
            <div className="filterbar">
              <div className="segmented">
                {[7, 30].map((d) => (
                  <button
                    key={d}
                    className={days === d ? "selected" : ""}
                    onClick={() => setDays(d)}
                  >
                    Last {d} days
                  </button>
                ))}
              </div>
              <div className="filters">
                <select
                  aria-label="Filter by agent"
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="all">All agents</option>
                  {Array.from(new Set(runs.map((r) => r.agent))).map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                <span className="date-caption">
                  <Clock3 size={13} /> Last {days} calendar days
                </span>
              </div>
            </div>
          )}
          {page === "Overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="Estimated cost (USD)"
                  value={usd(spent)}
                  icon={<Wallet size={17} />}
                  foot={`${short(calls.reduce((s, c) => s + c.input_tokens + c.output_tokens, 0))} tokens processed`}
                  accent="green"
                />
                <Stat
                  label="Tokens used"
                  value={short(
                    calls.reduce(
                      (s, c) => s + c.input_tokens + c.output_tokens,
                      0,
                    ),
                  )}
                  icon={<Zap size={17} />}
                  foot={`${short(calls.reduce((s, c) => s + c.input_tokens, 0))} input · ${short(calls.reduce((s, c) => s + c.output_tokens, 0))} output`}
                />
                <Stat
                  label="Agent runs"
                  value={String(filtered.length)}
                  icon={<Layers3 size={17} />}
                  foot={`${success}% finished without errors`}
                />
                <Stat
                  label="Avg. request latency"
                  value={`${(latency / 1000).toFixed(2)}`}
                  unit="s"
                  icon={<Gauge size={17} />}
                  foot="Across recorded model requests"
                />
                <Stat
                  label="Budget stops"
                  value={String(blocked)}
                  icon={<ShieldCheck size={17} />}
                  foot="Tasks that hit their spending limit"
                  accent="amber"
                />
              </div>
              <div className="charts-grid">
                <section className="panel spend-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Spend over time</h2>
                      <p>Estimated model costs, by day</p>
                    </div>
                    <span className="chart-legend">
                      <i /> Estimated spend
                    </span>
                  </div>
                  <SpendChart runs={filtered} days={days} />
                </section>
                <section className="panel distribution">
                  <div className="panel-heading">
                    <div>
                      <h2>Spend by agent</h2>
                      <p>Where your tokens are going</p>
                    </div>
                    <span className="soft-icon">
                      <Activity size={17} />
                    </span>
                  </div>
                  <div className="agent-bars">
                    {byAgent.length ? (
                      byAgent.map((a, i) => (
                        <div key={a.name} className="agent-bar">
                          <div>
                            <span>
                              <i className={`agent-dot color-${i % 4}`} />
                              {a.name}
                            </span>
                            <strong>{usd(a.value, 3)}</strong>
                          </div>
                          <div className="track">
                            <i
                              className={`color-${i % 4}`}
                              style={{
                                width: `${spent ? (a.value / spent) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No recorded runs in this period.</p>
                    )}
                  </div>
                  <div className="distribution-total">
                    <span>Total estimated spend</span>
                    <strong>{usd(spent, 3)}</strong>
                  </div>
                </section>
              </div>
              <div className="budget-strip">
                <div className="shield-tile">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <strong>Your task budgets, at a glance</strong>
                  <p>
                    {usd(spent, 3)} spent · {usd(held, 3)} reserved ·{" "}
                    {usd(Math.max(0, budgetTotal - spent - held), 3)} available
                    across filtered tasks
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("Budgets")}
                >
                  Manage budgets <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          {(page === "Overview" || page === "Runs") && (
            <section className="panel runs-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {page === "Overview" ? "Recent runs" : "All runs"}{" "}
                    <span className="count">{filtered.length}</span>
                  </h2>
                  <p>A clear trail from task to token</p>
                </div>
                {page === "Overview" ? (
                  <button
                    className="text-button"
                    onClick={() => navigate("Runs")}
                  >
                    View all runs <ArrowRight size={14} />
                  </button>
                ) : (
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label="Search runs"
                      placeholder="Search tasks, agents, IDs…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="table-tabs">
                {["all", "completed", "blocked", "failed", "running"].map(
                  (s) => (
                    <button
                      key={s}
                      className={status === s ? "selected" : ""}
                      onClick={() => setStatus(s)}
                    >
                      {s === "all"
                        ? "All runs"
                        : s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ),
                )}
              </div>
              <RunTable
                runs={page === "Overview" ? filtered.slice(0, 6) : filtered}
                onSelect={setSelected}
              />
              <div className="table-footer">
                <span>
                  Showing{" "}
                  {Math.min(
                    filtered.length,
                    page === "Overview" ? 6 : filtered.length,
                  )}{" "}
                  of {filtered.length} runs
                </span>
                <span>USD · estimates, not invoices</span>
              </div>
            </section>
          )}
          {page === "Budgets" && (
            <>
              <div className="budget-intro">
                <Info size={18} />
                <p>
                  Each task has its own spending limit. The SDK reserves funds
                  before a model call and reconciles actual token usage
                  afterward. Unknown provider outcomes keep their reservation.
                </p>
              </div>
              <div className="budget-cards">
                {filtered.map((r) => (
                  <section className="panel budget-card" key={r.id}>
                    <div className="budget-card-top">
                      <span className="soft-icon">
                        <ShieldCheck size={19} />
                      </span>
                      <Badge status={r.status} />
                    </div>
                    <h2>{r.name}</h2>
                    <p>
                      {r.agent} · {r.is_demo ? "Simulated" : "Instrumented"}
                    </p>
                    <div className="budget-amount">
                      <strong>{usd(r.spent_usd, 3)}</strong>
                      <span> / {usd(r.budget_usd, 3)}</span>
                    </div>
                    <div className="track">
                      <i
                        style={{
                          width: `${Math.min(100, ((r.spent_usd + r.reserved_usd) / r.budget_usd) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="budget-card-bottom">
                      <span>
                        {Math.round(
                          ((r.spent_usd + r.reserved_usd) / r.budget_usd) * 100,
                        )}
                        % committed
                      </span>
                      <button
                        onClick={() => {
                          setEditing(r);
                          setLimit(String(r.budget_usd));
                          setError("");
                        }}
                      >
                        Edit limit <SlidersHorizontal size={13} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              {!filtered.length && <Empty />}
            </>
          )}
          {page === "Integrations" && (
            <>
              <McpConnections sync={pluginSync} />
              <div className="integration-grid">
                <section className="panel setup-panel">
                  <div className="table-tabs">
                    {(["Python SDK", "Local MCP"] as const).map((t) => (
                      <button
                        className={tab === t ? "selected" : ""}
                        onClick={() => setTab(t)}
                        key={t}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {tab === "Python SDK" ? (
                    <>
                      <h2>Give your next task a budget.</h2>
                      <p>
                        Install from the source checkout, start the local API,
                        and instrument calls.
                      </p>
                      <Code
                        text={"python -m pip install -e .\nagentbudget serve"}
                        onCopy={copy}
                      />
                      <Code text={snippet} onCopy={copy} />
                      <div className="integration-note">
                        <Info size={16} />
                        <span>
                          Requires your own OpenAI API key for real calls.
                          Supports text-only GPT-4.1 mini Responses calls. Demo
                          simulations are free.
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2>Your spending, a conversation away.</h2>
                      <p>
                        The included MCP server exposes three read-only tools
                        for your tracked runs.
                      </p>
                      <div className="tool-list">
                        <span>
                          <Check size={15} />
                          get_spend_summary
                        </span>
                        <span>
                          <Check size={15} />
                          list_runs
                        </span>
                        <span>
                          <Check size={15} />
                          get_run_details
                        </span>
                      </div>
                      <Code
                        text={
                          "codex mcp add agentbudget -- /absolute/path/to/.venv/bin/agentbudget-mcp"
                        }
                        onCopy={copy}
                      />
                      <blockquote>
                        “Use AgentBudget to show which tracked agent spent the
                        most.”
                      </blockquote>
                      <p className="integration-note">
                        The source includes a plugin manifest and local
                        marketplace. Install it in a compatible host to make it
                        selectable. It does not read or limit ChatGPT/Codex’s
                        internal billing.
                      </p>
                    </>
                  )}
                </section>
                <div>
                  <section className="panel connection-card">
                    <span className="soft-icon">
                      <Plug size={22} />
                    </span>
                    <h2>Connect your local ledger</h2>
                    <p>
                      Run the API and open the dashboard it serves. Your browser
                      and API must share an origin.
                    </p>
                    <label>
                      API key <span className="muted">(if configured)</span>
                      <input
                        type="password"
                        placeholder="Kept in memory for this session"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      className="primary full"
                      onClick={refresh}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <Plug size={16} />
                      )}
                      Connect local API
                    </button>
                    <small>
                      {mode === "live"
                        ? "Connected to the local ledger."
                        : "Open your local dashboard to connect to the Python ledger."}
                    </small>
                  </section>
                  <section className="open-source-card">
                    <Code2 size={23} />
                    <h3>Open source. Yours to run.</h3>
                    <p>
                      MIT licensed. No hosted account required. No prompts or
                      API keys stored in the ledger.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setModal("help")}
                    >
                      Explore the toolkit <ArrowUpRight size={14} />
                    </button>
                  </section>
                </div>
              </div>
            </>
          )}
          <div className={"auto-sync-status " + pluginSync.state} role="status">{pluginSync.state === "saved" ? "✓ Auto-sync on" : pluginSync.message}</div>
          <footer>
            <span>
              <Activity size={13} /> AgentBudget{" "}
              <span className="footer-dot">·</span> Build freely. Spend
              deliberately.
            </span>
            <span>
              v0.1.0 <span className="footer-dot">·</span> MIT licensed
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {modal === "run" && (
        <Modal title="Run a budget simulation" close={() => setModal(null)}>
          <p className="muted">
            Watch a task make simulated model requests until it finishes or
            reaches its budget. No API key needed.
          </p>
          <form onSubmit={runDemo}>
            <label>
              Task name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
            <label>
              Agent
              <select
                value={runAgent}
                onChange={(e) => setRunAgent(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label>
              Task budget (USD)
              <input
                type="number"
                min="0.000001"
                max="1000000"
                step="any"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                required
              />
            </label>
            <div className="hint">
              <ShieldCheck size={16} /> Try $0.025 to see a budget stop, or
              $0.10 to finish.
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Play size={15} />
              )}
              Start simulation
            </button>
          </form>
        </Modal>
      )}
      {modal === "connect" && (
        <Modal title="Choose your environment" close={() => setModal(null)}>
          <div className="environment-choice">
            <h3>Demo workspace</h3>
            <p>Explore sample runs. Changes stay in your browser.</p>
            <button
              className="secondary"
              onClick={() => {
                setMode("demo");
                setRuns(loadDemo());
                setModal(null);
              }}
            >
              Use demo data
            </button>
          </div>
          <div className="environment-choice">
            <h3>Local ledger</h3>
            <p>Connect to the backend serving this dashboard.</p>
            <label>
              API key (if configured)
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button className="primary" onClick={refresh} disabled={busy}>
              Connect API
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Small toolkit. Real control."
          close={() => setModal(null)}
        >
          <p>
            AgentBudget v0.1.0 is an MIT-licensed, self-hosted developer
            toolkit.
          </p>
          <ul className="help-list">
            <li>
              <CheckCheck size={17} />
              React + TypeScript dashboard
            </li>
            <li>
              <CheckCheck size={17} />
              Python SDK + FastAPI backend
            </li>
            <li>
              <CheckCheck size={17} />
              SQLite ledger with atomic reservations
            </li>
            <li>
              <CheckCheck size={17} />
              Read-only MCP plugin for tracked runs
            </li>
          </ul>
          <p className="muted">
            Source, Docker setup, examples, tests, and installation instructions
            are included in your project checkout. This release has not been
            published to GitHub or a plugin directory.
          </p>
          <button
            className="secondary full"
            onClick={() => {
              setRuns(seed());
              setMode("demo");
              setModal(null);
              setNotice("Demo workspace reset");
            }}
          >
            Reset demo workspace
          </button>
        </Modal>
      )}
      {editing && (
        <Modal title="Edit task budget" close={() => setEditing(null)}>
          <p>{editing.name}</p>
          <form onSubmit={saveBudget}>
            <label>
              Budget in USD
              <input
                type="number"
                min="0.000001"
                max="1000000"
                step="any"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                required
              />
            </label>
            <p className="muted">
              Already committed:{" "}
              {usd(editing.spent_usd + editing.reserved_usd, 6)}. Increasing a
              limit does not automatically restart a task.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              Save budget
            </button>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title="Run details" close={() => setSelected(null)} wide>
          <div className="run-detail-heading">
            <div>
              <h2>{selected.name}</h2>
              <p>
                {selected.agent} · {selected.id} ·{" "}
                {selected.is_demo ? "Simulated data" : "SDK instrumented"}
              </p>
            </div>
            <Badge status={selected.status} />
          </div>
          <div className="detail-stats">
            <div>
              <span>Tokens used</span>
              <strong>
                {selected.calls
                  .reduce((s, c) => s + c.input_tokens + c.output_tokens, 0)
                  .toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Estimated cost</span>
              <strong>{usd(selected.spent_usd, 5)}</strong>
            </div>
            <div>
              <span>Task budget</span>
              <strong>{usd(selected.budget_usd, 3)}</strong>
            </div>
            <div>
              <span>Reserved</span>
              <strong>{usd(selected.reserved_usd, 5)}</strong>
            </div>
          </div>
          {selected.status === "blocked" && (
            <div className="hint">
              <ShieldCheck size={17} />
              {selected.spent_usd > selected.budget_usd
                ? "Reported usage exceeded the estimate. The overage is recorded; further requests are blocked."
                : "The next request did not fit the task budget. No additional request was started."}
            </div>
          )}
          <div className="call-timeline">
            {selected.calls.map((c, i) => (
              <div className="call-row" key={c.id}>
                <span className="call-index">{i + 1}</span>
                <div>
                  <strong>{c.model}</strong>
                  <small>
                    {short(c.input_tokens)} input · {short(c.output_tokens)}{" "}
                    output · {short(c.cached_tokens)} cached
                  </small>
                  {c.note && <small>{c.note}</small>}
                </div>
                <span>{(c.latency_ms / 1000).toFixed(2)}s</span>
                <strong>{usd(c.cost_usd, 5)}</strong>
                <Badge status={c.status} />
              </div>
            ))}
          </div>
          {!selected.calls.length && (
            <p className="muted">No model requests were started.</p>
          )}
          <p className="detail-foot">
            Token-based estimates · Pricing snapshot: 2026-11-11 · Excludes
            provider tool fees
          </p>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  unit,
  icon,
  foot,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  foot: string;
  accent?: string;
}) {
  return (
    <section className={`stat-card ${accent || ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className="stat-foot">
        {accent === "green" ? (
          <span className="stat-dot" />
        ) : accent === "amber" ? (
          <ShieldCheck size={12} />
        ) : null}
        {foot}
      </div>
    </section>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {status === "blocked"
        ? "Budget stopped"
        : status === "unknown"
          ? "Unresolved"
          : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
function RunTable({
  runs,
  onSelect,
}: {
  runs: Run[];
  onSelect: (r: Run) => void;
}) {
  return runs.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Task / agent</th>
            <th>Status</th>
            <th>Requests</th>
            <th>Tokens used</th>
            <th>Est. cost (USD)</th>
            <th>Budget used</th>
            <th>Started</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <button className="task-link" onClick={() => onSelect(r)}>
                  <span className="task-icon">
                    <Terminal size={16} />
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.agent}
                      {r.is_demo ? " · demo" : ""}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              <td className="numeric">{r.calls.length}</td>
              <td
                className="numeric"
                title={`${r.calls.reduce((s, c) => s + c.input_tokens, 0).toLocaleString()} input + ${r.calls.reduce((s, c) => s + c.output_tokens, 0).toLocaleString()} output`}
              >
                {short(
                  r.calls.reduce(
                    (s, c) => s + c.input_tokens + c.output_tokens,
                    0,
                  ),
                )}
              </td>
              <td className="cost-cell">{usd(r.spent_usd, 3)}</td>
              <td>
                <div className="table-budget">
                  <div className="track">
                    <i
                      className={r.status === "blocked" ? "amber" : ""}
                      style={{
                        width: `${Math.min(100, (r.spent_usd / r.budget_usd) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{Math.round((r.spent_usd / r.budget_usd) * 100)}%</span>
                </div>
              </td>
              <td className="time-cell">
                {new Date(r.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </td>
              <td>
                <button
                  className="icon-btn"
                  aria-label={`Inspect ${r.name}`}
                  onClick={() => onSelect(r)}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
function Empty() {
  return (
    <div className="empty">
      <Layers3 size={28} />
      <h3>No runs to show</h3>
      <p>Change your filters or run a simulation to get started.</p>
    </div>
  );
}
function SpendChart({ runs, days }: { runs: Run[]; days: number }) {
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toLocaleDateString();
    return {
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: runs
        .filter((r) => new Date(r.created_at).toLocaleDateString() === key)
        .reduce((s, r) => s + r.spent_usd, 0),
    };
  });
  const max = Math.max(...daily.map((d) => d.value), 0.01) * 1.2;
  const x = (i: number) => 54 + (i / (days - 1)) * 620,
    y = (v: number) => 178 - (v / max) * 142;
  const line = daily
    .map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`)
    .join(" ");
  return (
    <div className="chart-wrap">
      <svg
        viewBox="0 0 700 225"
        role="img"
        aria-label={`Daily estimated spending for the last ${days} days`}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4c9b7a" stopOpacity=".22" />
            <stop offset="100%" stopColor="#4c9b7a" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="54"
              x2="676"
              y1={36 + i * 47.33}
              y2={36 + i * 47.33}
              stroke="#e9ebe8"
              strokeDasharray="3 4"
            />
            <text x="0" y={40 + i * 47.33} className="chart-label">
              {usd(max * (1 - i / 3), 2)}
            </text>
          </g>
        ))}
        <path d={`${line} L674,178 L54,178 Z`} fill="url(#chartFill)" />
        <path
          d={line}
          fill="none"
          stroke="#368161"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {daily.map((d, i) => (
          <g key={i}>
            {(days === 7 || i % 5 === 0 || i === days - 1) && (
              <text
                x={x(i)}
                y="209"
                textAnchor="middle"
                className="chart-label"
              >
                {d.label}
              </text>
            )}
            <circle
              cx={x(i)}
              cy={y(d.value)}
              r="3"
              fill="#368161"
              stroke="white"
              strokeWidth="1.5"
            >
              <title>
                {d.label}: {usd(d.value, 4)}
              </title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
function Code({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  return (
    <div className="code-block">
      <button aria-label="Copy code" onClick={() => onCopy(text)}>
        <Copy size={15} />
      </button>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
