"""Shared fixtures for agent tests."""

import importlib
import textwrap

import pytest


SAMPLE_CONFIG = textwrap.dedent("""\
    gcp:
      project: broadchurch
      region: us-central1
    tenant:
      project_name: test-project
      org_id: org_test123
    query_server:
      url: https://test-query.example.com
      audience: test:audience
""")


@pytest.fixture()
def broadchurch_yaml(tmp_path):
    """Write a sample broadchurch.yaml and return its path."""
    p = tmp_path / "broadchurch.yaml"
    p.write_text(SAMPLE_CONFIG)
    return p


@pytest.fixture(autouse=True)
def _reset_auth_module():
    """Reset broadchurch_auth module-level caches between tests."""
    import broadchurch_auth

    broadchurch_auth._config_cache = None
    broadchurch_auth._token_cache = {"token": None, "expires_at": 0.0}
    yield
    broadchurch_auth._config_cache = None
    broadchurch_auth._token_cache = {"token": None, "expires_at": 0.0}
