"""Unit tests for broadchurch_auth — config loading, token caching, client headers."""

import sys
import time
import types
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

import broadchurch_auth
from broadchurch_auth import (
    _ElementalClient,
    _load_config,
    get_auth_headers,
    get_elemental_token,
    get_elemental_url,
)


@contextmanager
def mock_google_auth(fetch_id_token_fn=None):
    """Context manager that injects a fake google.oauth2.id_token into sys.modules.

    The google.auth.* packages are lazy-imported inside get_elemental_token(),
    so we need to pre-populate the full module hierarchy in sys.modules.
    """
    if fetch_id_token_fn is None:
        fetch_id_token_fn = MagicMock(return_value="mock-token")

    google = types.ModuleType("google")
    google.auth = types.ModuleType("google.auth")
    google.auth.transport = types.ModuleType("google.auth.transport")
    google.auth.transport.requests = types.ModuleType("google.auth.transport.requests")
    google.auth.transport.requests.Request = MagicMock
    google.oauth2 = types.ModuleType("google.oauth2")
    google.oauth2.id_token = types.ModuleType("google.oauth2.id_token")
    google.oauth2.id_token.fetch_id_token = fetch_id_token_fn

    sentinel = object()
    saved = {}
    modules_to_inject = {
        "google": google,
        "google.auth": google.auth,
        "google.auth.transport": google.auth.transport,
        "google.auth.transport.requests": google.auth.transport.requests,
        "google.oauth2": google.oauth2,
        "google.oauth2.id_token": google.oauth2.id_token,
    }
    for key, mod in modules_to_inject.items():
        saved[key] = sys.modules.get(key, sentinel)
        sys.modules[key] = mod

    try:
        yield google.oauth2.id_token
    finally:
        for key in modules_to_inject:
            prev = saved[key]
            if prev is sentinel:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = prev


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


class TestLoadConfig:
    def test_reads_yaml_from_cwd(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  url: https://from-cwd.example.com\n"
        )
        monkeypatch.chdir(tmp_path)

        config = _load_config()
        assert config["query_server"]["url"] == "https://from-cwd.example.com"

    def test_reads_yaml_from_module_parent(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            broadchurch_auth, "__file__", str(tmp_path / "broadchurch_auth.py")
        )
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  url: https://from-parent.example.com\n"
        )

        config = _load_config()
        assert config["query_server"]["url"] == "https://from-parent.example.com"

    def test_returns_empty_dict_when_no_yaml(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            broadchurch_auth, "__file__", str(tmp_path / "sub" / "broadchurch_auth.py")
        )

        config = _load_config()
        assert config == {}

    def test_caches_config_across_calls(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text("key: value\n")
        monkeypatch.chdir(tmp_path)

        first = _load_config()
        (tmp_path / "broadchurch.yaml").write_text("key: changed\n")
        second = _load_config()

        assert first is second  # same object from cache


# ---------------------------------------------------------------------------
# get_elemental_url
# ---------------------------------------------------------------------------


class TestGetElementalUrl:
    def test_env_var_takes_precedence(self, monkeypatch, tmp_path):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  url: https://from-config.example.com\n"
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://from-env.example.com")

        assert get_elemental_url() == "https://from-env.example.com"

    def test_strips_trailing_slash_from_env(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://example.com/")
        assert get_elemental_url() == "https://example.com"

    def test_reads_from_config(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  url: https://config-query.example.com/\n"
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_URL", raising=False)

        assert get_elemental_url() == "https://config-query.example.com"

    def test_falls_back_to_default(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_URL", raising=False)

        assert get_elemental_url() == "https://stable-query.lovelace.ai"


# ---------------------------------------------------------------------------
# get_elemental_token
# ---------------------------------------------------------------------------


class TestGetElementalToken:
    def test_returns_env_var_token(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "static-dev-token")
        assert get_elemental_token() == "static-dev-token"

    def test_env_var_skips_gcp_minting(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "static-dev-token")
        mock_fetch = MagicMock(return_value="should-not-be-called")
        with mock_google_auth(mock_fetch):
            get_elemental_token()
            mock_fetch.assert_not_called()

    def test_mints_gcp_token_when_no_env_var(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  audience: custom:audience\n"
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        mock_fetch = MagicMock(return_value="minted-gcp-token")
        with mock_google_auth(mock_fetch):
            token = get_elemental_token()

        assert token == "minted-gcp-token"
        mock_fetch.assert_called_once()
        assert mock_fetch.call_args[0][1] == "custom:audience"

    def test_uses_default_audience_when_not_in_config(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        mock_fetch = MagicMock(return_value="token")
        with mock_google_auth(mock_fetch):
            get_elemental_token()

        assert mock_fetch.call_args[0][1] == "queryserver:api"

    def test_caches_minted_token(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  audience: test:aud\n"
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        call_count = 0

        def fake_fetch(request, audience):
            nonlocal call_count
            call_count += 1
            return f"token-{call_count}"

        with mock_google_auth(fake_fetch):
            first = get_elemental_token()
            second = get_elemental_token()

        assert first == "token-1"
        assert second == "token-1"  # cached, not "token-2"
        assert call_count == 1

    def test_refreshes_expired_token(self, tmp_path, monkeypatch):
        (tmp_path / "broadchurch.yaml").write_text(
            "query_server:\n  audience: test:aud\n"
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        call_count = 0

        def fake_fetch(request, audience):
            nonlocal call_count
            call_count += 1
            return f"token-{call_count}"

        with mock_google_auth(fake_fetch):
            first = get_elemental_token()
            broadchurch_auth._token_cache["expires_at"] = time.time() - 1
            second = get_elemental_token()

        assert first == "token-1"
        assert second == "token-2"
        assert call_count == 2

    def test_raises_helpful_error_when_minting_fails(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        def exploding_fetch(request, audience):
            raise Exception("no credentials found")

        with mock_google_auth(exploding_fetch):
            with pytest.raises(RuntimeError, match="Failed to mint ID token"):
                get_elemental_token()

    def test_error_message_suggests_env_var(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("ELEMENTAL_API_TOKEN", raising=False)

        def exploding_fetch(request, audience):
            raise Exception("boom")

        with mock_google_auth(exploding_fetch):
            with pytest.raises(RuntimeError, match="ELEMENTAL_API_TOKEN"):
                get_elemental_token()


# ---------------------------------------------------------------------------
# get_auth_headers
# ---------------------------------------------------------------------------


class TestGetAuthHeaders:
    def test_includes_bearer_token(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "test-token")
        headers = get_auth_headers()
        assert headers["Authorization"] == "Bearer test-token"

    def test_includes_content_type(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "test-token")
        headers = get_auth_headers()
        assert headers["Content-Type"] == "application/x-www-form-urlencoded"


# ---------------------------------------------------------------------------
# _ElementalClient
# ---------------------------------------------------------------------------


class TestElementalClient:
    def test_get_injects_auth_header(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://test-api.example.com")
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "client-token")

        mock_response = MagicMock()
        with patch("httpx.get", return_value=mock_response) as mock_get:
            client = _ElementalClient()
            client.get("/some/path")

        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs[0][0] == "https://test-api.example.com/some/path"
        assert call_kwargs[1]["headers"]["Authorization"] == "Bearer client-token"

    def test_post_injects_auth_and_content_type(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://test-api.example.com")
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "client-token")

        mock_response = MagicMock()
        with patch("httpx.post", return_value=mock_response) as mock_post:
            client = _ElementalClient()
            client.post("/some/path", data={"key": "val"})

        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert call_kwargs[0][0] == "https://test-api.example.com/some/path"
        assert call_kwargs[1]["headers"]["Authorization"] == "Bearer client-token"
        assert (
            call_kwargs[1]["headers"]["Content-Type"]
            == "application/x-www-form-urlencoded"
        )
        assert call_kwargs[1]["data"] == {"key": "val"}

    def test_base_url_property(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://dynamic.example.com")
        client = _ElementalClient()
        assert client.base_url == "https://dynamic.example.com"

    def test_default_timeout(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://test.example.com")
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "t")

        with patch("httpx.get", return_value=MagicMock()) as mock_get:
            _ElementalClient().get("/path")

        assert mock_get.call_args[1]["timeout"] == 30.0

    def test_custom_timeout(self, monkeypatch):
        monkeypatch.setenv("ELEMENTAL_API_URL", "https://test.example.com")
        monkeypatch.setenv("ELEMENTAL_API_TOKEN", "t")

        with patch("httpx.get", return_value=MagicMock()) as mock_get:
            _ElementalClient(timeout=5.0).get("/path")

        assert mock_get.call_args[1]["timeout"] == 5.0
