"""SQLite ledger. BEGIN IMMEDIATE serializes reservations across processes."""
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
from pathlib import Path

SCALE = 1_000_000_000
PRICE_VERSION = "openai-standard-2026-11-11"
MODEL = "gpt-4.1-mini-2025-04-14"
# USD per million tokens: input 0.40, cached input 0.10, output 1.60.
RATES = {"input": 400, "cached": 100, "output": 1600}  # nanodollars per token


def now():
    return datetime.now(timezone.utc).isoformat()


def money(value):
    d = Decimal(str(value))
    if not d.is_finite() or d < 0 or d > 1_000_000:
        raise ValueError("Amount must be finite and between $0 and $1,000,000")
    return int((d * SCALE).to_integral_value(rounding=ROUND_CEILING))


def usage_cost(input_tokens, output_tokens, cached_tokens=0):
    if min(input_tokens, output_tokens, cached_tokens) < 0 or cached_tokens > input_tokens:
        raise ValueError("Invalid token usage")
    return ((input_tokens - cached_tokens) * RATES["input"]
            + cached_tokens * RATES["cached"] + output_tokens * RATES["output"])


class BudgetExceeded(Exception):
    pass


class Store:
    def __init__(self, path=None):
        self.path = str(path or os.getenv("AGENTBUDGET_DB", Path.home() / ".local/share/agentbudget/ledger.sqlite"))
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
              CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, agent TEXT NOT NULL,
                budget INTEGER NOT NULL, spent INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'running', created_at TEXT NOT NULL,
                is_demo INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS calls (
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
                model TEXT NOT NULL, reserved INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'reserved', created_at TEXT NOT NULL,
                pricing_version TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
              CREATE INDEX IF NOT EXISTS calls_run ON calls(run_id);
            """)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        if write:
            db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            if write:
                db.commit()
        except Exception:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def create_run(self, name, agent, budget_usd, is_demo=False):
        budget = money(budget_usd)
        if budget <= 0:
            raise ValueError("Budget must be greater than zero")
        rid = uuid.uuid4().hex[:16]
        with self.connection(True) as db:
            db.execute("INSERT INTO runs(id,name,agent,budget,created_at,is_demo) VALUES(?,?,?,?,?,?)",
                       (rid, name, agent, budget, now(), int(is_demo)))
        return self.run(rid)

    def reserve(self, run_id, amount_usd, model=MODEL):
        amount = money(amount_usd)
        if amount <= 0:
            raise ValueError("Reservation must be positive")
        cid = uuid.uuid4().hex
        blocked = False
        with self.connection(True) as db:
            run = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not run:
                raise KeyError(run_id)
            if run["status"] not in ("running", "blocked"):
                raise ValueError("Run is closed")
            held = db.execute("SELECT COALESCE(SUM(reserved),0) FROM calls WHERE run_id=? AND status IN ('reserved','unknown')", (run_id,)).fetchone()[0]
            if run["spent"] + held + amount > run["budget"]:
                db.execute("UPDATE runs SET status='blocked' WHERE id=?", (run_id,))
                blocked = True
            else:
                db.execute("INSERT INTO calls(id,run_id,model,reserved,created_at,pricing_version) VALUES(?,?,?,?,?,?)",
                           (cid, run_id, model, amount, now(), PRICE_VERSION))
                db.execute("UPDATE runs SET status='running' WHERE id=?", (run_id,))
        if blocked:
            raise BudgetExceeded("Call blocked: estimated cost exceeds remaining task budget")
        return {"id": cid, "reserved_usd": amount / SCALE}

    def settle(self, call_id, input_tokens, output_tokens, cached_tokens=0, latency_ms=0):
        cost = usage_cost(input_tokens, output_tokens, cached_tokens)
        with self.connection(True) as db:
            call = db.execute("SELECT * FROM calls WHERE id=?", (call_id,)).fetchone()
            if not call:
                raise KeyError(call_id)
            if call["status"] == "completed":
                if (call["input_tokens"], call["output_tokens"], call["cached_tokens"]) != (input_tokens, output_tokens, cached_tokens):
                    raise ValueError("Settlement conflicts with existing usage")
                return {"cost_usd": call["cost"] / SCALE, "idempotent": True}
            if call["status"] not in ("reserved", "unknown"):
                raise ValueError("Call cannot be settled")
            db.execute("UPDATE calls SET cost=?,input_tokens=?,output_tokens=?,cached_tokens=?,latency_ms=?,status='completed' WHERE id=?",
                       (cost, input_tokens, output_tokens, cached_tokens, latency_ms, call_id))
            db.execute("UPDATE runs SET spent=spent+? WHERE id=?", (cost, call["run_id"]))
            db.execute("UPDATE runs SET status='blocked' WHERE id=? AND spent>budget", (call["run_id"],))
        return {"cost_usd": cost / SCALE, "reservation_exceeded": cost > call["reserved"]}

    def mark_unknown(self, call_id):
        with self.connection(True) as db:
            db.execute("UPDATE calls SET status='unknown',note='Provider outcome uncertain; budget hold retained until usage is reconciled.' WHERE id=? AND status='reserved'", (call_id,))

    def update_run(self, run_id, budget_usd=None, status=None):
        with self.connection(True) as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise KeyError(run_id)
            if budget_usd is not None:
                held = db.execute("SELECT COALESCE(SUM(reserved),0) FROM calls WHERE run_id=? AND status IN ('reserved','unknown')", (run_id,)).fetchone()[0]
                amount = money(budget_usd)
                if amount <= 0 or amount < row["spent"] + held:
                    raise ValueError("Budget cannot be below spent plus reserved funds")
                db.execute("UPDATE runs SET budget=? WHERE id=?", (amount, run_id))
            if status is not None:
                if status not in ("completed", "failed", "blocked"):
                    raise ValueError("Unsupported status")
                pending = db.execute("SELECT COUNT(*) FROM calls WHERE run_id=? AND status IN ('reserved','unknown')", (run_id,)).fetchone()[0]
                if status == "completed" and pending:
                    raise ValueError("Reconcile pending calls before completing this run")
                db.execute("UPDATE runs SET status=? WHERE id=?", (status, run_id))
        return self.run(run_id)

    def snapshot(self):
        with self.connection() as db:
            db.execute("BEGIN")
            rows = db.execute("SELECT * FROM runs ORDER BY created_at DESC").fetchall()
            calls = db.execute("SELECT * FROM calls ORDER BY created_at").fetchall()
        result = []
        for r in rows:
            cs = [dict(c) for c in calls if c["run_id"] == r["id"]]
            for c in cs:
                c["cost_usd"] = c.pop("cost") / SCALE
                c["reserved_usd"] = c.pop("reserved") / SCALE
            result.append({"id": r["id"], "name": r["name"], "agent": r["agent"],
                "budget_usd": r["budget"] / SCALE, "spent_usd": r["spent"] / SCALE,
                "reserved_usd": sum(c["reserved_usd"] for c in cs if c["status"] in ("reserved", "unknown")),
                "input_tokens": sum(c["input_tokens"] for c in cs),
                "output_tokens": sum(c["output_tokens"] for c in cs),
                "cached_input_tokens": sum(c["cached_tokens"] for c in cs),
                "total_tokens": sum(c["input_tokens"] + c["output_tokens"] for c in cs),
                "status": r["status"], "created_at": r["created_at"], "is_demo": bool(r["is_demo"]), "calls": cs})
        return {"runs": result, "pricing_version": PRICE_VERSION, "mode": "live"}

    def run(self, run_id):
        for r in self.snapshot()["runs"]:
            if r["id"] == run_id:
                return r
        raise KeyError(run_id)

    def demo_run(self, name="Review pull request #128", agent="Code reviewer", budget_usd=0.025):
        run = self.create_run(name, agent, budget_usd, is_demo=True)
        for i in range(8):
            try:
                c = self.reserve(run["id"], 0.007)
            except BudgetExceeded:
                break
            self.settle(c["id"], 6000 + i * 100, 1800, 1000, 1240 + i * 210)
        else:
            self.update_run(run["id"], status="completed")
        return self.run(run["id"])
