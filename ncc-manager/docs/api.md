# Internal API Documentation

The NCC Manager backend provides a REST API for local persistence of drafts and configuration.

## Base URL
The default base URL is `http://127.0.0.1:5179`.

## Endpoints

### GET `/api/defaults`
Returns the default configuration for the application.

**Response Body:**
```json
{
  "relays": ["wss://...", "..."],
  "storage": { "server": true },
  "app": { "name": "NCC Manager", "version": "0.6.4" }
}
```

### GET `/api/storage`
Returns the storage status and the path to the SQLite database.

**Response Body:**
```json
{
  "server": true,
  "db_path": "/path/to/ncc_manager.sqlite"
}
```

### GET `/api/drafts`
Lists all drafts stored on the server.

**Query Parameters:**
- `kind` (optional): Filter by Nostr event kind.

**Response Body:**
```json
{
  "drafts": [
    { "id": "...", "kind": 30050, "d": "ncc-01", "status": "draft", ... }
  ]
}
```

### POST `/api/drafts`
Saves or updates a draft.

**Request Body:** A draft object (must include `id` and `kind`).

**Response Body:**
```json
{ "draft": { ... } }
```

### GET `/api/drafts/:id`
Retrieves a specific draft by its local ID.

### DELETE `/api/drafts/:id`
Deletes a draft from the server.

### GET `/api/endorsements/counts`
Returns an aggregated count of endorsements for each NCC event ID.

**Response Body:**
```json
{
  "counts": {
    "<event-id>": 5,
    "<another-event-id>": 2
  }
}
```
