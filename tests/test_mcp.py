import os
import json
import socket
import subprocess
import sys
import time
import anyio
import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from agentbudget.store import Store


def test_real_mcp_protocol_roundtrip(tmp_path):
    """Starts a test API and performs actual MCP handshake, discovery, invocation."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        port=sock.getsockname()[1]
    db=tmp_path / "mcp.sqlite"
    Store(db).demo_run()
    env={**os.environ,"AGENTBUDGET_DB":str(db),"AGENTBUDGET_URL":f"http://127.0.0.1:{port}","AGENTBUDGET_API_KEY":"test-mcp-token"}
    server=subprocess.Popen([sys.executable,"-c",f"import uvicorn; from agentbudget.api import create_app; uvicorn.run(create_app(),host='127.0.0.1',port={port},log_level='error')"],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/api/health").status_code==200:
                    break
            except httpx.TransportError:
                pass
            time.sleep(.05)
        else:
            raise AssertionError("Test API did not start")
        async def roundtrip():
            params=StdioServerParameters(command=sys.executable,args=["-m","agentbudget.mcp_server"],env=env)
            async with stdio_client(params) as (read,write):
                async with ClientSession(read,write) as session:
                    await session.initialize()
                    discovered=await session.list_tools()
                    assert {t.name for t in discovered.tools}=={"get_spend_summary","list_runs","get_run_details"}
                    result=await session.call_tool("get_spend_summary",{"include_demo":True})
                    assert not result.isError
                    assert json.loads(result.content[0].text)["run_count"]==1
                    assert json.loads(result.content[0].text)["total_tokens"] > 0
                    real_only=await session.call_tool("get_spend_summary",{})
                    assert json.loads(real_only.content[0].text)["run_count"]==0
        anyio.run(roundtrip)
    finally:
        server.terminate()
        server.wait(timeout=10)
