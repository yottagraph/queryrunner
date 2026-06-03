# Schema

The schema defines the data model: what **entity types** (flavors) exist and what **properties** they can have. Understanding the schema is essential for constructing queries and interpreting results.

## When to Use

- You need to discover available entity types (flavors) and their IDs (FIDs)
- You need to discover available properties and their IDs (PIDs)
- You need human-readable names, units, or domain information for properties
- You're exploring the data model before constructing a search expression

## Key Concepts

- **Flavors** = Entity types. Each entity belongs to exactly one flavor.
  - Examples: "organization" (FID 10), "person" (FID 9), "financial_instrument" (FID 3)
  - Identified by a Flavor ID (FID) — a small integer
- **Properties** = Attributes that entities can have. Each property has:
  - A Property ID (PID) — a small integer
  - A name (e.g., "name", "length", "mailing_address", "acquires")
  - A data type (e.g., "data_cat" for text, "data_float" for numbers)
  - Domain flavors — which entity types can have this property
- **Attribute Types** = Metadata that can be attached to property values (e.g., sentiment scores, URLs, snippets). When `getPropertyValues` returns `include_attributes=true`, the attribute keys are numeric strings representing Attribute IDs (AIDs). **AIDs are a separate namespace from PIDs** — for example, PID 15 is "industry" but AID 15 is "sentiment". Use the schema `attributes` array to resolve these.

## Choosing a Schema Endpoint

There are two schema endpoints with different levels of detail:

| Endpoint | Flavors include | Properties include | Attributes include |
|----------|-----------------|-------------------|--------------------|
| `GET /schema` | findex, name, singular/plural display names | pid, name, display_name, unit, value_type, domain_findexes, target_findexes | aid, name, atype, applicable_properties, description |
| `GET /elemental/metadata/schema` | fid, name only | pid, name, type only | aid, name, atype, applicable_properties, description |

**Use `/schema`** (recommended) when you need:
- Human-readable display names (e.g., "Organization" vs "organization")
- Units of measurement (e.g., "m", "kg")
- Which flavors a property applies to (`domain_findexes`)

**Use `/elemental/metadata/schema`** when you just need basic FID/PID to name mappings.

## Tips

- Many API responses return only FIDs and PIDs (not names) — use the schema to translate these to human-readable names
- When `getPropertyValues` returns attributes with numeric keys (e.g., `"15": -0.3`), look up the key in the schema `attributes` array by `aid` to find the name (e.g., `aid: 15` → "sentiment")
- Cache schema results; the data model changes infrequently
- Use `/elemental/metadata/properties/{pid}/summary` to understand value distributions before filtering

### Flavor ID field names: `findex` vs `fid`

The flavor identifier field has **different names** depending on the endpoint:

| Endpoint | Field name | Example |
|----------|-----------|---------|
| `GET /schema` | `findex` | `{"findex": 12, "name": "article"}` |
| `GET /elemental/metadata/schema` | `fid` | `{"fid": 12, "name": "article"}` |

These contain the same value — just different keys. When writing code that
consumes schema responses, always handle both:

```typescript
const articleFlavor = flavors.find(f => f.name === 'article');
const articleFid = articleFlavor?.fid ?? articleFlavor?.findex ?? null;
```

The `is_type` expression in `find.md` always uses `fid` regardless of which
schema endpoint you used to discover the value.

## Common Workflow

1. **Get the schema** → `GET /schema` to learn available flavors and properties
2. **Find entities of a type** → `POST /elemental/find` with `is_type` expression
3. **Get property values** → `POST /elemental/entities/properties` to fetch values for those entities

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

### Get detailed schema information

`GET /schema`

Returns detailed schema information including entity types (flavors) with display names, properties with display names, units, and domain/target relationships, and quad attribute types. This endpoint provides more detail than /elemental/metadata/schema.

#### Guidance

This endpoint returns richer metadata than /elemental/metadata/schema, including display names, units, relationship domains, and attribute type definitions. Use this when you need human-readable names or property metadata. The attributes array maps numeric attribute IDs (AIDs) to names — use it to resolve the numeric keys returned by getPropertyValues with include_attributes=true.

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Schema information (`SchemaResponse`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /schema
```

**Response:**

```json
{"flavors": [{"findex": 9, "name": "person", "singular_display_name": "Person", "plural_display_name": "People"}, {"findex": 10, "name": "organization", "singular_display_name": "Organization", "plural_display_name": "Organizations"}], "properties": [{"pid": 8, "name": "name", "display_name": "Name", "value_type": "data_cat"}, {"pid": 15, "name": "industry", "display_name": "Industry", "value_type": "data_cat"}], "attributes": [{"aid": 15, "name": "sentiment", "atype": "float", "applicable_properties": ["appears_in", "participant", "sentiment"], "description": "A sentiment score in [-1, +1]."}]}
```

---

### Find entities by expression

`POST /elemental/find`

Search for entities using a powerful expression language. The expression parameter supports complex nested queries with logical operators, geographic constraints, property comparisons, and more.

#### Guidance

CRITICAL: This endpoint REQUIRES Content-Type: application/x-www-form-urlencoded. Sending a JSON body will fail with 400 error. The expression parameter must be URL-encoded form data, not a JSON request body. For the full expression language reference including all expression types, comparison operators, and examples, see find.md.

#### Request Body

**Content-Type:** `application/x-www-form-urlencoded`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| expression | string | yes | JSON-encoded expression object defining the search criteria |
| deadline | any | no | Response deadline in milliseconds or duration format |
| limit | integer | no | Maximum number of entity IDs to return in first response |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Find operation successful (`FindResponse`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 500 | Internal server error (`Error`) |
| 501 | Elemental API capability not enabled (`Error`) |

#### Example

**Request:**

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"is_type","is_type":{"fid":10}}&limit=5
```

**Response:**

```json
{"op_id": "98cc54e9-0108-4361-9c96-18ea97cda7a2", "follow_up": true, "eids": ["01601807036815568643", "08115040994665529432", "02045070050429461063"]}
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

---

### Get complete schema information

`GET /elemental/metadata/schema`

Returns comprehensive schema information including all entity types (flavors), properties, and their attributes. This endpoint provides the complete data model available in the system.

#### Guidance

Response is wrapped in a 'schema' container object. Access flavors and properties via response.schema.flavors and response.schema.properties. Flavors contain: fid (unique identifier), name (e.g., 'organization', 'person'). Properties contain: pid (unique identifier), name (e.g., 'name', 'industry'), type (e.g., 'data_float', 'data_int', 'data_cat', 'data_nindex').

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Schema information retrieved successfully (`GetSchemaResponse`) |
| 500 | Internal server error (`Error`) |
| 501 | Elemental API capability not enabled (`Error`) |

#### Example

**Request:**

```
GET /elemental/metadata/schema
```

**Response:**

```json
{"op_id": "40dc4cd9-f1b2-4b5c-85d0-c7c61256e5d9", "follow_up": false, "schema": {"flavors": [{"fid": 9, "name": "person"}, {"fid": 10, "name": "organization"}, {"fid": 3, "name": "financial_instrument"}], "properties": [{"pid": 8, "name": "name", "type": "data_cat"}, {"pid": 15, "name": "industry", "type": "data_cat"}]}}
```

---

### Get property value summary

`GET /elemental/metadata/properties/{pid}/summary`

Returns summary statistics for a specific property including value distribution, ranges for numeric properties, and unique values for categorical properties.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| pid | integer | yes | Property ID to summarize |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Property summary retrieved successfully (`SummarizePropertyResponse`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 401 | Authentication required or authentication failed (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /elemental/metadata/properties/8/summary
```

**Response:**

```json
{"op_id": "a337cd9c-6483-4472-a30b-e875ba7f2b21", "follow_up": false, "pid": 8, "value_type": "categorical"}
```

## Types

### SchemaAttribute

Quad attribute type used as keys in property value attributes

| Field | Type | Description |
|-------|------|-------------|
| aid | integer | Unique attribute type identifier. Appears as a string key (e.g., "15") in property value attributes. |
| applicable_properties | string[] | Property names that commonly carry this attribute (e.g., ["appears_in", "participant"]) |
| atype | string | Attribute data type: "float", "int", "bool", or "blob" (string values) |
| description | string | Semantic description of what this attribute represents |
| name | string | Attribute name (e.g., "sentiment", "url", "snippet") |

### SchemaFlavor

Entity type (flavor) with human-readable display names

| Field | Type | Description |
|-------|------|-------------|
| description | string | Semantic description of what this flavor represents |
| findex | integer | Unique flavor identifier (same as fid in other endpoints) |
| name | string | Flavor name (internal identifier) |
| plural_display_name | string | Human-readable plural name (e.g., "People") |
| singular_display_name | string | Human-readable singular name (e.g., "Person") |

### SchemaProperty

Property with display name, unit, and domain information

| Field | Type | Description |
|-------|------|-------------|
| description | string | Semantic description of what this property represents |
| display_name | string | Human-readable property name |
| domain_findexes | integer[] | Flavor IDs (findexes) that can have this property |
| name | string | Property name (internal identifier) |
| pid | integer | Unique property identifier |
| target_findexes | integer[] | For relationship properties, the flavor IDs of valid targets |
| unit | string | Unit of measurement (e.g., "m", "kg", "knots") |
| value_type | string | Property data type. Possible values: "data_float", "data_int", "data_bool", "data_cat", "data_nindex" |

### SchemaResponse

Detailed schema response with entity types (flavors), properties, and quad attribute types

| Field | Type | Description |
|-------|------|-------------|
| attributes | `SchemaAttribute`[] | Array of quad attribute types that appear as keys in property value attributes (when include_attributes=true). These use a separate ID namespace (AID) from property PIDs. |
| flavors | `SchemaFlavor`[] | Array of entity types (flavors) with display names |
| properties | `SchemaProperty`[] | Array of properties with display names, units, and domain information |

### FindResponse

| Field | Type | Description |
|-------|------|-------------|
| find | `FindData` |  |

### FindData

| Field | Type | Description |
|-------|------|-------------|
| **eids** | string[] | Array of 20-character entity IDs matching the search expression |

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

### GetSchemaResponse

| Field | Type | Description |
|-------|------|-------------|
| **schema** | `SchemaData` |  |

### SchemaData

| Field | Type | Description |
|-------|------|-------------|
| **flavors** | `Flavor`[] | Array of entity types (flavors) available in the system |
| **properties** | `Property`[] | Array of properties available in the system |
| attributes | `Attribute`[] | Array of quad attribute types. These map the numeric keys in property value attributes (from include_attributes=true) to human-readable names. AIDs are a separate namespace from property PIDs. |

### Attribute

| Field | Type | Description |
|-------|------|-------------|
| **aid** | integer | Unique attribute type identifier. Appears as a string key (e.g., "15") in property value attributes. |
| **name** | string | Attribute name |
| **atype** | string | Attribute data type. Values: `float`, `int`, `bool`, `blob` |
| applicable_properties | string[] | Property names that commonly carry this attribute |
| description | string | Semantic description of what this attribute represents |

### Flavor

| Field | Type | Description |
|-------|------|-------------|
| **fid** | integer | Unique flavor identifier |
| **name** | string | Flavor name |

### Property

| Field | Type | Description |
|-------|------|-------------|
| **pid** | integer | Unique property identifier |
| **name** | string | Property name |
| **type** | string | Property data type. Values: `data_float`, `data_int`, `data_bool`, `data_cat`, `data_nindex` |

### SummarizePropertyResponse

| Field | Type | Description |
|-------|------|-------------|
| **pid** | integer | The property ID that was summarized |
| **value_type** | string | Type of property values. Values: `numeric`, `categorical` |
| unique_count | integer | Number of unique values |
| values | string[] | Array of unique values for categorical properties |
| numeric_min | number | Minimum value for numeric properties |
| numeric_max | number | Maximum value for numeric properties |
| numeric_mean | number | Mean value for numeric properties |

<!-- END GENERATED CONTENT -->
