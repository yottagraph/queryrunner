# MCP Tools

The Elemental MCP server provides agent-friendly tools for exploring the Lovelace Knowledge Graph. All tools accept entity **names** (resolved automatically), **NEIDs**, or **structured IDs** — no manual PID lookups or NEID zero-padding required.

## When to Use MCP vs REST

| Path | Best for | Docs |
|------|----------|------|
| **MCP Tools** | Interactive exploration, Cursor agent workflows, multi-step research | This file |
| **REST API** (`useElementalClient()`) | Building app features, UI components, server routes | entities.md, find.md, schema.md, graph.md |

Both paths access the same knowledge graph. MCP tools handle entity resolution,
property name fuzzy-matching, and NEID formatting automatically — the REST API
requires you to manage these yourself (see entities.md and schema.md).

## Tools

### elemental_get_schema

Discover entity types, properties, and relationships.

| Param | Type | Description |
|-------|------|-------------|
| flavor | string | Entity type to inspect — fuzzy-matched (e.g. "company" matches "organization"). Omit to list available flavors. |
| query | string | Natural language search within a flavor's schema (e.g. "revenue"). Requires flavor. |

**Usage pattern:**
1. Call with no arguments to list available flavors.
2. Pick a flavor and call again to see its properties and relationships.
3. Add a query to search within a flavor's schema (e.g. "trustee", "revenue").

**Response:** When no flavor is given, returns `flavors[]` (name, description). When a flavor is given, returns `properties[]` (name, type, domain_flavors) and `relationships[]` (name, type, domain_flavors, target_flavors). When the input was fuzzy-matched, a `resolution` object explains the rewrite.

### elemental_get_entity

Look up an entity and optionally fetch its properties.

| Param | Type | Description |
|-------|------|-------------|
| entity | string | Entity name or NEID. Required unless entity_id is provided. |
| entity_id | object | Structured identifier: `{id_type, id}`. Use instead of entity for exact ID lookups. |
| flavor | string | Disambiguate ambiguous names (e.g. "Apollo" could be a PE firm or healthcare company). |
| snippet | string | Free-text context for disambiguation (e.g. "the chemical element"). |
| properties | string[] | Property names to fetch (e.g. `["total_revenue", "industry"]`). Fuzzy-matched. |
| history | object | Include historical values instead of latest snapshot. Fields: `limit`, `after`, `before`. |

**Entity ID types:** `"neid"` for direct NEID lookup; `"company_cik"`, `"ein"`, `"imo_number"`, `"lei_code"`, etc. for strong ID search.

**Response:** Returns `entity` with NEID, name, flavor, confidence score, and requested property values. Properties include citation markers (e.g. `[1]`). When history is set, returns `historical_properties` with timestamped value arrays instead.

### elemental_get_related

Find entities connected to a center entity via relationships.

| Param | Type | Description |
|-------|------|-------------|
| entity / entity_id | | Center entity (same as get_entity). |
| flavor / snippet | | Disambiguation (same as get_entity). |
| related_flavor | string | **Required.** Type of related entities to find (e.g. "person", "organization", "event"). Fuzzy-matched. |
| relationship_types | string[] | Filter by relationship type (e.g. `["owns", "board_member_of"]`). Fuzzy-matched. |
| direction | string | `"outgoing"` (center is subject), `"incoming"` (center is object), or `"both"` (default). |
| related_properties | string[] | Properties to fetch on each related entity. |
| time_range | object | Filter by date: `{after, before}` (ISO date strings). |
| limit | integer | Max related entities to return (default 50). |

**Response:** Returns `resolved` (center entity), `relationships[]` (each with NEID, name, flavor, relationship_types, and optional properties), and `total` count.

### elemental_get_relationships

Get relationship types and temporal occurrence counts between two specific entities.

| Param | Type | Description |
|-------|------|-------------|
| source | object | Source entity: `{entity, entity_id, flavor, snippet}`. |
| target | object | Target entity: same fields as source. |

**Response:** Returns `resolved_source`, `resolved_target`, `relationships` (map of relationship type to `{dates[], counts[], total}`), and `summary` (map of type to total count).

### elemental_graph_neighborhood

Get the most influential neighbors of an entity.

| Param | Type | Description |
|-------|------|-------------|
| entity / entity_id | | Center entity. |
| flavor / snippet | | Disambiguation. |
| size | integer | Max neighbors to return (default 15). |
| types | string[] | Filter by entity type. |
| relationships | string[] | Filter by relationship type. |
| history | boolean | Include historical neighborhood data (default false). |

**Response:** Returns `neighbors[]` (NEID, name, type, influence score, relationship types). When history is true, also returns `history[]` with dated snapshots.

### elemental_graph_sentiment

Get sentiment analysis from news articles for an entity.

| Param | Type | Description |
|-------|------|-------------|
| entity / entity_id | | Entity to analyze. |
| flavor / snippet | | Disambiguation. |

**Response:** Returns `resolved` entity, `time_range`, `sentiment` (time series data), `statistics` (mean, std dev, min, max), and `trend` (direction, magnitude, analysis).

### elemental_get_events

Find events related to an entity or search for events by description.

| Param | Type | Description |
|-------|------|-------------|
| entity / entity_id | | Entity to find events for. |
| flavor / snippet | | Disambiguation. |
| query | string | Free-text event search (e.g. "spacex rocket launch"). Alternative to entity. |
| categories | string[] | Filter by event category (e.g. `["Bankruptcy", "IPO"]`). |
| time_range | object | Filter by date: `{after, before}`. |
| include_participants | boolean | Include participant details with roles and sentiment (default false). |
| limit | integer | Max events to return. |

**Response:** Returns `events[]` (category, date, description, likelihood, participants with roles and sentiment), `total` count, and optional `resolved` entity.

### elemental_health

Check server health and connectivity.

No parameters. Returns health status, version, and uptime.

## Key Capabilities

### Fuzzy Matching

All flavor, property, and relationship names are fuzzy-matched. Approximate names work:

- "company" matches "organization"
- "ship" matches "vessel"
- "revenue" matches "total_revenue"

When a name is rewritten, the response includes a `resolution` object explaining
what happened (e.g. `"company" matched to "organization"`).

### Entity Resolution

Every tool that accepts an entity supports three input modes:

1. **Name search** — `entity: "Apple"` resolves via the entity resolver with scored ranking.
2. **NEID lookup** — `entity: "00416400910670863867"` bypasses the resolver. NEIDs of 10+ digits are auto-detected.
3. **Structured ID** — `entity_id: {id_type: "company_cik", id: "0000320193"}` for exact lookups by CIK, EIN, IMO, LEI, etc.

Use `snippet` to help disambiguate common names (e.g. `entity: "Mercury", snippet: "the chemical element"`).

Low-confidence matches (below 80%) include a `low_confidence: true` flag and a warning message so the agent can verify before proceeding.

### Citation Tracking

Tools automatically track which data sources back each fact. Property values
include citation markers like `[1]`, `[2]` that reference the bibliography.

Retrieve the full bibliography (titles, URLs, dates) with `elemental_get_bibliography`
or by reading the `session://elemental/bibliography` resource.

## Documentation Resources

The MCP server ships embedded documentation as readable resources:

| URI | Content |
|-----|---------|
| `docs://elemental/guide` | Quick-start: tools, prompts, resources, getting oriented |
| `docs://elemental/data-model` | Entities, properties, relationships, events, citations |
| `docs://elemental/workflows` | Multi-step tool patterns for common research tasks |
| `docs://elemental/schema` | Schema layers, source types, discovery with elemental_get_schema |
| `session://elemental/bibliography` | All sources accessed in this session (citations) |

## Prompts

Pre-built guided workflows available via `prompts/list`:

| Prompt | Description | Required args |
|--------|-------------|---------------|
| `company-deep-dive` | Structured company report: leadership, financials, corporate structure, events — with citations | `entity` |
| `blast-radius` | Map ripple effects across connected entities, expanding outward level by level | `entity`; optional `relationship_types`, `depth` |
| `event-monitor` | Track recent events for one or more entities with cross-entity analysis | `entities`; optional `event_types`, `time_range` |
