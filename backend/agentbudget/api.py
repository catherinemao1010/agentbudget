import os
import secrets
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .store import Store, BudgetExceeded


def create_app(store=None):
    ledger = store or Store()
    app = FastAPI(title="AgentBudget", version="0.1.0", description="Single-workspace cost ledger. Model calls must use the SDK to enforce task budgets.")

    def authorize(request: Request, x_agentbudget_client: str = Header(default=""), authorization: str = Header(default="")):
        token = os.getenv("AGENTBUDGET_API_KEY", "")
        if token:
            if not secrets.compare_digest(authorization, "Bearer " + token):
                raise HTTPException(401, "Valid AgentBudget API key required")
        else:
            host = request.url.hostname
            if host not in ("127.0.0.1", "localhost", "::1", "testserver"):
                raise HTTPException(403, "Remote access requires AGENTBUDGET_API_KEY")
            if not x_agentbudget_client:
                raise HTTPException(403, "AgentBudget client header required")

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse(status_code=404, content={"detail": "Run or call not found"})

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(BudgetExceeded)
    async def blocked(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": "0.1.0"}

    @app.get("/api/snapshot", dependencies=[Depends(authorize)])
    def snapshot():
        return ledger.snapshot()

    @app.post("/api/runs", dependencies=[Depends(authorize)])
    def create_run(body: RunInput):
        return ledger.create_run(**body.model_dump())

    @app.get("/api/runs/{run_id}", dependencies=[Depends(authorize)])
    def get_run(run_id: str):
        return ledger.run(run_id)

    @app.patch("/api/runs/{run_id}", dependencies=[Depends(authorize)])
    def update_run(run_id: str, body: RunUpdate):
        return ledger.update_run(run_id, **body.model_dump())

    @app.post("/api/runs/{run_id}/reserve", dependencies=[Depends(authorize)])
    def reserve(run_id: str, body: Reservation):
        return ledger.reserve(run_id, body.amount_usd)

    @app.post("/api/calls/{call_id}/settle", dependencies=[Depends(authorize)])
    def settle(call_id: str, body: Usage):
        return ledger.settle(call_id, **body.model_dump())

    @app.post("/api/calls/{call_id}/unknown", dependencies=[Depends(authorize)])
    def unknown(call_id: str):
        ledger.mark_unknown(call_id)
        return {"ok": True}

    @app.post("/api/demo", dependencies=[Depends(authorize)])
    def demo(body: RunInput):
        return ledger.demo_run(**body.model_dump())

    static = Path(os.getenv("AGENTBUDGET_STATIC", "dist"))
    if static.is_dir():
        app.mount("/", StaticFiles(directory=static, html=True), name="dashboard")
    return app


class RunInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    agent: str = Field(min_length=1, max_length=80)
    budget_usd: float = Field(gt=0, le=1_000_000, allow_inf_nan=False)


class RunUpdate(BaseModel):
    budget_usd: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)
    status: Literal["completed", "failed", "blocked"] | None = None


class Reservation(BaseModel):
    amount_usd: float = Field(gt=0, le=1_000_000, allow_inf_nan=False)


class Usage(BaseModel):
    input_tokens: int = Field(ge=0, le=10_000_000, strict=True)
    output_tokens: int = Field(ge=0, le=10_000_000, strict=True)
    cached_tokens: int = Field(default=0, ge=0, le=10_000_000, strict=True)
    latency_ms: int = Field(default=0, ge=0, le=86_400_000, strict=True)
