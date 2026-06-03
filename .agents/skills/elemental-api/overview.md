# Elemental API Overview

The Elemental API provides access to the Lovelace Knowledge Graph through the
Query Server. This document explains core concepts and guides you to the right
documentation.

## Access Paths

The knowledge graph is accessible via two interfaces:

- **MCP Tools** — Agent-friendly tools with built-in entity resolution, fuzzy
  matching on all names, and automatic citation tracking. Ideal for interactive
  exploration and Cursor agent workflows. See [mcp.md](mcp.md).
- **REST API** — Programmatic endpoints for building app features with
  `useElementalClient()`. Requires manual PID lookups, NEID zero-padding, and
  expression construction. See the endpoint files below.

Both access the same data. Choose based on your context: MCP when tools are
connected, REST when building application code.

**Recommended workflow when building features:**
1. **MCP first** — explore the schema and test data access interactively
2. **curl/CLI** — verify exact REST request/response shapes (especially for `/elemental/find` expressions)
3. **Implement** — write application code with confidence in the API behavior

## Core Concepts

### Entities

Every entity has:
- **NEID** — a unique Named Entity ID (stable identifier)
- **Name** — human-readable label (may have aliases)
- **Flavor** — the entity type (e.g. "organization", "person", "financial_instrument", "fund_account", "vessel", "event")

#### Named Entity ID (NEID)

Every entity in the system has a unique identifier called a NEID. REST API calls
require a NEID, so your first step is usually looking up an entity by name. MCP
tools accept names directly and resolve them automatically.

**Format**: 20-character numeric string with zero-padding. Example: `00416400910670863867`

When normalizing NEIDs for the REST API, always pad with leading zeros to exactly
20 characters. MCP tools handle this automatically.

NEIDs are stable and can be persisted long-term, but may occasionally change if the database is rebuilt or the application switches databases. When an NEID becomes invalid (e.g., resolution returns no results), re-resolve the entity using its canonical name from the previous query result, then redo any downstream operations that depended on it. NEIDs should NEVER be hardcoded in source code.

**Note**: The terms "eid", "neid", and "nindex" are interchangeable throughout
the system. Some endpoints use `neid`, others use `eid`, and internal tools may
use `nindex` — they all refer to the same entity identifier.

### Properties

Timestamped key-value facts attached to entities, scoped by flavor. Each property
value records **when** it was observed (`recorded_at`), so entities can have
multiple values for the same property over time — one per filing, extraction, or
data ingestion event.

Examples: nationality, birth_date, industry, total_revenue, employee_count,
sources_of_funds, computation_date_valuation, internal_rate_of_return.

Use the schema to discover which properties are available for a given entity type.
Property names are fuzzy-matched in MCP tools (e.g. "revenue" matches
"total_revenue"); the REST API requires exact PIDs from the schema.

### Relationships

Directed, typed edges between two entities:
- **Type** — e.g. "owns", "board_member_of", "subsidiary_of", "trustee_of", "appears_in"
- **Direction** — relationships go from source (subject) to target (object)

In the schema, relationships are properties with type `data_nindex` — the value is
another entity's identifier. See [relationships.md](relationships.md) for
traversal patterns using both MCP and REST.

### Attributes

Metadata attached to relationships. For example, the "participant" relationship
connecting an entity to an event carries:
- **role** — the entity's role in the event (e.g. "acquirer", "target", "plaintiff")
- **sentiment** — an impact score for the entity's involvement

### Events

Structured occurrences extracted from source data, each with:
- **Category** — e.g. "Bankruptcy", "IPO", "Layoffs", "Acquisition"
- **Date** — when the event occurred (YYYY-MM-DD, or YYYY-MM / YYYY for partial dates)
- **Description** — detailed, objective description of the event
- **Likelihood** — temporal status: confirmed, ongoing, likely, or speculative
- **Participants** — entities involved, each with a role and sentiment score

### Citations

Property values and relationships carry **citation markers** (e.g. `[1]`, `[2]`)
referencing the data sources that back each fact. Citations are tracked
automatically in MCP sessions. Retrieve the full bibliography (titles, URLs,
publication dates) with `elemental_get_bibliography` or by reading the
`session://elemental/bibliography` resource.

## File Guide

| File | Use When You Need To... |
|------|------------------------|
| [mcp.md](mcp.md) | Use MCP tools for interactive exploration (tools, resources, prompts) |
| [entities.md](entities.md) | Look up entities by name, get details and properties (REST) |
| [find.md](find.md) | Search for entities by type, property values, or relationships (REST expression language) |
| [schema.md](schema.md) | Understand the data model: entity types (flavors), properties, and their metadata |
| [relationships.md](relationships.md) | Traverse entity relationships (both MCP and REST patterns) |
| [graph.md](graph.md) | Generate visual network graphs |
| [server.md](server.md) | Check server status and capabilities |

## Common Workflows

### "What data is available for a bond / financial instrument?"
- **MCP**: `elemental_get_schema(flavor: "financial_instrument")` → see all properties and relationships
- **REST**: `GET /schema` → find the FID for "financial_instrument", then inspect its properties

### "Find all organizations in a specific sector"
- **MCP**: `elemental_get_related(entity: "sector name", related_flavor: "organization")`
- **REST**: `schema.md` → find PIDs; `find.md` → search by property values

### "What companies are related to Apple?"
- **MCP**: `elemental_get_related(entity: "Apple", related_flavor: "organization")`
- **REST**: `entities.md` → look up "Apple" to get NEID; `find.md` → linked expression

### "Who is the trustee of this bond?"
- **MCP**: `elemental_get_related(entity_id: {id_type: "neid", id: "08242646876499346416"}, related_flavor: "organization", relationship_types: ["trustee_of"], direction: "incoming")`
- **REST**: See [relationships.md](relationships.md) for the multi-step traversal pattern
