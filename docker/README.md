Postgres for local development & CI

Quick start (local):

1. Start the DB:

   docker compose -f docker-compose.postgres.yml up -d

2. Export SULCUS_DATABASE_URL for tests / local server:

   export SULCUS_DATABASE_URL=postgres://sulcus:sulcus@127.0.0.1:5432/sulcus_test

3. Run Postgres-backed tests (they'll skip if SULCUS_DATABASE_URL is not set):

   cargo test -p sulcus-server

Tear down:

docker compose -f docker-compose.postgres.yml down -v

Notes:

- The container copies `crates/sulcus-server/migrations/0001_create_tables.sql` into
  the Postgres init directory so the schema is created on first startup.
- CI should set `SULCUS_DATABASE_URL` to point at the service (see `.github/workflows` for examples).
