---
name: elemental-api
description: Query the Elemental API for entity discovery, search, and metadata. Use with the Lovelace News Query Server or MCP tools.
---

# Elemental API

This skill provides documentation for the Lovelace Elemental API, the primary interface for querying the Lovelace Knowledge Graph.

## Two Access Paths

The knowledge graph is accessible via two complementary interfaces:

- **MCP Tools** — Agent-friendly tools with built-in entity resolution, fuzzy matching, and citation tracking. Ideal for interactive exploration and Cursor agent workflows. See `mcp.md`.
- **REST API** — Programmatic endpoints for building app features with `useElementalClient()`. See `entities.md`, `find.md`, `schema.md`, `graph.md`.

Both paths access the same data. MCP tools handle PID lookups, NEID formatting,
and name resolution automatically — the REST API requires you to manage these
yourself.

## When to Use This Skill

Use this skill when you need to:
- Look up entities (companies, people, organizations) by name or ID
- Search for entities by type, property values, or relationships
- Explore relationships between entities (ownership, governance, events)
- Get entity metadata (types/flavors, properties)
- Build knowledge graphs of entity networks

## Quick Start (MCP) — Test Here First

**If MCP tools are in your tool list, always test data access with them
before writing application code.** MCP handles entity resolution, PID
lookups, and NEID formatting automatically — use it to verify what data
exists and how it's structured before committing to a REST implementation.

1. **Explore the schema**: Call `elemental_get_schema` with no arguments to list entity types, then with a flavor to see its properties and relationships.
2. **Look up an entity**: Call `elemental_get_entity` with a name, NEID, or structured ID to resolve it and fetch properties.
3. **Follow relationships**: Call `elemental_get_related` to find connected entities.
4. **Verify your assumptions**: Check that the flavor IDs, property IDs, and response shapes match what you expect before writing code.

## Quick Start (REST)

1. **Find an entity**: Use `entities.md` to look up a company or person by name and get their NEID (Named Entity ID)
2. **Get information**: Use the NEID to query entity properties or explore the graph
3. **Search**: Use `find.md` for expression-based entity searches

**Important:** The REST API has several response shape gotchas (schema
nesting, `fid` vs `findex`, form-encoded bodies). Read the "Common
Mistakes" section in `find.md` and the `findex` vs `fid` note in
`schema.md` before implementing.

## Files in This Skill

See [overview.md](overview.md) for core concepts and how the two access paths relate:

**MCP Tools:**
- `mcp.md` - MCP tool reference: all tools, resources, prompts, capabilities

**REST API:**
- `entities.md` - Entity search, details, and properties
- `find.md` - Expression language for searching entities by type, property values, and relationships
- `schema.md` - Data model: entity types (flavors), properties, and schema endpoints
- `graph.md` - Visual graph generation
- `server.md` - Server status and health

**Both paths:**
- `relationships.md` - Relationship traversal patterns (graph-layer and property-layer)
