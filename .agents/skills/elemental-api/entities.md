# Entities

Entities are the core objects in the Knowledge Graph: companies, people, organizations, products, and other named things that appear in the news. Each entity has a unique **Named Entity ID (NEID)**.

NEIDs are stable and can be persisted long-term, but may occasionally change if the database is rebuilt or the application switches databases. When an NEID becomes invalid (e.g., resolution returns no results), re-resolve the entity using its canonical name from the previous query result, then redo any downstream operations that depended on it. NEIDs should NEVER be hardcoded in source code.

**Looking for property-based search?** To search for entities by type, property values, or relationships using the expression language, see [find.md](find.md).

## When to Use

- You have an entity name and need to find its NEID
- You have a NEID and need the entity's display name or details
- You're starting a new query and need to identify the subject
- You need entity metadata (industry, location, ticker, etc.)

## Key Concepts

- **NEID**: A unique identifier for each entity. Required for most other API calls.
  - Format: 20-character numeric string with zero-padding
  - Example: `00416400910670863867`
  - Always pad with leading zeros to exactly 20 characters when normalizing
- **EID**: The term EID is sometimes used interchangeably with NEID.
- **nindex**: The term nindex is sometimes used interchangeably with NEID.
- **Entity Resolution**: The same real-world entity may have multiple names (e.g., "Apple", "Apple Inc.", "AAPL"). The API resolves these to a single NEID.
- **Flavors (Entity Types)**: Each entity has a type identified by a Flavor ID (FID).

## Tips

- Always start by searching for the entity to get the correct NEID
- After resolving an entity to an NEID, save and use the the canonical entity name going forward.
- It's typically safe to resolve an entity to the top matching NEID. However, sometimes a useful pattern is to let the user give input that the resolution was incorrect, show them a longer list of matches, and let them choose a different resolution.
- Entity names are case-insensitive

## Key Endpoints

| What you need | Endpoint | Returns |
|---------------|----------|---------|
| Find entity by name (batch, scored) | `POST /entities/search` | Ranked matches with NEIDs and scores |
| Get entity display name | `GET /entities/{neid}/name` | Canonical name (`{"name": "..."}`) |
| Get entity aliases | `GET /entities/{neid}/aliases` | All known names (`{"aliases": [...]}`) |
| Batch name lookup | `POST /entities/names` | Map of NEID → name |
| Batch alias lookup | `POST /entities/aliases` | Map of NEID → aliases |
| Resolve merged entities | `POST /entities/redirect` | Canonical NEIDs for merges |
| Full property values | `POST /elemental/entities/properties` | All properties with PIDs, values, timestamps |

## Form-Encoded JSON Parameters

Several Elemental API endpoints use `application/x-www-form-urlencoded` with
JSON-encoded values inside form fields. The `eids` and `pids` parameters on
`POST /elemental/entities/properties` are the most common example:

```
eids=["00416400910670863867","03016672914748108965"]&pids=[8,22]
```

The generated TypeScript client types show `eids: string` and `pids: string`
(not `string[]`) because the values are **JSON-stringified arrays passed as
strings**, not native arrays. When calling these endpoints:

```typescript
// Correct — JSON-stringify the arrays
eids: JSON.stringify(["00416400910670863867"])
pids: JSON.stringify([8, 22])

// Wrong — passing raw arrays will not work
eids: ["00416400910670863867"]  // ❌ type error or silent failure
```

The same pattern applies to the `expression` parameter on `POST /elemental/find`.

## Schema and Property Lookup

For understanding entity types (flavors), properties, and the data model, see **schema.md**. You'll need the schema because many API responses return only FIDs and PIDs — use it to translate these to human-readable names.

## Properties Return Multiple Timestamped Values

`getPropertyValues` returns **all** recorded values for a property, not just the latest. A single entity and property (e.g. Apple's `company_cik`) may return dozens of rows with different `recorded_at` timestamps — one per filing or data ingestion event. For display, take the first (or latest) value and deduplicate by PID:

```typescript
const byPid = new Map<number, string>();
for (const v of values) {
    if (!byPid.has(v.pid)) byPid.set(v.pid, v.value);
}
```

## `include_attributes` Parameter

`getPropertyValues` accepts an `include_attributes` parameter (set to `'true'` as a string) that returns additional metadata on each value. This is essential for relationship properties like `appears_in`, where attributes carry entity-level sentiment scores and article URLs.

**Note:** The generated TypeScript client types don't include `include_attributes` in the parameter type. Pass it as an extra property — the API accepts it:

```typescript
const res = await client.getPropertyValues({
    eids: JSON.stringify([neid]),
    pids: JSON.stringify([appearsInPid]),
    include_attributes: 'true',  // Not in TS types, but API accepts it
} as any);
```

**Important:** Attribute keys are **quad attribute type IDs (AIDs)**, NOT property PIDs. These are a separate numeric namespace. For example, property PID 15 is "industry", but attribute key "15" is "sentiment". To resolve attribute keys to names, use the `attributes` array from `GET /schema` (see schema.md).

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

### Batch entity alias lookup

`POST /entities/aliases`

Look up all known aliases for multiple entities by their NEIDs in a single request.

#### Request Body

Batch aliases request

**Type:** `BatchEntityAliasesRequest`

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Entity aliases (`BatchEntityAliasesResponse`) |
| 400 | Invalid request (`Error`) |

#### Example

**Request:**

```
POST /entities/aliases
{"neids": ["00416400910670863867"]}
```

**Response:**

```json
{"results": {"00416400910670863867": ["Apple", "AAPL", "Apple Inc", "Apple Inc."]}}
```

---

### Batch entity name lookup

`POST /entities/names`

Look up canonical display names for multiple entities by their NEIDs in a single request.

#### Request Body

Batch names request

**Type:** `BatchEntityNamesRequest`

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Entity names (`BatchEntityNamesResponse`) |
| 400 | Invalid request (`Error`) |

#### Example

**Request:**

```
POST /entities/names
{"neids": ["00416400910670863867", "03016672914748108965"]}
```

**Response:**

```json
{"results": {"00416400910670863867": "Apple", "03016672914748108965": "MSFT"}}
```

---

### Get canonical NEIDs for merges

`POST /entities/redirect`

Get the canonical NEIDs for a set of entities, resolving any merges. If an entity has been merged into another, the canonical NEID of the merge target is returned.

#### Request Body

Redirect request

**Type:** `RedirectRequest`

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Redirect results (`RedirectResponse`) |
| 400 | Invalid request (`Error`) |

#### Example

**Request:**

```
POST /entities/redirect
{"neids": ["00416400910670863867", "03016672914748108965"]}
```

**Response:**

```json
{"redirects": [{"neid": "00416400910670863867", "canonicalNeid": "00416400910670863867"}, {"neid": "03016672914748108965", "canonicalNeid": "01234567890123456789"}]}
```

---

### Search for entities

`POST /entities/search`

Search for entities by name with scored ranking and optional disambiguation. Supports batch queries (multiple entities in one request). Content-Type must be application/json.

#### Request Body

Search request

**Type:** `SearchRequest`

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Search results (`SearchResponse`) |
| 400 | Invalid request (`Error`) |

#### Example

**Request:**

```
POST /entities/search
{"queries": [{"queryId": 1, "query": "Apple"}, {"queryId": 2, "query": "MSFT", "flavors": ["financial_instrument"]}], "maxResults": 3}
```

**Response:**

```json
{"results": [{"queryId": 1, "matches": [{"neid": "00416400910670863867", "name": "Apple", "flavor": "organization", "score": 0.95}]}, {"queryId": 2, "matches": [{"neid": "03016672914748108965", "name": "MSFT", "flavor": "financial_instrument", "score": 0.98}]}]}
```

---

### Get entity aliases

`GET /entities/{neid}/aliases`

Get all known aliases for an entity by its NEID. Includes the canonical name and all alternative names, abbreviations, and synonyms.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| neid | string | yes | Named Entity ID (20-character zero-padded) |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Entity aliases (`NindexToAliasesResponse`) |
| 404 | Entity not found (`Error`) |

#### Example

**Request:**

```
GET /entities/00416400910670863867/aliases
```

**Response:**

```json
{"aliases": ["Apple", "AAPL", "Apple Inc", "Apple Inc."]}
```

---

### Get entity name

`GET /entities/{neid}/name`

Get the canonical display name for an entity by its NEID. Works for all entity types (organizations, people, documents, etc.).

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| neid | string | yes | Named Entity ID (20-character zero-padded) |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Entity name (`NindexToNameResponse`) |
| 404 | Entity not found (`Error`) |

#### Example

**Request:**

```
GET /entities/05501022040203405417/name
```

**Response:**

```json
{"name": "Apple Inc"}
```

---

### Get property values for entities

`POST /elemental/entities/properties`

Retrieves property values for specified entities. Returns the current values of requested properties for each entity.

#### Guidance

Pass entity IDs as a JSON array in the 'eids' form field (eids and neids are interchangeable terms for entity IDs). Optionally filter to specific properties via 'pids'. If pids is omitted, returns all available properties. Set include_attributes=true to get additional metadata about each property value.

#### Request Body

**Content-Type:** `application/x-www-form-urlencoded`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| eids | string | yes | JSON array of entity IDs to get properties for |
| pids | string | no | JSON array of property IDs to retrieve (optional, omit for all properties) |
| include_attributes | string | no | Include property attributes in response (true/false) |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Property values retrieved successfully (`GetPropertyValuesResponse`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
POST /elemental/entities/properties
Content-Type: application/x-www-form-urlencoded

eids=["00416400910670863867"]&pids=[8]
```

**Response:**

```json
{"op_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "follow_up": false, "values": [{"eid": "00416400910670863867", "pid": 8, "value": "Apple", "recorded_at": "2026-01-15T10:30:00Z"}]}
```

## Types

### BatchEntityNamesResponse

| Field | Type | Description |
|-------|------|-------------|
| errors | string[] |  |
| results | object |  |

### Match

| Field | Type | Description |
|-------|------|-------------|
| aliases | string[] | Other names for this entity |
| created | boolean | True if newly created |
| flavor | string |  |
| name | string |  |
| neid | string | Named Entity ID |
| score | number | 0.0-1.0 |

### Redirect

| Field | Type | Description |
|-------|------|-------------|
| canonicalNeid | string | Named Entity ID |
| neid | string | Named Entity ID |

### SearchQuery

| Field | Type | Description |
|-------|------|-------------|
| context | integer[] | Additional context for disambiguation |
| contextType | `EntityContextType` |  |
| eventCategory | string | Category of an event, e.g. strategic partnership |
| eventDate | string | Date of an event, e.g. 2026-01-20 |
| eventDescription | string | Description of an event |
| eventLikelihood | string | Likelihood of an event, e.g. confirmed, ongoing, likely, speculative |
| flavors | string[] | Limit to these flavors if non-empty |
| query | string | Entity name or strong ID to search for |
| queryId | integer | User-provided ID for matching with response |
| snippet | string | Free-text snippet for disambiguating named entities |
| strongIdProperty | string | Property to use as the strong ID type |

### SearchRequest

| Field | Type | Description |
|-------|------|-------------|
| includeAliases | boolean | default false |
| includeFlavors | boolean | default true |
| includeNames | boolean | default true |
| includeScores | boolean | default true |
| maxResults | integer | default 10 |
| minScore | number | 0.0-1.0, default 0.8 |
| queries | `SearchQuery`[] |  |

### SearchResult

| Field | Type | Description |
|-------|------|-------------|
| error | string | Set if query failed |
| matches | `Match`[] | Sorted by decreasing score |
| queryId | integer |  |

### GetPropertyValuesResponse

| Field | Type | Description |
|-------|------|-------------|
| **values** | `PropertyValue`[] | Array of property values for the requested entities |

### PropertyValue

| Field | Type | Description |
|-------|------|-------------|
| **eid** | string | Entity ID this property value belongs to |
| **pid** | integer | Property ID |
| **value** | any | Property value (type varies by property: string, number, boolean, or entity ID) |
| recorded_at | string (date-time) | Timestamp when this value was recorded |
| imputed | boolean | Whether this value was imputed (inferred) rather than directly observed |
| attributes | object | Additional metadata about this property value (when include_attributes=true) |

<!-- END GENERATED CONTENT -->
