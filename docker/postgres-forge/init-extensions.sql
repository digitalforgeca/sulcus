-- Sulcus Postgres extensions init
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS age;

-- Load AGE into search path
SET search_path = ag_catalog, "$user", public;
