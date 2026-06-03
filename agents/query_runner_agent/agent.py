"""
QueryRunner agent — answers a plaintext question about the Lovelace
Knowledge Graph with a single, deterministically-checkable value.

Contract:
  - Input: one human-language question (e.g. "What is the official name of
    Apple?", "How many entities are linked to JP Morgan?").
  - Output: exactly one fenced ```json block of the form
        {"answer": <string | number | null>, "reasoning": "<brief>"}
    where `answer` is the single value that answers the question (a string
    for names/text, a number for counts/amounts), or null if unanswerable.

The agent is given ONE toolset: the `elemental-query` MCP server, which
exposes schema discovery, entity resolution, search, retrieval, and graph
traversal over the Elemental API. Every graph fact the agent uses flows
through those tools, so the agent's tool-call trace is a complete record of
how it navigated the graph — which is exactly what the QueryRunner harness
captures and judges against.

Why MCP-toolset passthrough (not hand-written Python tools): the whole point
of this app is to test and iterate on the MCP tool surface itself and to see
how the agent navigates it. The MCP server IS our curated tool layer.

URL + auth resolution for the MCP server:
  1. QUERY_MCP_URL env var (set at deploy to the Cloud Run URL of the
     elemental-query MCP server; or a local URL for `adk web` testing).
  2. broadchurch.yaml `mcp.elemental-query`.
  Custom MCP servers are reached at their direct Cloud Run URL with IAM auth
  (the platform gateway only proxies the four Lovelace platform servers), so
  for a *.run.app URL we attach a Google ID token for that audience as a
  Bearer header — minted PER REQUEST and cached until just before expiry
  (see `_GoogleIdTokenAuth`), so a long-lived deployment never sends a stale
  token. The deployment must also run as a service account that holds
  `roles/run.invoker` on the MCP service. Localhost URLs are called without auth.

Local testing:
    export QUERY_MCP_URL=http://127.0.0.1:8080/mcp   # local elemental-query
    export GOOGLE_CLOUD_PROJECT=broadchurch
    export GOOGLE_CLOUD_LOCATION=us-central1
    export GOOGLE_GENAI_USE_VERTEXAI=1
    cd agents && adk web
"""

import base64
import json
import logging
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import yaml
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

logger = logging.getLogger("query_runner_agent")

# The model is configurable so the harness can A/B different models without a
# code change. Default is gemini-2.5-flash (verified available in the tenant's
# Vertex project; gemini-3.1-flash returned 404 there).
MODEL = os.environ.get("QUERY_AGENT_MODEL", "gemini-2.5-flash")

MCP_SERVER_NAME = "elemental-query"


def _resolve_mcp_url() -> str:
    env_url = os.environ.get("QUERY_MCP_URL")
    if env_url:
        return env_url
    for candidate in (Path("broadchurch.yaml"), Path(__file__).parent / "broadchurch.yaml"):
        if candidate.exists():
            try:
                cfg = yaml.safe_load(candidate.read_text()) or {}
            except Exception:
                cfg = {}
            mcp_url = (cfg.get("mcp") or {}).get(MCP_SERVER_NAME)
            if mcp_url:
                return mcp_url
    return ""


def _needs_auth(url: str) -> bool:
    """Cloud Run (*.run.app) requires an IAM ID token; localhost/dev does not."""
    host = urlsplit(url).hostname or ""
    if host in ("localhost", "127.0.0.1"):
        return False
    return host.endswith(".run.app")


def _audience(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _jwt_exp(token: str) -> float | None:
    """Best-effort read of a JWT's `exp` claim (no signature verification)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        exp = json.loads(base64.urlsafe_b64decode(payload)).get("exp")
        return float(exp) if exp else None
    except Exception:
        return None


class _GoogleIdTokenAuth(httpx.Auth):
    """Attach a fresh Google-signed ID token (scoped to `audience`) to every request.

    The token is minted from the runtime's ambient credentials (the Agent
    Engine / Cloud Run service account, via the metadata server) and cached
    only until shortly before it expires. Minting per request — instead of
    once at import — is what keeps a long-lived agent from sending a stale
    token, the bug that left the deployed agent with zero MCP tools (401s).
    """

    _REFRESH_SKEW = 300  # refresh this many seconds before expiry

    def __init__(self, audience: str) -> None:
        self._audience = audience
        self._lock = threading.Lock()
        self._token: str | None = None
        self._exp = 0.0

    def _fetch(self) -> str | None:
        import google.auth.transport.requests
        import google.oauth2.id_token

        try:
            return google.oauth2.id_token.fetch_id_token(
                google.auth.transport.requests.Request(), self._audience
            )
        except Exception as exc:  # pragma: no cover - depends on runtime identity
            logger.error("Failed to mint ID token for MCP audience %s: %s", self._audience, exc)
            return None

    def _current(self) -> str | None:
        now = time.time()
        with self._lock:
            if self._token and now < self._exp - self._REFRESH_SKEW:
                return self._token
            token = self._fetch()
            if token:
                self._token = token
                self._exp = _jwt_exp(token) or (now + 1800)
            return token

    def auth_flow(self, request):  # httpx drives both sync + async via this
        token = self._current()
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        yield request


_MCP_URL = _resolve_mcp_url()
if not _MCP_URL:
    raise RuntimeError(
        "No elemental-query MCP URL. Set QUERY_MCP_URL or add mcp.elemental-query "
        "to broadchurch.yaml (deploy the elemental-query MCP server first with /deploy_mcp)."
    )


def _mcp_http_client_factory(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    auth: httpx.Auth | None = None,
) -> httpx.AsyncClient:
    """Build the httpx client MCP uses for the connection. For a Cloud Run URL
    we install the auto-refreshing ID-token auth so every request (including
    re-connects long after startup) carries a valid Bearer token; localhost
    gets a plain client."""
    if auth is None and _needs_auth(_MCP_URL):
        auth = _GoogleIdTokenAuth(_audience(_MCP_URL))
    kwargs: dict = {
        "follow_redirects": True,
        "timeout": timeout or httpx.Timeout(30.0, read=300.0),
    }
    if headers:
        kwargs["headers"] = headers
    if auth is not None:
        kwargs["auth"] = auth
    return httpx.AsyncClient(**kwargs)


_elemental_query = McpToolset(
    connection_params=StreamableHTTPConnectionParams(
        url=_MCP_URL,
        httpx_client_factory=_mcp_http_client_factory,
    )
)


INSTRUCTION = """\
You answer ONE factual question about the Lovelace Knowledge Graph and return
ONE value that can be checked for correctness automatically.

You have a single toolset: the elemental-query MCP server. Use ONLY these
tools for any graph fact — never guess or rely on prior knowledge. The tools:
  - list_entity_types(): all entity types (flavors) with descriptions.
  - get_entity_type_schema(flavor): properties available on an entity type.
  - search_properties(query): find a property by concept when unsure of its name.
  - get_property_detail(name): full detail for one property.
  - resolve_entity(name[, flavor]): name -> ranked matches (neid, name, flavor).
  - get_entity_properties(neid, [props]): property values for an entity.
  - find_entities(expression): advanced search via the Elemental expression language.
  - count_linked_entities(neid, direction[, relationship]): count graph links.
  - get_entity_name(neid): NEID -> canonical name.

How to navigate:
  1. If the question names an entity, resolve it FIRST with resolve_entity to
     get its NEID and canonical name. Prefer the top match. If a specific type
     is implied (a company, a person), pass `flavor`.
  2. If you need an attribute, find the right property: try the obvious name in
     get_entity_properties; if it's missing, use search_properties /
     get_entity_type_schema to discover the correct property name, then retry.
  3. Reference-typed values are returned already resolved to names — use them
     as-is. Never emit a raw NEID as the answer unless the question asks for an ID.
  4. For "how many" questions, use count_linked_entities (graph links) or
     find_entities, and answer with the integer count.

Output: end your reply with EXACTLY ONE fenced json block, nothing after it:
```json
{"answer": <value>, "reasoning": "<one or two sentences on how you got it>"}
```
Rules for `answer`:
  - A name/text answer is a JSON string (e.g. "Apple Inc.").
  - A count/amount answer is a JSON number (e.g. 42), not a string, no commas/units.
  - If you cannot determine the answer from the tools, use null.
Return only the single value that answers the question — no extra commentary
inside `answer`.
"""

root_agent = Agent(
    model=MODEL,
    name="query_runner_agent",
    instruction=INSTRUCTION,
    tools=[_elemental_query],
)


async def _probe_mcp_tools() -> int:
    """Log how many MCP tools registered — turns the silent zero-tools
    failure mode into one obvious log line at startup."""
    try:
        tools = await _elemental_query.get_tools()
        names = [getattr(t, "name", "?") for t in tools]
        logger.info("elemental-query MCP: %d tools registered: %s", len(names), names)
        return len(names)
    except Exception as exc:  # pragma: no cover - connection/auth/URL problems
        logger.error("elemental-query MCP probe failed: %s", exc)
        return 0
