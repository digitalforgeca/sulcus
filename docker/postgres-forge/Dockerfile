# Sulcus Postgres — pgvector + Apache AGE on PG16
# For Forge VPS deployment
FROM pgvector/pgvector:pg16

# Install build dependencies for AGE
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    ca-certificates \
    libreadline-dev \
    zlib1g-dev \
    bison \
    flex \
    postgresql-server-dev-16 \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build Apache AGE from source for PG16
RUN cd /tmp && \
    git clone --branch release/PG16/1.6.0 https://github.com/apache/age.git && \
    cd age && \
    make && \
    make install && \
    cd / && rm -rf /tmp/age

# Preload AGE and pgvector
RUN echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample

# Init script to create extensions
COPY init-extensions.sql /docker-entrypoint-initdb.d/00-extensions.sql

ENV POSTGRES_USER=sulcus
ENV POSTGRES_PASSWORD=sulcus
ENV POSTGRES_DB=sulcus

EXPOSE 44001
