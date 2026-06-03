# Server

The server endpoint provides server health and status information. Use it to verify the Query Server is running.

## When to Use

- You need to verify the server is operational before making queries
- You're debugging connection or availability issues

## Key Concepts

- **Server Status**: Whether the server is healthy and responding

## Tips

- Call health first if other endpoints are failing to rule out server issues

<!-- BEGIN GENERATED CONTENT -->

## Endpoints

### Get server status

`GET /status`

Get status information about the Query Server including instance UUID, start time, data range, and capabilities

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Server status information (`StatusResponse`) |
| 500 | Internal server error (`Error`) |

#### Example

**Request:**

```
GET /status
```

**Response:**

```json
{"qs_instance_uuid": "fb6d99f8-327f-4d51-9ae4-f947efb5f7da", "qs_start_time": "2026-01-29T22:10:24.550922989Z", "data_min_date": "2026-02-03T02:02:04.35431602Z", "data_max_date": "2026-02-03T04:02:04.354316094Z", "capabilities": ["elemental_api", "sentiment", "knowledge", "ada"]}
```

---

### Health check (query parameters)

`GET /elemental/health`

Check the health status of the Elemental API service using query parameters.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| deadline | any | no | Response deadline in milliseconds or duration format (e.g., '500ms') |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Health check successful (`HealthResponse`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 500 | Internal server error (`Error`) |
| 501 | Elemental API capability not enabled (`Error`) |

#### Example

**Request:**

```
GET /elemental/health?deadline=500
```

**Response:**

```json
{"op_id": "73f13792-5d18-4519-a0ec-0a25cbc85b00", "follow_up": false, "status": "healthy", "ts": "2026-02-03T03:02:04.170028579Z", "version": "0.2.0", "start_time": "2026-01-29T22:10:24.550922989Z"}
```

---

### Health check (form data)

`POST /elemental/health`

Check the health status of the Elemental API service using form-encoded parameters.

#### Request Body

**Content-Type:** `application/x-www-form-urlencoded`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| deadline | any | no | Response deadline in milliseconds or duration format |

#### Responses

| Status | Description |
|--------|-------------|
| 200 | Health check successful (`HealthResponse`) |
| 400 | Bad request - invalid parameters or malformed expression (`Error`) |
| 500 | Internal server error (`Error`) |
| 501 | Elemental API capability not enabled (`Error`) |

#### Example

**Request:**

```
POST /elemental/health
Content-Type: application/x-www-form-urlencoded

deadline=500
```

**Response:**

```json
{"op_id": "73f13792-5d18-4519-a0ec-0a25cbc85b00", "follow_up": false, "status": "healthy", "ts": "2026-02-03T03:02:04.170028579Z", "version": "0.2.0", "start_time": "2026-01-29T22:10:24.550922989Z"}
```

## Types

### StatusResponse

Status information about the Query Server instance

| Field | Type | Description |
|-------|------|-------------|
| capabilities | `Capability`[] | Capabilities enabled on this QS instance |
| data_max_date | string | Maximum date of available data @Format date-time |
| data_min_date | string | Minimum date of available data @Format date-time |
| extrapolated_max_date | string | Extrapolated maximum date (unset if realtime isn't enabled on this server) @Format date-time |
| qs_instance_uuid | string | UUID of this QS instance. Changes every time the QS restarts. |
| qs_start_time | string | When this QS instance was started @Format date-time |

### BaseResponse

Common response fields for all Elemental API operations

| Field | Type | Description |
|-------|------|-------------|
| **op_id** | string (uuid) | Unique operation identifier for tracking and follow-up requests |
| **follow_up** | boolean | Whether additional results are available via follow-up request |
| error | string | Error code if operation failed |
| min_sl | integer | Minimum security level in response |
| max_sl | integer | Maximum security level in response |

### HealthResponse

| Field | Type | Description |
|-------|------|-------------|
| health | `HealthData` |  |

### HealthData

| Field | Type | Description |
|-------|------|-------------|
| **status** | string | Current health status of the service. Values: `healthy`, `degraded`, `unhealthy` |
| **ts** | string (date-time) | Timestamp of the health check |
| **version** | string | Service version information |
| **uptime** | integer | Service uptime in nanoseconds |

### TimeRange

Time range with optional start and end times

| Field | Type | Description |
|-------|------|-------------|
| start | string (date-time) | Start time of the range |
| end | string (date-time) | End time of the range |

### Error

| Field | Type | Description |
|-------|------|-------------|
| **error** | string | Error code or brief description |
| error_message | string | Detailed error message |

<!-- END GENERATED CONTENT -->
