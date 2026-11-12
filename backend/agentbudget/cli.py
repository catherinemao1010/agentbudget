import argparse
import os


def main():
    parser = argparse.ArgumentParser(description="AgentBudget local server")
    parser.add_argument("command", choices=["serve", "demo"])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "demo":
        from .store import Store
        run = Store().demo_run()
        print(f"Created simulated run {run['id']}: {run['status']}, ${run['spent_usd']:.5f}. No provider called.")
    else:
        if args.host not in ("127.0.0.1", "localhost", "::1") and not os.getenv("AGENTBUDGET_API_KEY"):
            parser.error("Set AGENTBUDGET_API_KEY before exposing the server beyond localhost")
        import uvicorn
        from .api import create_app
        uvicorn.run(create_app(), host=args.host, port=args.port)
