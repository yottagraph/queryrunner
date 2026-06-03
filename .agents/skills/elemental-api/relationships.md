# Relationships

Relationships are directed, typed edges between entities in the knowledge graph.
They connect a **source** (subject) entity to a **target** (object) entity via a
named relationship type.

## When to Use

- You need to find entities connected to a given entity (e.g. "who owns this company?")
- You need to determine how two entities are connected
- You need to traverse the graph along specific relationship types

## Key Concepts

### Relationship Properties

In the schema, relationships are properties with type `data_nindex` — the value
is another entity's identifier rather than a scalar. Use `elemental_get_schema`
(MCP) or `GET /schema` (REST) to discover which relationships exist for a flavor:

- **domain_flavors** — which entity types can be the source of this relationship
- **target_flavors** — which entity types can be the target

For example, `trustee_of` might have domain `["organization"]` and target
`["financial_instrument"]`, meaning organizations can be trustees of financial
instruments.

### Direction

Relationships are directional. When querying, direction controls which side of
the edge you're searching from:

| Direction | Meaning | Example |
|-----------|---------|---------|
| `outgoing` | Center entity is the **subject** | "What does Apple own?" (Apple → owns → target) |
| `incoming` | Center entity is the **object** | "Who owns Apple?" (source → owns → Apple) |
| `both` | Union of outgoing and incoming | "All ownership relationships involving Apple" |

### Common Relationship Types

Relationship types vary by dataset. Use schema discovery to find what's available.
Common examples:

- `owns`, `owns_stake_in` — ownership
- `board_member_of`, `is_director`, `is_officer` — corporate governance
- `subsidiary_of` — corporate structure
- `trustee_of` — fiduciary relationships
- `appears_in` — entity appears in an article
- `participant` — entity participates in an event

## Traversal via MCP Tools

MCP tools handle PID resolution, NEID formatting, and entity name lookup automatically.

### Find connected entities

Use `elemental_get_related` to find entities connected to a center entity:

```
elemental_get_related(
  entity: "Apple",
  related_flavor: "person",
  relationship_types: ["is_officer"],
  direction: "incoming",
  related_properties: ["nationality"]
)
```

This finds people who are officers of Apple, with their nationality.

### Get relationship counts between two entities

Use `elemental_get_relationships` to see how two specific entities are connected:

```
elemental_get_relationships(
  source: {entity: "Bank of New York Mellon"},
  target: {entity_id: {id_type: "neid", id: "08242646876499346416"}}
)
```

Returns relationship types (e.g. `trustee_of`) with temporal counts showing
when the relationship was observed.

### Discover available relationships

Use `elemental_get_schema` to find what relationship types exist for a flavor:

```
elemental_get_schema(flavor: "organization")
→ relationships: [{name: "owns", target_flavors: ["organization"]}, ...]

elemental_get_schema(flavor: "organization", query: "trustee")
→ relationships: [{name: "trustee_of", target_flavors: ["financial_instrument"]}, ...]
```

## Traversal via REST API

The REST API requires manual PID lookups, NEID zero-padding, and expression
construction. See find.md for the full expression language and entities.md for
property value retrieval.

### Graph-layer traversal (linked expression)

For entity types that are first-class graph nodes (person, organization, location),
use `POST /elemental/find` with a `linked` expression:

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"linked","linked":{"to_entity":"00416400910670863867","distance":1,"pids":[42],"direction":"incoming"}}&limit=50
```

The `pids` array specifies which relationship types to follow (e.g. PID 42 for
`is_officer`). Look up PIDs via `GET /schema`.

Combine with `is_type` to filter results by flavor:

```json
{
  "type": "and",
  "and": [
    {"type": "linked", "linked": {"to_entity": "00416400910670863867", "distance": 1, "direction": "incoming"}},
    {"type": "is_type", "is_type": {"fid": 9}}
  ]
}
```

### Property-layer traversal (getPropertyValues)

For entity types that are attached as property values (documents, filings,
financial instruments), use `POST /elemental/entities/properties` with the
relationship PID:

```
POST /elemental/entities/properties
Content-Type: application/x-www-form-urlencoded

eids=["00416400910670863867"]&pids=[203]
```

Relationship property values (`data_nindex` type) are raw entity identifiers.
**You must zero-pad them to 20 characters** to form valid NEIDs for subsequent
API calls:

```typescript
const rawValue = "4926132345040704022";  // 19 chars
const neid = rawValue.padStart(20, '0'); // "04926132345040704022"
```

MCP tools handle this padding automatically — this is only needed with the REST API.

## Tips

- Always discover relationship types from the schema first — don't hardcode
  relationship names or PIDs.
- Use `direction` deliberately. "Who owns X?" is `incoming`; "What does X own?"
  is `outgoing`. The default `both` is convenient but may return noisy results.
- Relationship property values from the REST API need NEID zero-padding.
  MCP tools handle this automatically.
- When combining relationship traversal with type filtering, wrap the `linked`
  expression in an `and` with `is_type` (see find.md for the expression language).
