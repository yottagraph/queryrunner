# Graph

The graph endpoints are focused on "graph analysis". This includes, but is not limited to, visual rendering of a graph.

## When to Use

- You want to explore the entities that are most directly related to a given center entity (the "neighborhood" of entities)
- You want to understand the relationships between entities and their neighbors
- You need to create a visual representation of entity relationships
- You need layout coordinates for rendering a graph

## Key Concepts

- **Graph Layout**: Computed positions for nodes (entities) and edges (relationships)
- **Neighborhood**: The set of entities directly connected to a focal entity
- **Neighborhood History**: How the neighborhood has changed over time

## Tips

- Start with a single focal entity (center NEID) to get its immediate neighborhood
- Graph endpoints return relationships between entities as well as layout data optimized for visualization

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

### Get graph layout

`GET /graph/{center_neid}/layout`

Get nodes and edges layout data for visualizing a relationship graph. Response is cached for 5 minutes.

#### Guidance

This should always be called with a non-empty list of neids. A typical pattern is to call /graph/{center_neid}/neighborhood and then use the returned NEIDs to call this endpoint.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| center_neid | string | yes | Center entity NEID |
| neid | string[] | no | Additional entity NEIDs to include in layout |
| borderMinX | number | no | Minimum X border for layout |
| borderMinY | number | no | Minimum Y border for layout |
| borderMaxX | number | no | Maximum X border for layout |
| borderMaxY | number | no | Maximum Y border for layout |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Graph layout with nodes and edges (`GraphLayoutResponse`) |
| 400 | Invalid parameters (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /graph/00416400910670863867/layout?neid=04358848009837283240
```

**Response:**

```json
{"nodes": [{"neid": "00416400910670863867", "label": "organization|Apple|nationality: us...", "isCentralNode": true, "x": -333.33, "y": -200, "width": 666.67, "height": 266.67}], "edges": [{"source": "00416400910670863867", "target": "04358848009837283240", "label": "competes_with", "path": [{"X": 0, "Y": 0}, {"X": 0, "Y": 66.67}], "article_ids": ["02861951941133789623"], "snippets": ["Apple and Google are mentioned as companies..."], "weight": 0.0267}]}
```

---

### Get graph neighborhood

`GET /graph/{center_neid}/neighborhood`

Get list of neighboring entities in the relationship graph, optionally filtered by entity type. Response is cached for 5 minutes.

#### Guidance

Response includes the center entity itself in the results with a weight of 1.0. The 'neighbors' and 'weights' arrays are parallel (same indices correspond).

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| center_neid | string | yes | Center entity NEID |
| size | integer | no | Maximum number of neighbors to return |
| type | string[] | no | Filter by entity type(s) |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Neighbors and their weights (`GraphNeighborhoodResponse`) |
| 400 | Invalid parameters (`Error`) |
| 404 | Center entity not found (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /graph/00416400910670863867/neighborhood?size=5
```

**Response:**

```json
{"neighbors": ["00416400910670863867", "04358848009837283240", "00315863961550087877"], "weights": [1, 0.0267, 0.0167]}
```

---

### Get neighborhood history

`GET /graph/{center_neid}/neighborhood/history`

Get historical data about influential neighbors for an entity over time. Response is cached for 5 minutes.

#### Guidance

Response includes the center entity itself in each day's results with an influence of 1.0.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| center_neid | string | yes | Center entity NEID |
| size | integer | no | Maximum number of neighbors per day to return |
| type | string[] | no | Filter by entity type(s) |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Historical neighborhood data (`GraphNeighborhoodHistoryResponse`) |
| 400 | Invalid parameters (`Error`) |
| 404 | Center entity not found (`Error`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /graph/00416400910670863867/neighborhood/history?size=3
```

**Response:**

```json
{"history": [{"date": "2025-12-30T00:00:00Z", "neighbors": [{"neid": "00416400910670863867", "influence": 1}, {"neid": "04015955446548481006", "influence": 0.072}]}]}
```

## Types

### GraphEdge

An edge between two nodes in the graph

| Field | Type | Description |
|-------|------|-------------|
| article_ids | string[] | Article IDs associated with this edge |
| label | string | Display label for the edge |
| path | `GraphVector`[] | Path points for rendering the edge |
| snippets | string[] | Text snippets describing the relationship |
| source | string | Source node NEID |
| target | string | Target node NEID |
| weight | number | Weight/strength of the edge |

### GraphLayoutResponse

Response containing graph layout for visualization

| Field | Type | Description |
|-------|------|-------------|
| edges | `GraphEdge`[] | List of graph edges |
| nodes | `GraphNode`[] | List of graph nodes |

### GraphNeighborhoodHistoryResponse

Response containing historical influential neighbor data over time

| Field | Type | Description |
|-------|------|-------------|
| history | `NeighborhoodHistoryEntry`[] | List of historical neighborhood entries |

### GraphNeighborhoodResponse

Response containing neighbors of an entity in the relationship graph

| Field | Type | Description |
|-------|------|-------------|
| neighbors | string[] | List of neighbor NEIDs |
| weights | number[] | Weights corresponding to each neighbor (same order as neighbors) |

### GraphNode

A node in the graph layout

| Field | Type | Description |
|-------|------|-------------|
| height | number | Height of the node for rendering |
| isCentralNode | boolean | Whether this is the central/focus node |
| label | string | Display label for the node |
| neid | string | Named Entity ID |
| width | number | Width of the node for rendering |
| x | number | X coordinate in the layout |
| y | number | Y coordinate in the layout |

### GraphVector

A 2D point in the graph layout

| Field | Type | Description |
|-------|------|-------------|
| X | number | X coordinate |
| Y | number | Y coordinate |

### InfluenceEntry

A neighbor and their influence score

| Field | Type | Description |
|-------|------|-------------|
| influence | number | Influence score |
| neid | string | Named Entity ID |

### NeighborhoodHistoryEntry

Influential neighbors for a specific date

| Field | Type | Description |
|-------|------|-------------|
| date | string | Date of the history entry @Format date-time |
| neighbors | `InfluenceEntry`[] | List of influential neighbors on this date |

<!-- END GENERATED CONTENT -->
