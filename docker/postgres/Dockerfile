FROM pgvector/pgvector:pg15

# Copy initial migrations so the container initializes the schema on first run
COPY ./crates/sulcus-local/migrations/0001_create_tables.sql /docker-entrypoint-initdb.d/0001_create_tables.sql

# Default DB/user for local testing (override with env on `docker run` / compose)
ENV POSTGRES_USER=sulcus
ENV POSTGRES_PASSWORD=sulcus
ENV POSTGRES_DB=sulcus_test

EXPOSE 5432
