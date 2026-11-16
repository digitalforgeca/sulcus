# Apache AGE Graph

## Overview

Sulcus uses [Apache AGE](https://age.apache.org/) (A Graph Extension) to provide native graph database capabilities on top of PostgreSQL. AGE enables openCypher queries for traversing the memory graph; finding relationships, paths, and clusters across memory nodes.

## Architecture

### Before AGE
- Memory nodes stored in `golden_index` table
- Edges stored in `golden_edges` table  
- Graph traversal via hand-rolled SQL JOINs
- No native path queries, community detection, or variable-length traversal

### With AGE
- Powered by Apache AGE in the managed Sulcus Cloud graph engine (`api.sulcus.ca`)
- openCypher queries for graph traversal
- Native `MATCH`, `SHORTESTPATH`, variable-length patterns
- Coexists with relational memory tables (`golden_index`, `golden_edges`)

## Runtime Environments

### Sulcus Cloud
- Powered by `api.sulcus.ca` with full Apache AGE graph engine enabled for all graph traversal, neighborhood, and temporal queries (`/api/v1/agent/graph/*`)
- Automatic synchronization between memory nodes and the knowledge graph

### Local Client
- `sulcus` runs an embedded PostgreSQL instance (`pg-embed`) out of the box with zero external dependencies
- Local graph queries automatically use a SQL compatibility layer when the AGE extension is not present in the local bundle

## Graph Schema

### Graph Name
`sulcus_graph`: single graph per database, tenant isolation via vertex properties.

### Vertex Labels
- `Memory`: a memory node (maps to `golden_index` row)
  - Properties: `node_id` (UUID), `tenant_id`, `memory_type`, `label`, `heat`, `namespace`, `created_at`, `updated_at`

### Edge Labels  
- `RELATES_TO`: semantic relationship between memories
  - Properties: `weight` (f32), `edge_type` (string)
- `TEMPORAL_PROXIMITY`: memories created close in time
  - Properties: `weight` (f32), `time_delta_s` (i64)
- `SESSION_LINK`: memories from the same session (future)
  - Properties: `session_id` (UUID)
- `RESONANCE`: heat propagation path
  - Properties: `spread_factor` (f32), `hop` (i32)

## Query Examples

### Related Memories
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[*1..2]-(b:Memory)
  WHERE a.node_id = 'some-uuid' AND b.heat > 0.3
  RETURN b.label, b.heat, b.memory_type
$$) AS (label agtype, heat agtype, memory_type agtype);
```

### Session Cluster
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[:SESSION_LINK]-(b:Memory)
  WHERE a.session_id = 'session-uuid'
  RETURN b
$$) AS (memory agtype);
```

### Resonance Path
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH path = shortestPath((a:Memory)-[:RESONANCE*..5]-(b:Memory))
  WHERE a.node_id = 'source-uuid' AND b.node_id = 'target-uuid'
  RETURN path
$$) AS (path agtype);
```

### Community Detection
```sql
SELECT * FROM cypher('sulcus_graph', $$
  MATCH (a:Memory)-[r:RELATES_TO]->(b:Memory)
  WHERE a.tenant_id = 'tenant-id' AND r.weight > 0.5
  RETURN a.label, collect(b.label) AS related
$$) AS (label agtype, related agtype);
```

## Local Compatibility

The `sulcus` local binary runs on `pg-embed`, which does not bundle the AGE C extension by default:

1. **Automatic detection**: Sulcus checks graph extension availability at startup
2. **SQL fallback**: Local neighborhood and relationship queries seamlessly fall back to standard SQL joins
3. **Cloud parity**: Syncing with `api.sulcus.ca` indexes your memory graph in Apache AGE automatically

## References

- [Apache AGE Documentation](https://age.apache.org/age-manual/master/index.html)
- [openCypher Specification](https://opencypher.org/)
- Author: Digital Forge Studios <contact@sulcus.ca>
