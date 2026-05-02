-- Migration 0029: Enable Apache AGE graph database extension
-- AGE provides openCypher graph queries on top of PostgreSQL
-- Requires: shared_preload_libraries = 'age' (server parameter)

-- Enable the extension
CREATE EXTENSION IF NOT EXISTS age;

-- Load AGE into the search path for Cypher functions
-- This must be set per-session or in postgresql.conf
-- For now we rely on SET search_path in queries

-- Create the Sulcus graph
SELECT * FROM ag_catalog.create_graph('sulcus_graph');
