"""Layer 2: Agent connectivity tests — real API calls against the Elemental API.

These tests validate that broadchurch_auth can authenticate and that the
Elemental API responds correctly to the tool functions agents rely on.

Requires credentials AND network access:
  - ELEMENTAL_API_TOKEN env var (local dev), OR
  - GCP Application Default Credentials + broadchurch.yaml (production)
  - The Elemental API hostname must be reachable from this machine

Setup:
    cd agents
    python3 -m venv .venv && source .venv/bin/activate
    pip install -e ".[test]"

Run:
    pytest tests/test_agent_connectivity.py -v

Skip if no credentials:
    pytest tests/ -v   # connectivity tests auto-skip when creds are missing
"""

import json
import os
from functools import wraps

import httpx
import pytest

connectivity = pytest.mark.connectivity


def _has_credentials() -> bool:
    if os.environ.get("ELEMENTAL_API_TOKEN"):
        return True
    try:
        from broadchurch_auth import get_elemental_token

        get_elemental_token()
        return True
    except Exception:
        return False


def _api_is_reachable() -> bool:
    """Quick DNS + TCP check against the Elemental API host."""
    try:
        from broadchurch_auth import get_elemental_url

        url = get_elemental_url()
        httpx.head(url, timeout=5.0)
        return True
    except Exception:
        return False


requires_credentials = pytest.mark.skipif(
    not _has_credentials(),
    reason="No Elemental API credentials (set ELEMENTAL_API_TOKEN or configure GCP ADC)",
)

requires_api = pytest.mark.skipif(
    not (_has_credentials() and _api_is_reachable()),
    reason="Elemental API not reachable (credentials missing or host unreachable)",
)


@connectivity
@requires_credentials
class TestAuthHeaderFormat:
    """Validate that auth headers are well-formed (catches the 'Bearer ' bug)."""

    def test_auth_token_is_non_empty(self):
        from broadchurch_auth import get_elemental_token

        token = get_elemental_token()
        assert token, "Token is empty — auth is broken"
        assert len(token) > 10, "Token suspiciously short"

    def test_bearer_token_not_empty(self):
        from broadchurch_auth import get_auth_headers

        headers = get_auth_headers()
        auth = headers["Authorization"]
        assert auth.startswith("Bearer "), f"Bad auth header format: {auth[:30]}"
        token_part = auth[len("Bearer "):]
        assert len(token_part) > 0, "Token after 'Bearer ' is empty — would cause 'Illegal header value'"


@connectivity
@requires_api
class TestElementalApiConnectivity:
    """Validate that the Elemental API is reachable and returns expected shapes."""

    def _client(self):
        from broadchurch_auth import _ElementalClient

        return _ElementalClient(timeout=15.0)

    def test_schema_returns_flavors_and_properties(self):
        resp = self._client().get("/elemental/metadata/schema")
        assert resp.status_code == 200, f"Schema endpoint returned {resp.status_code}: {resp.text[:200]}"

        data = resp.json()
        assert "flavors" in data, f"Missing 'flavors' key. Keys: {list(data.keys())}"
        assert "properties" in data, f"Missing 'properties' key. Keys: {list(data.keys())}"
        assert len(data["flavors"]) > 0, "No flavors returned"
        assert len(data["properties"]) > 0, "No properties returned"

    def test_search_known_entity(self):
        resp = self._client().post(
            "/entities/search",
            json={"queries": [{"queryId": 1, "query": "Apple"}], "maxResults": 3, "includeNames": True},
        )
        assert resp.status_code == 200, f"Search returned {resp.status_code}: {resp.text[:200]}"

        data = resp.json()
        assert "results" in data, f"Missing 'results' key. Keys: {list(data.keys())}"

    def test_find_entities_natural_language(self):
        expression = json.dumps({
            "type": "natural_language",
            "natural_language": "technology companies",
        })
        resp = self._client().post(
            "/elemental/find",
            data={"expression": expression, "limit": "5"},
        )
        assert resp.status_code == 200, f"Find returned {resp.status_code}: {resp.text[:200]}"

        data = resp.json()
        assert "eids" in data, f"Missing 'eids' key. Keys: {list(data.keys())}"

    def test_get_properties_for_found_entities(self):
        expression = json.dumps({
            "type": "natural_language",
            "natural_language": "Apple Inc",
        })
        find_resp = self._client().post(
            "/elemental/find",
            data={"expression": expression, "limit": "1"},
        )
        assert find_resp.status_code == 200

        eids = find_resp.json().get("eids", [])
        if not eids:
            pytest.skip("No entities found for 'Apple Inc' — API may be empty")

        props_resp = self._client().post(
            "/elemental/entities/properties",
            data={"eids": json.dumps(eids[:1]), "include_attributes": "true"},
        )
        assert props_resp.status_code == 200, (
            f"Properties returned {props_resp.status_code}: {props_resp.text[:200]}"
        )

    def test_invalid_endpoint_returns_error(self):
        resp = self._client().get("/elemental/nonexistent")
        assert resp.status_code >= 400, "Expected error status for nonexistent endpoint"
