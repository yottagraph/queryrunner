"""
Broadchurch agent auth — handles Elemental API config and authentication.

Lives at agents/broadchurch_auth.py and is automatically copied into each
agent directory at deploy time. During local dev (adk web from agents/),
it's importable directly since agents/ is on sys.path.

Usage in your agent code:

    try:
        from broadchurch_auth import elemental_client
    except ImportError:
        from .broadchurch_auth import elemental_client

    def my_tool() -> dict:
        resp = elemental_client.get("/elemental/metadata/schema")
        resp.raise_for_status()
        return resp.json()

Local dev:  set ELEMENTAL_API_URL and ELEMENTAL_API_TOKEN env vars.
Production: routes through the Broadchurch Portal gateway proxy, which
            handles QS authentication via Auth0 M2M tokens. The agent
            authenticates to the proxy with a per-tenant API key from
            broadchurch.yaml.
"""

import os
import time
from pathlib import Path

import httpx
import yaml

_config_cache: dict | None = None
_token_cache: dict = {"token": None, "expires_at": 0.0}


def _load_config() -> dict:
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    for candidate in [
        Path("broadchurch.yaml"),
        Path(__file__).parent / "broadchurch.yaml",
    ]:
        if candidate.exists():
            with open(candidate) as f:
                _config_cache = yaml.safe_load(f) or {}
                return _config_cache

    _config_cache = {}
    return _config_cache


def _uses_gateway_proxy() -> bool:
    """Return True if the gateway proxy is available (production path)."""
    if os.environ.get("ELEMENTAL_API_URL"):
        return False
    config = _load_config()
    gw = config.get("gateway", {})
    return bool(gw.get("url") and gw.get("qs_api_key"))


def _gateway_api_key() -> str:
    """Return the QS API key for the gateway proxy."""
    return _load_config().get("gateway", {}).get("qs_api_key", "")


def get_elemental_url() -> str:
    """Return the Elemental API base URL (no trailing slash).

    When the gateway proxy is available (broadchurch.yaml has gateway.url,
    tenant.org_id, and gateway.qs_api_key), routes through the portal
    proxy. Otherwise falls back to the direct QS URL.
    """
    url = os.environ.get("ELEMENTAL_API_URL")
    if url:
        return url.rstrip("/")

    config = _load_config()
    gw = config.get("gateway", {})
    gw_url = gw.get("url", "")
    org_id = config.get("tenant", {}).get("org_id", "")
    qs_api_key = gw.get("qs_api_key", "")

    if gw_url and org_id and qs_api_key:
        return f"{gw_url.rstrip('/')}/api/qs/{org_id}"

    url = config.get("query_server", {}).get("url", "https://stable-query.lovelace.ai")
    return url.rstrip("/")


def get_elemental_token() -> str:
    """Return a valid bearer token for the Elemental API.

    Local dev:   uses ELEMENTAL_API_TOKEN env var.
    Production:  returns empty string when using the gateway proxy (auth
                 is handled via X-Api-Key header instead).
    Fallback:    mints a GCP ID token if neither proxy nor env var is available.
    """
    static = os.environ.get("ELEMENTAL_API_TOKEN")
    if static:
        return static

    if _uses_gateway_proxy():
        return ""

    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]

    config = _load_config()
    audience = config.get("query_server", {}).get("audience", "queryserver:api")

    try:
        import google.auth.transport.requests
        import google.oauth2.id_token

        request = google.auth.transport.requests.Request()
        token = google.oauth2.id_token.fetch_id_token(request, audience)
    except Exception as e:
        raise RuntimeError(
            f"Failed to mint ID token for audience '{audience}'. "
            f"Set ELEMENTAL_API_TOKEN for local dev. Error: {e}"
        ) from e

    _token_cache["token"] = token
    _token_cache["expires_at"] = now + 3500
    return token


def get_auth_headers() -> dict[str, str]:
    """Return auth + content-type headers for Elemental API calls."""
    headers: dict[str, str] = {"Content-Type": "application/x-www-form-urlencoded"}
    if _uses_gateway_proxy():
        headers["X-Api-Key"] = _gateway_api_key()
    else:
        headers["Authorization"] = f"Bearer {get_elemental_token()}"
    return headers


class _ElementalClient:
    """Thin wrapper around httpx that injects auth and the base URL."""

    def __init__(self, timeout: float = 30.0):
        self._timeout = timeout

    @property
    def base_url(self) -> str:
        return get_elemental_url()

    def _headers(self) -> dict[str, str]:
        if _uses_gateway_proxy():
            return {"X-Api-Key": _gateway_api_key()}
        token = get_elemental_token()
        return {"Authorization": f"Bearer {token}"} if token else {}

    def get(self, path: str, **kwargs) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        headers = kwargs.pop("headers", {})
        headers.update(self._headers())
        return httpx.get(f"{self.base_url}{path}", headers=headers, **kwargs)

    def post(self, path: str, **kwargs) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        headers = kwargs.pop("headers", {})
        headers.update(get_auth_headers())
        return httpx.post(f"{self.base_url}{path}", headers=headers, **kwargs)


elemental_client = _ElementalClient()


# ---------------------------------------------------------------------------
# Agent secrets — values the agent needs at runtime that aren't in the
# bundled broadchurch.yaml. Most common case: DATABASE_URL for tenants
# whose Postgres is provisioned via the Vercel Neon integration (Vercel
# returns those as opaque encrypted blobs that only resolve in its own
# runtime, so the platform stores a portal-side copy for the agent path).
# Set with: PUT {gateway}/api/projects/{org_id}/agent-secrets
# ---------------------------------------------------------------------------

_secrets_cache: dict[str, str] | None = None


def _fetch_agent_secrets() -> dict[str, str]:
    """Fetch the tenant's agent-secrets map from the portal.

    Authenticates with the X-Api-Key (gateway.qs_api_key) the agent already
    carries in broadchurch.yaml. Returns an empty dict on any failure or
    when the gateway isn't configured — callers decide whether a missing
    secret is fatal.
    """
    config = _load_config()
    gw = config.get("gateway", {})
    gw_url = gw.get("url", "").rstrip("/")
    api_key = gw.get("qs_api_key", "")
    org_id = config.get("tenant", {}).get("org_id", "")
    if not (gw_url and api_key and org_id):
        return {}

    url = f"{gw_url}/api/agent-secrets/{org_id}"
    try:
        resp = httpx.get(url, headers={"X-Api-Key": api_key}, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        secrets = data.get("secrets", {})
        return secrets if isinstance(secrets, dict) else {}
    except Exception:
        return {}


def get_agent_secrets(refresh: bool = False) -> dict[str, str]:
    """Return the tenant's agent-secrets map, cached per-process.

    Pass refresh=True to bypass the cache (useful if a value rotated and
    you've been told to re-fetch). The cache lives for the lifetime of
    the agent worker — Agent Engine cold-starts naturally pick up new
    values.
    """
    global _secrets_cache
    if _secrets_cache is None or refresh:
        _secrets_cache = _fetch_agent_secrets()
    return _secrets_cache


def get_agent_secret(name: str, default: str | None = None) -> str | None:
    """Return a single agent secret by name, falling back to env var then default.

    Resolution order:
      1. ``os.environ[name]`` — local dev convenience and a way to
         override per-process without touching the portal
      2. portal-stored agent secret (``GET /api/agent-secrets/{org}``)
      3. ``default``

    Returns None (or ``default``) if the secret isn't set anywhere.
    """
    env_val = os.environ.get(name)
    if env_val:
        return env_val
    secrets = get_agent_secrets()
    return secrets.get(name, default)
