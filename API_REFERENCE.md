# SULCUS API Reference (v1)

Base URL: `http://<server-ip>:3000/api/v1`

## Authentication
All endpoints require the header:
`Authorization: Bearer <api-key>`

---

## 1. POST `/agent/sync`
The primary synchronization endpoint. Synchronizes local WAL operations with the server's Golden Index.

**Request Body:**
```json
{
  "ops": [
    {
      "op": "Add",
      "payload": { "id": "...", "label": "...", "pointer_summary": "...", ... },
      "timestamp": "2026-03-03T00:00:00Z"
    }
  ],
  "last_cursor": "2026-03-02T12:00:00Z"
}
```

**Response Body:**
```json
{
  "new_ops": [...],
  "new_cursor": "2026-03-03T00:01:00Z",
  "new_cursor_seq": 42
}
```

---

## 2. GET `/agent/hot_nodes`
Returns the most relevant (hottest) nodes for the current tenant.

**Query Parameters:**
- `limit` (default: 20): Number of nodes to return.

---

## 3. GET `/metrics`
Returns internal server metrics (DB size, index size, ops count).

---

## 4. POST `/agent/search` (Planned)
Perform a semantic search directly against the server's Golden Index.
