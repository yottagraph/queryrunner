"""Tests for the elemental-query MCP server wiring.

Verifies the FastMCP instance is named correctly (the deploy Dockerfile runs
`fastmcp run server:mcp`, so the variable MUST be `mcp`) and that every tool
the agent's instruction references is actually registered.

Run:  pytest mcp-servers/elemental-query/test_server.py
"""

import asyncio

from fastmcp import FastMCP

import server


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


def test_mcp_instance_named_correctly():
    assert isinstance(server.mcp, FastMCP)
    assert server.mcp.name == "elemental-query"


def test_all_expected_tools_registered():
    tools = asyncio.run(server.mcp.list_tools())
    names = {t.name for t in tools}
    assert names == EXPECTED_TOOLS


def test_every_tool_has_a_docstring():
    """Agents read tool docstrings as the API contract — none may be blank."""
    tools = asyncio.run(server.mcp.list_tools())
    for t in tools:
        assert (t.description or "").strip(), f"tool {t.name} has no description"
