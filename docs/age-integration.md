# Apache AGE Integration — Sulcus Graph Database

## Overview

Sulcus uses [Apache AGE](https://age.apache.org/) (A Graph Extension) to provide native graph database capabilities on top of PostgreSQL. AGE enables openCypher queries for traversing the memory graph — finding relationships, paths, and clusters across memory nodes.

## Architecture

### Before AGE
- Memory nodes stored in `golden_index` table
- Edges stored in `golden_edges` table  
- Graph traversal via hand-rolled SQL JOINs
- No native path queries, community detection, or variable-length traversal

### With AGE
- Same PostgreSQL database — AGE is an extension, not a separate service
- openCypher queries for graph traversal
- Native `MATCH`, `SHORTESTPATH`, variable-length patterns
- Coexists with existing relational tables (golden_index, golden_edges)

## Infrastructure

### Azure (Production)
- **Service:** Azure Database for PostgreSQL Flexible Server
- **Server:** `sulcus-db.postgres.database.azure.com`
- **Version:** PostgreSQL 16
- **AGE Version:** 1.6.0 (Preview)
- **Resource Group:** `sulcus-rg`
- **SKU:** Standard_B1ms (Burstable)

### Configuration
```
azure.extensions = vector,uuid-ossp,age
shared_preload_libraries = pg_cron,pg_stat_statements,age
```

### Local (sulcus)
- **pg-embed** downloads PG 17.8.0 from zonky.io
- AGE not included in stock pg-embed bundles
- Local graph queries fall back to standard SQL (compatibility layer)
- Future: compile AGE extension for local PG or use Docker

## Graph Schema

### Graph Name
`sulcus_graph` — single graph per database, tenant isolation via vertex properties.

### Vertex Labels
- `Memory` — a memory node (maps to `golden_index` row)
  - Properties: `node_id` (UUID), `tenant_id`, `memory_type`, `label`, `heat`, `namespace`, `created_at`, `updated_at`

### Edge Labels  
- `RELATES_TO` — semantic relationship between memories
  - Properties: `weight` (f32), `edge_type` (string)
- `TEMPORAL_PROXIMITY` — memories created close in time
  - Properties: `weight` (f32), `time_delta_s` (i64)
- `SESSION_LINK` — memories from the same session (future)
  - Properties: `session_id` (UUID)
- `RESONANCE` — heat propagation path
  - Properties: `spread_factor` (f32), `hop` (i32)

## Query Examples

### Find related memories within 2 hops
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[*1..2]-(b:Memory)
  WHERE a.node_id = 'some-uuid' AND b.heat > 0.3
  RETURN b.label, b.heat, b.memory_type
$$) AS (label agtype, heat agtype, memory_type agtype);
```

### Session cluster — all memories from a session
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[:SESSION_LINK]-(b:Memory)
  WHERE a.session_id = 'session-uuid'
  RETURN b
$$) AS (memory agtype);
```

### Heat propagation path
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH path = shortestPath((a:Memory)-[:RESONANCE*..5]-(b:Memory))
  WHERE a.node_id = 'source-uuid' AND b.node_id = 'target-uuid'
  RETURN path
$$) AS (path agtype);
```

### Community detection (memories that cluster together)
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[r:RELATES_TO]->(b:Memory)
  WHERE a.tenant_id = 'tenant-id' AND r.weight > 0.5
  RETURN a.label, collect(b.label) AS related
$$) AS (label agtype, related agtype);
```

## Migration Path

### Phase 1: Enable (current)
1. ✅ Add `age` to `azure.extensions` allowlist
2. ✅ Add `age` to `shared_preload_libraries`
3. ✅ Restart PG server
4. `CREATE EXTENSION age;`
5. `SELECT * FROM ag_catalog.create_graph('sulcus_graph');`

### Phase 2: Dual-write
- Continue writing to `golden_index` + `golden_edges` (relational)
- Also write vertices/edges to `sulcus_graph` (AGE)
- Read queries still use relational tables
- Validate data consistency between both representations

### Phase 3: AGE-primary reads
- Graph traversal queries switch to Cypher
- Relational tables become the source-of-truth for flat queries (list, filter, sort)
- AGE handles relationship queries (related, path, cluster)

### Phase 4: Full AGE
- All graph operations through AGE
- `golden_edges` table deprecated (data lives in AGE graph)
- `golden_index` retained for flat queries + compatibility

## Local Compatibility

sulcus runs on pg-embed which doesn't include AGE. Strategy:

1. **Graph queries disabled locally** — `is_age_available()` check at startup
2. **Fallback SQL** — existing JOIN-based queries continue to work
3. **Future:** Ship `age.dylib` as another optional library in `~/.sulcus/lib/`
4. **Docker option:** `docker run -p 5432:5432 apache/age` for local dev with AGE

## Monitoring

- `SELECT * FROM ag_catalog.ag_graph;` — list graphs
- `SELECT * FROM ag_catalog.ag_label;` — list vertex/edge labels
- `SELECT count(*) FROM cypher('sulcus_graph', $$ MATCH (n) RETURN n $$) AS (n agtype);` — vertex count

## References

- [Apache AGE Documentation](https://age.apache.org/age-manual/master/index.html)
- [AGE on Azure](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions)
- [openCypher Specification](https://opencypher.org/)
- Author: Digital Forge Studios <contact@dforge.ca>
