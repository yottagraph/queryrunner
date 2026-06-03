# Find (Expression Language)

The `/elemental/find` endpoint searches for entities using a JSON expression language. Expressions can filter by entity type, compare property values, traverse relationships, and combine conditions with logical operators.

## When to Use

- You need to search for entities matching specific criteria (type, property values, relationships)
- You need to combine multiple filters
- You need to find entities connected to a given entity via the relationship links

## Expression Structure

Every expression is a JSON object with a `type` field that determines which other fields are required:

```json
{"type": "<expression_type>", "<expression_type>": { ... }}
```

Expressions are passed as URL-encoded form data in the `expression` parameter (NOT as a JSON request body).

## Common Mistakes

These errors come up repeatedly. Check this section before constructing expressions.

### Using `comparison` to filter by entity type

**Wrong** — `comparison` with `pid: 0` fails:
```json
{"type": "comparison", "comparison": {"operator": "eq", "pid": 0, "value": 12}}
```
→ Error: "Comparison expression requires pid != 0"

**Right** — use `is_type`:
```json
{"type": "is_type", "is_type": {"fid": 12}}
```

### Using `string_like` on non-name properties

`string_like` **only works on the name property (PID 8)**. Any other PID returns an error.

**Wrong:**
```json
{"type": "comparison", "comparison": {"operator": "string_like", "pid": 115, "value": "Politics"}}
```
→ Error: "string_like only supports the 'name' property (pid=8)"

**Right** — use `eq` for exact matches on other properties, or fetch all results and filter client-side:
```json
{"type": "comparison", "comparison": {"operator": "eq", "pid": 115, "value": "Politics"}}
```

### Using `conjunction` / `disjunction` instead of `and` / `or`

**Wrong:**
```json
{"type": "conjunction", "conjunction": {"operator": "and", "expressions": [...]}}
```

**Right:**
```json
{"type": "and", "and": [expression1, expression2]}
```

### Using `lt` / `gt` on non-numeric properties

`lt` and `gt` only work on `data_int` and `data_float` properties. Using them on strings or categories returns an error.

## Expression Types

| Type | Description | Key Fields | Status |
|------|-------------|------------|--------|
| `is_type` | Filter entities by type (flavor) | `is_type.fid` (integer) | Implemented |
| `comparison` | Compare a property value | `comparison.operator`, `comparison.pid`, `comparison.value` | Partial — see operator table and limitations below |
| `linked` | Find entities linked via relationships | `linked.distance`, `linked.to_entity`, `linked.pids` | Implemented |
| `and` | All sub-expressions must match | `and` (array of expressions) | Implemented |
| `or` | At least one sub-expression must match | `or` (array of expressions) | Implemented |
| `not` | Negate an expression | `not` (single expression) | Implemented |

### `is_type` -- Filter by Entity Type

Returns all entities of a given flavor (type). Look up FIDs via `GET /elemental/metadata/schema` (see schema.md).

```json
{"type": "is_type", "is_type": {"fid": 1}}
```

### `comparison` -- Compare Property Values

Compares a property (identified by PID) against a value. Look up PIDs via the schema endpoints (see schema.md).

```json
{"type": "comparison", "comparison": {"operator": "string_like", "pid": 8, "value": "PACIFIC"}}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| operator | string | yes | One of: `string_like`, `eq`, `lt`, `gt`, `regex`, `has_value` |
| pid | integer | yes | Property ID to compare (must be non-zero) |
| value | any | depends | Value to compare against (not required for `has_value`) |
| accept_imputed | boolean | no | Include imputed (inferred) values in the comparison (default: false). Parsed but not yet used by any operator. |

**Operators:**

| Operator | Description | Value Type | Limitations |
|----------|-------------|------------|-------------|
| `string_like` | Case-insensitive substring match | string | **NAME PROPERTY ONLY (PID 8)**. Fails with error on any other PID. Use `eq` for other string properties. |
| `has_value` | Property has any value (value field not needed) | n/a | — |
| `eq` | Equal to | string, number, or boolean | Type-aware; works on any property |
| `lt` | Less than | number | Numeric properties only (`data_int`, `data_float`) |
| `gt` | Greater than | number | Numeric properties only (`data_int`, `data_float`) |
| `regex` | Regular expression match | string (regex pattern) | **Not yet implemented** — returns error |

**Important:** The `pid` field must be non-zero. PID 0 is reserved; use `is_type` to filter by entity type instead of `comparison` with PID 0.

### `linked` -- Relationship Traversal

Finds entities linked to a target entity through the knowledge graph. See relationships.md for more on entity relationships.

```json
{"type": "linked", "linked": {"to_entity": "00416400910670863867", "distance": 1}}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| distance | integer | yes | Maximum relationship distance to traverse (minimum 1) |
| to_entity | string | no | Target entity ID (20-character zero-padded) |
| pids | integer[] | no | Property IDs defining which relationship types to follow |
| direction | string | no | Direction of traversal: `"outgoing"` (default) follows subject->value edges, `"incoming"` follows reverse (value->subject) edges, `"both"` unions both directions |

### `and` / `or` / `not` -- Logical Operators

Combine expressions with standard boolean logic. `and` and `or` take arrays of sub-expressions; `not` takes a single sub-expression.

```json
{"type": "and", "and": [
  {"type": "is_type", "is_type": {"fid": 1}},
  {"type": "comparison", "comparison": {"operator": "string_like", "pid": 8, "value": "PACIFIC"}}
]}
```

```json
{"type": "or", "or": [
  {"type": "is_type", "is_type": {"fid": 1}},
  {"type": "is_type", "is_type": {"fid": 2}}
]}
```

```json
{"type": "not", "not": {"type": "is_type", "is_type": {"fid": 1}}}
```

## Examples

### Find all organizations

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"is_type","is_type":{"fid":10}}&limit=100
```

### Find entities with "Apple" in the name

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"comparison","comparison":{"operator":"string_like","pid":8,"value":"Apple"}}
```

### Find organizations with "Global" in the name (combined AND)

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"and","and":[{"type":"is_type","is_type":{"fid":10}},{"type":"comparison","comparison":{"operator":"string_like","pid":8,"value":"Global"}}]}&limit=50
```

### Find entities linked to a specific entity

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"linked","linked":{"to_entity":"00416400910670863867","distance":1}}
```

### Exclude a type from results (NOT)

```
POST /elemental/find
Content-Type: application/x-www-form-urlencoded

expression={"type":"and","and":[{"type":"comparison","comparison":{"operator":"string_like","pid":8,"value":"Apple"}},{"type":"not","not":{"type":"is_type","is_type":{"fid":1}}}]}
```

## Tips

- Always look up FIDs and PIDs from the schema first (see schema.md) rather than hardcoding values
- Use `limit` to control result size; the response sets `follow_up: true` if more results are available
- Expressions can be deeply nested -- combine `and`, `or`, and `not` freely
- The `string_like` operator currently only works on the "name" property
- The `lt` and `gt` operators work on numeric properties (`data_int`, `data_float`) only; using them on non-numeric properties will return an error
- The `regex` comparison operator is defined in the schema but not yet implemented; using it will return an error
- The `accept_imputed` field is accepted on comparison expressions but has no effect yet

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

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

## Types

### FindResponse

| Field | Type | Description |
|-------|------|-------------|
| find | `FindData` |  |

### FindData

| Field | Type | Description |
|-------|------|-------------|
| **eids** | string[] | Array of 20-character entity IDs matching the search expression |

### Expression

| Field | Type | Description |
|-------|------|-------------|
| **type** | string | Type of expression. One of: is_type (filter by entity type), comparison (compare property values), linked (relationship traversal), and (logical AND), or (logical OR), not (logical NOT) |

### AndExpression

| Field | Type | Description |
|-------|------|-------------|
| **and** | `Expression`[] | Array of expressions that must all be true |

### OrExpression

| Field | Type | Description |
|-------|------|-------------|
| **or** | `Expression`[] | Array of expressions where at least one must be true |

### NotExpression

| Field | Type | Description |
|-------|------|-------------|
| **not** | `Expression` | Expression to negate |

### ComparisonExpression

| Field | Type | Description |
|-------|------|-------------|
| **comparison** | `Comparison` |  |

### IsTypeExpression

| Field | Type | Description |
|-------|------|-------------|
| **is_type** | `IsType` |  |

### LinkedExpression

| Field | Type | Description |
|-------|------|-------------|
| **linked** | `Linked` |  |

### Comparison

| Field | Type | Description |
|-------|------|-------------|
| **operator** | string | Comparison operator. One of: string_like (case-insensitive substring match), eq (equal to), lt (less than), gt (greater than), regex (regular expression match), has_value (property has any value, no value field needed) |
| **pid** | integer | Property identifier (PID) to compare against |
| value | any | Value to compare with (not required for has_value operator) |
| accept_imputed | boolean | Whether to include imputed property values in comparison |

### IsType

| Field | Type | Description |
|-------|------|-------------|
| **fid** | integer | Flavor identifier (FID) representing entity type |

### Linked

| Field | Type | Description |
|-------|------|-------------|
| **distance** | integer | Maximum relationship distance to traverse |
| pids | integer[] | Property identifiers defining the relationship types to follow |
| to_entity | string | Target entity ID for relationship traversal |
| direction | string | Direction of relationship traversal. 'outgoing' (default) follows subject->value edges, 'incoming' follows value->subject (reverse) edges, 'both' unions outgoing and incoming results. |

<!-- END GENERATED CONTENT -->
