"""
elemental-query MCP server.

A focused MCP surface over the Lovelace Elemental Knowledge Graph, built for
the QueryRunner agent. The tools deliberately mirror the Elemental API:
schema discovery (the hard part of navigating the graph), entity resolution,
search, retrieval, and graph traversal.

Design intent: every piece of graph data the agent touches flows through one
of these tools, so the agent's tool-call trace is a complete record of how it
navigated the graph to answer a question.

The heavy lifting (HTTP, schema caching, dedup, reference resolution) lives in
`elemental.py` so it can be unit-tested without an MCP session.

Local testing:
    cd mcp-servers/elemental-query
    pip install -r requirements.txt
    export GATEWAY_URL=... TENANT_ORG_ID=... QS_API_KEY=...
    python server.py                       # serves Streamable HTTP at /mcp
    # equivalently, matching the production Dockerfile entry point:
    python -m fastmcp run server:mcp --transport streamable-http --host 0.0.0.0 --port 8080

The agent connects with StreamableHTTPConnectionParams, so the server MUST
speak Streamable HTTP (the `/mcp` endpoint), NOT the legacy SSE transport —
an SSE server would leave the agent with zero tools and no error raised.

Deployment:
    Use the /deploy_mcp Cursor command.
"""

import os

from fastmcp import FastMCP

import elemental

mcp = FastMCP("elemental-query")


@mcp.tool()
def health() -> dict:
    """Check Query Server connectivity and configuration.

    Returns ok/configured flags and, when healthy, the number of entity
    types and properties in the graph. Call this first if other tools error.
    """
    return elemental.health()


@mcp.tool()
def list_entity_types() -> dict:
    """List every entity type (flavor) in the knowledge graph with a description.

    Start here to navigate the schema: find the entity type relevant to the
    question, then call get_entity_type_schema(flavor) to see its properties.

    Returns:
        {"count": int, "entity_types": [{"name", "display_name", "description"}]}
    """
    return elemental.list_entity_types()


@mcp.tool()
def get_entity_type_schema(flavor: str) -> dict:
    """List the properties available on a given entity type (flavor).

    Args:
        flavor: Entity type name (e.g. "organization", "person"), from
            list_entity_types.

    Returns:
        Each property with name, display_name, value_type, unit, description,
        and is_reference (true ⇒ the value is a link to another entity that
        resolves to a name). Scoped to this flavor so the list stays focused.
    """
    return elemental.get_entity_type_schema(flavor)


@mcp.tool()
def search_properties(query: str, limit: int = 25) -> dict:
    """Find properties by fuzzy text match on name, display name, or description.

    Use when you know the concept (e.g. "revenue", "ceo", "headquarters")
    but not the exact property name.

    Args:
        query: Text to match against property metadata.
        limit: Max properties to return (default 25).

    Returns:
        Matching properties with the entity types they apply to.
    """
    return elemental.search_properties(query, limit)


@mcp.tool()
def get_property_detail(name: str) -> dict:
    """Get full schema detail for a single property by its exact name.

    Args:
        name: Exact property name (from search_properties or a schema list).

    Returns:
        value_type, unit, description, the entity types it applies to, and
        (for reference properties) the entity types it points at.
    """
    return elemental.get_property_detail(name)


@mcp.tool()
def resolve_entity(name: str, flavor: str = "", max_results: int = 5) -> dict:
    """Resolve a name to ranked entity matches (neid, name, flavor, score).

    Always resolve a name to a NEID before fetching properties or
    relationships for it.

    Args:
        name: The entity name to resolve (e.g. "Apple", "JP Morgan").
        flavor: Optional entity type to restrict matches to.
        max_results: Max ranked matches to return (default 5).

    Returns:
        {"query", "match_count", "matches": [{"neid","name","flavor","score"}]}
    """
    return elemental.resolve_entity(name, flavor or None, max_results)


@mcp.tool()
def get_entity_properties(neid: str, properties: list[str]) -> dict:
    """Fetch named property values for one entity, by NEID.

    Reference (linked) values are resolved to the linked entity's display
    name automatically, so you never get a raw NEID where a name belongs.

    Args:
        neid: The entity's NEID (from resolve_entity).
        properties: Property names to fetch (from the schema tools).

    Returns:
        {"neid", "values": {prop: value_or_null}, "unknown_properties": [...]}
    """
    return elemental.get_entity_properties(neid, properties)


@mcp.tool()
def find_entities(expression: str, limit: int = 20) -> dict:
    """Search entities with an Elemental `find` expression (JSON string).

    Examples:
        by type:  {"type":"is_type","is_type":{"fid":10}}
        by name:  {"type":"comparison","comparison":{"operator":"string_like","pid":8,"value":"Apple"}}
        linked:   {"type":"linked","linked":{"to_entity":"<neid>","direction":"incoming"}}
        boolean:  {"type":"and","and":[<expr>,<expr>]}

    Args:
        expression: JSON-encoded expression in the Elemental expression language.
        limit: Max entities to return (default 20).

    Returns:
        Matched NEIDs with resolved display names for the first several.
    """
    return elemental.find_entities(expression, limit)


@mcp.tool()
def count_linked_entities(
    neid: str, direction: str = "incoming", relationship: str = "", limit: int = 500
) -> dict:
    """Count entities linked to an entity in the graph (by NEID).

    Args:
        neid: The center entity's NEID.
        direction: "incoming" or "outgoing".
        relationship: Optional relationship property name to restrict to.
        limit: Max links to traverse (default 500).

    Returns:
        {"count", "direction", "relationship", "sample": [names]}
    """
    return elemental.count_linked_entities(neid, direction, relationship or None, limit)


@mcp.tool()
def get_entity_name(neid: str) -> dict:
    """Get an entity's canonical display name from its NEID.

    Args:
        neid: The entity's NEID.

    Returns:
        {"neid", "name"}
    """
    return elemental.get_entity_name(neid)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    # Streamable HTTP (the `/mcp` endpoint), to match the agent's
    # StreamableHTTPConnectionParams. SSE is the legacy transport and would
    # silently leave the agent with zero tools.
    mcp.run(transport="streamable-http", host="0.0.0.0", port=port)
