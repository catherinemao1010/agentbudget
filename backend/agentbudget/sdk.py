"""Synchronous text-only OpenAI Responses adapter. No automatic retries."""
import os
import time
from contextlib import contextmanager
import httpx
from .store import BudgetExceeded, MODEL, SCALE, usage_cost


class BudgetClient:
    def __init__(self, base_url=None, api_key=None):
        self.http = httpx.Client(base_url=base_url or os.getenv("AGENTBUDGET_URL", "http://127.0.0.1:8000"),
            headers={"X-AgentBudget-Client": "python-sdk", "Authorization": "Bearer " + (api_key or os.getenv("AGENTBUDGET_API_KEY", ""))}, timeout=30)

    def request(self, method, path, **kwargs):
        response = self.http.request(method, path, **kwargs)
        if response.status_code == 409:
            raise BudgetExceeded(response.json()["detail"])
        response.raise_for_status()
        return response.json()

    def close(self):
        self.http.close()

    @contextmanager
    def task(self, name, limit_usd, agent="My agent"):
        run = self.request("POST", "/api/runs", json={"name": name, "agent": agent, "budget_usd": limit_usd})
        task = Task(self, run["id"])
        try:
            yield task
        except Exception as exc:
            try:
                self.request("PATCH", f"/api/runs/{task.id}", json={"status": "blocked" if isinstance(exc, BudgetExceeded) else "failed"})
            except Exception:
                pass  # Keep the original failure; unresolved holds remain in the ledger.
            raise
        else:
            self.request("PATCH", f"/api/runs/{task.id}", json={"status": "completed"})


class Task:
    def __init__(self, client, run_id):
        self.client, self.id = client, run_id

    def response(self, prompt: str, max_output_tokens=256, api_key=None):
        import tiktoken
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("A nonempty text prompt is required")
        if not isinstance(max_output_tokens, int) or isinstance(max_output_tokens, bool) or not 16 <= max_output_tokens <= 32768:
            raise ValueError("max_output_tokens must be between 16 and 32768")
        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("Set OPENAI_API_KEY before making a real model call")
        # Margin for message framing. Estimates are not a provider billing guarantee.
        input_bound = len(tiktoken.encoding_for_model("gpt-4.1-mini").encode(prompt, disallowed_special=())) + 64
        if input_bound + max_output_tokens > 1_000_000:
            raise ValueError("Prompt is too large")
        reservation = self.client.request("POST", f"/api/runs/{self.id}/reserve",
            json={"amount_usd": usage_cost(input_bound, max_output_tokens) / SCALE})
        started = time.monotonic()
        try:
            with httpx.Client(timeout=120) as provider:
                result = provider.post("https://api.openai.com/v1/responses", headers={"Authorization": "Bearer " + key},
                    json={"model": MODEL, "input": prompt, "max_output_tokens": max_output_tokens, "store": False})
                result.raise_for_status()
                data = result.json()
            usage = data["usage"]
            self.client.request("POST", f"/api/calls/{reservation['id']}/settle", json={
                "input_tokens": usage["input_tokens"], "output_tokens": usage["output_tokens"],
                "cached_tokens": usage.get("input_tokens_details", {}).get("cached_tokens", 0),
                "latency_ms": round((time.monotonic() - started) * 1000)})
            return data
        except Exception:
            try:
                self.client.request("POST", f"/api/calls/{reservation['id']}/unknown")
            except Exception:
                pass
            raise
