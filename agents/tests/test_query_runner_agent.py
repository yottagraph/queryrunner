"""Tests for the query_runner_agent wiring.

Two layers:
  1. Pure logic — MCP URL resolution, IAM-auth header selection, model/agent
     construction. No network.
  2. Live wiring (the important one) — boots the real `elemental-query` MCP
     server as a subprocess over Streamable HTTP and asserts the agent's
     `McpToolset` connects and registers every tool. This is what catches the
     transport-mismatch class of bug: an SSE server (or wrong path) leaves the
     agent with ZERO tools and raises no error, so only an end-to-end check
     proves the agent can actually see its tools.

Run:  cd agents && pytest tests/test_query_runner_agent.py
"""

import asyncio
import importlib
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_PY = REPO_ROOT / "mcp-servers" / "elemental-query" / "server.py"

EXPECTED_TOOLS = {
    "health",
    "list_entity_types",
    "get_entity_type_schema",
    "search_properties",
    "get_property_detail",
    "resolve_entity",
    "get_entity_properties",
    "find_entities",
    "count_linked_entities",
    "get_entity_name",
}


def _import_agent(mcp_url: str):
    """(Re)import the agent module bound to `mcp_url`.

    The module resolves QUERY_MCP_URL and builds its McpToolset at import
    time, so we set the env first and reload to rebind to a new URL.
    """
    os.environ["QUERY_MCP_URL"] = mcp_url
    if "query_runner_agent.agent" in sys.modules:
        return importlib.reload(sys.modules["query_runner_agent.agent"])
    return importlib.import_module("query_runner_agent.agent")


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# --- pure logic -----------------------------------------------------------


def test_resolve_mcp_url_prefers_env(monkeypatch):
    agent = _import_agent("http://127.0.0.1:9/mcp")
    monkeypatch.setenv("QUERY_MCP_URL", "http://example.test/mcp")
    assert agent._resolve_mcp_url() == "http://example.test/mcp"


def test_missing_mcp_url_raises(monkeypatch):
    """No URL anywhere must fail loudly at import — not start a toolless agent."""
    monkeypatch.delenv("QUERY_MCP_URL", raising=False)
    agent = sys.modules.get("query_runner_agent.agent")
    if agent is None:
        agent = importlib.import_module("query_runner_agent.agent")
    monkeypatch.setattr(agent, "_resolve_mcp_url", lambda: "")
    with pytest.raises(RuntimeError):
        importlib.reload(agent)
    # restore a valid module for any later tests
    _import_agent("http://127.0.0.1:9/mcp")


def test_needs_auth_only_for_cloudrun():
    agent = _import_agent("http://127.0.0.1:9/mcp")
    assert agent._needs_auth("http://127.0.0.1:8080/mcp") is False
    assert agent._needs_auth("http://localhost:8080/mcp") is False
    # Only *.run.app gets an IAM bearer; other hosts are left unauthenticated.
    assert agent._needs_auth("https://mcp.internal.example.com/mcp") is False
    assert agent._needs_auth("https://elemental-query-abc.us-central1.run.app/mcp") is True


def test_audience_is_scheme_and_host():
    agent = _import_agent("http://127.0.0.1:9/mcp")
    assert (
        agent._audience("https://elemental-query-abc.us-central1.run.app/mcp")
        == "https://elemental-query-abc.us-central1.run.app"
    )


def test_localhost_factory_installs_no_auth():
    # Localhost MCP → the client factory must not attach Google ID-token auth.
    agent = _import_agent("http://127.0.0.1:9/mcp")
    client = agent._mcp_http_client_factory()
    try:
        assert client.auth is None
    finally:
        asyncio.run(client.aclose())


def test_id_token_auth_degrades_without_identity():
    # Without a GCP identity the mint fails and _current() returns None
    # (logged) — auth_flow must still yield a usable request, never raise.
    agent = _import_agent("http://127.0.0.1:9/mcp")
    auth = agent._GoogleIdTokenAuth("https://x.us-central1.run.app")
    req = httpx.Request("POST", "https://x.us-central1.run.app/mcp")
    list(auth.auth_flow(req))  # must not raise
    assert agent._jwt_exp("not.a.jwt") is None


def test_model_and_agent_identity(monkeypatch):
    agent = _import_agent("http://127.0.0.1:9/mcp")
    assert agent.MODEL  # non-empty default
    assert agent.root_agent.name == "query_runner_agent"
    assert agent.root_agent.model == agent.MODEL


def test_model_overridable_via_env(monkeypatch):
    monkeypatch.setenv("QUERY_AGENT_MODEL", "gemini-test-model")
    agent = _import_agent("http://127.0.0.1:9/mcp")
    assert agent.MODEL == "gemini-test-model"
    monkeypatch.delenv("QUERY_AGENT_MODEL", raising=False)


# --- live wiring (transport + tool registration end to end) ---------------


@pytest.fixture()
def running_mcp_server():
    """Start elemental-query over Streamable HTTP; yield its /mcp URL."""
    if not SERVER_PY.exists():
        pytest.skip(f"MCP server not found at {SERVER_PY}")
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_PY)],
        env={**os.environ, "PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.time() + 25
        while time.time() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read().decode() if proc.stdout else ""
                pytest.skip(f"MCP server exited early:\n{out}")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    break
            except OSError:
                time.sleep(0.3)
        else:
            pytest.skip("MCP server did not become ready in time")
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


def test_agent_registers_all_mcp_tools_over_streamable_http(running_mcp_server):
    agent = _import_agent(running_mcp_server)
    tools = asyncio.run(agent._elemental_query.get_tools())
    names = {getattr(t, "name", "?") for t in tools}
    assert names == EXPECTED_TOOLS, f"agent saw tools: {sorted(names)}"


def test_probe_reports_tool_count(running_mcp_server):
    agent = _import_agent(running_mcp_server)
    assert asyncio.run(agent._probe_mcp_tools()) == len(EXPECTED_TOOLS)
