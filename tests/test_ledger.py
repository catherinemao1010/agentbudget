from concurrent.futures import ThreadPoolExecutor
import pytest
from agentbudget.store import Store, BudgetExceeded, money, usage_cost, SCALE


@pytest.fixture
def ledger(tmp_path):
    return Store(tmp_path / "ledger.sqlite")


def test_cached_tokens_have_separate_price():
    assert usage_cost(1000, 100, 500) == 410000
    with pytest.raises(ValueError):
        usage_cost(10, 1, 11)


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-1", "1000001"])
def test_invalid_money_rejected(value):
    with pytest.raises(ValueError):
        money(value)


def test_reservation_denial_persists_outcome(ledger):
    r = ledger.create_run("test", "agent", .01)
    ledger.reserve(r["id"], .008)
    with pytest.raises(BudgetExceeded):
        ledger.reserve(r["id"], .003)
    assert ledger.run(r["id"])["status"] == "blocked"
    assert ledger.run(r["id"])["reserved_usd"] == .008


def test_independent_clients_cannot_oversubscribe(ledger):
    r = ledger.create_run("concurrency", "agent", .05)
    def attempt(_):
        try:
            Store(ledger.path).reserve(r["id"], .01)
            return True
        except BudgetExceeded:
            return False
    with ThreadPoolExecutor(max_workers=12) as pool:
        accepted = list(pool.map(attempt, range(30)))
    assert sum(accepted) == 5
    assert ledger.run(r["id"])["reserved_usd"] == .05


def test_settlement_frees_unused_reservation_and_is_idempotent(ledger):
    r = ledger.create_run("usage", "agent", .01)
    c = ledger.reserve(r["id"], .009)
    ledger.settle(c["id"], 1000, 100, 500)
    ledger.settle(c["id"], 1000, 100, 500)
    assert ledger.run(r["id"])["spent_usd"] == .00041
    assert ledger.run(r["id"])["total_tokens"] == 1100
    assert ledger.run(r["id"])["cached_input_tokens"] == 500
    assert ledger.run(r["id"])["reserved_usd"] == 0
    ledger.reserve(r["id"], .009)
    with pytest.raises(ValueError):
        ledger.settle(c["id"], 1001, 100, 500)


def test_unknown_call_retains_hold_until_reconciled(ledger):
    r = ledger.create_run("timeout", "agent", .01)
    c = ledger.reserve(r["id"], .01)
    ledger.mark_unknown(c["id"])
    with pytest.raises(BudgetExceeded):
        ledger.reserve(r["id"], .001)
    with pytest.raises(ValueError):
        ledger.update_run(r["id"], status="completed")
    ledger.settle(c["id"], 100, 100)
    assert ledger.run(r["id"])["reserved_usd"] == 0


def test_overage_is_recorded_and_blocks_future_requests(ledger):
    r = ledger.create_run("overage", "agent", .001)
    c = ledger.reserve(r["id"], .001)
    result = ledger.settle(c["id"], 10000, 1000)
    assert result["reservation_exceeded"]
    assert ledger.run(r["id"])["spent_usd"] > r["budget_usd"]
    with pytest.raises(BudgetExceeded):
        ledger.reserve(r["id"], .00001)


def test_budget_cannot_shrink_below_committed(ledger):
    r = ledger.create_run("limit", "agent", .1)
    ledger.reserve(r["id"], .05)
    with pytest.raises(ValueError):
        ledger.update_run(r["id"], budget_usd=.04)
    assert ledger.update_run(r["id"], budget_usd=.2)["budget_usd"] == .2


def test_closed_run_rejects_new_requests(ledger):
    r = ledger.create_run("closed", "agent", .1)
    ledger.update_run(r["id"], status="completed")
    with pytest.raises(ValueError):
        ledger.reserve(r["id"], .01)


def test_persistence_and_free_demo(ledger):
    r = ledger.demo_run()
    restored = Store(ledger.path).run(r["id"])
    assert restored["is_demo"] and restored["status"] == "blocked"
    assert restored["spent_usd"] == sum(c["cost_usd"] for c in restored["calls"])
