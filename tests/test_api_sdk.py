import types
import sys
import httpx
import pytest
from fastapi.testclient import TestClient
from agentbudget.api import create_app
from agentbudget.store import Store, BudgetExceeded
from agentbudget.sdk import BudgetClient, Task


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENTBUDGET_API_KEY", raising=False)
    return TestClient(create_app(Store(tmp_path / "api.sqlite")), headers={"X-AgentBudget-Client": "test"})


def test_api_demo_and_validation(client):
    r = client.post("/api/demo", json={"name": "demo", "agent": "test", "budget_usd": .025})
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert len(client.get("/api/snapshot").json()["runs"]) == 1
    assert client.post("/api/runs", json={"name": "", "agent": "x", "budget_usd": -.1}).status_code == 422
    assert client.get("/api/runs/missing").status_code == 404


def test_authentication_and_csrf_header(client, monkeypatch):
    client.headers.pop("X-AgentBudget-Client")
    assert client.get("/api/snapshot").status_code == 403
    monkeypatch.setenv("AGENTBUDGET_API_KEY", "test-only-key")
    assert client.get("/api/snapshot").status_code == 401
    assert client.get("/api/snapshot", headers={"Authorization": "Bearer test-only-key"}).status_code == 200


def test_api_conflict_and_usage(client):
    r = client.post("/api/runs", json={"name":"a","agent":"b","budget_usd":.01}).json()
    c = client.post(f"/api/runs/{r['id']}/reserve", json={"amount_usd":.009}).json()
    assert client.post(f"/api/runs/{r['id']}/reserve", json={"amount_usd":.002}).status_code == 409
    assert client.post(f"/api/calls/{c['id']}/settle", json={"input_tokens":1,"output_tokens":0,"cached_tokens":2}).status_code == 400
    assert client.post(f"/api/calls/{c['id']}/settle", json={"input_tokens":10,"output_tokens":20}).status_code == 200


def fake_encoding(monkeypatch):
    monkeypatch.setitem(sys.modules,"tiktoken",types.SimpleNamespace(encoding_for_model=lambda _:types.SimpleNamespace(encode=lambda *a,**k:[1]*10)))


def test_denied_budget_never_contacts_provider(monkeypatch):
    fake_encoding(monkeypatch)
    class Denied:
        def request(self,*args,**kwargs):
            raise BudgetExceeded("blocked")
    def forbidden(*args,**kwargs):
        raise AssertionError("Provider must not be called")
    monkeypatch.setattr(httpx, "Client", forbidden)
    with pytest.raises(BudgetExceeded):
        Task(Denied(),"run").response("hello",api_key="test")


def test_sdk_records_usage_without_storing_prompt(monkeypatch):
    fake_encoding(monkeypatch)
    records=[]
    class Ledger:
        def request(self,method,path,**kwargs):
            records.append((path,kwargs))
            return {"id":"reservation"}
    transport=httpx.MockTransport(lambda req:httpx.Response(200,json={"usage":{"input_tokens":10,"output_tokens":20,"input_tokens_details":{"cached_tokens":5}},"output":[]}))
    real_client=httpx.Client
    monkeypatch.setattr(httpx,"Client",lambda **kwargs:real_client(transport=transport,**kwargs))
    Task(Ledger(),"run").response("private prompt",api_key="fake")
    assert records[1][1]["json"]["cached_tokens"]==5
    assert "private prompt" not in str(records)


def test_sdk_timeout_keeps_unknown_reservation(monkeypatch):
    fake_encoding(monkeypatch)
    paths=[]
    class Ledger:
        def request(self,method,path,**kwargs):
            paths.append(path)
            return {"id":"reserved"}
    def timeout(req):
        raise httpx.ReadTimeout("uncertain")
    real_client=httpx.Client
    monkeypatch.setattr(httpx,"Client",lambda **kwargs:real_client(transport=httpx.MockTransport(timeout),**kwargs))
    with pytest.raises(httpx.ReadTimeout):
        Task(Ledger(),"run").response("hello",api_key="fake")
    assert paths[-1]=="/api/calls/reserved/unknown"
