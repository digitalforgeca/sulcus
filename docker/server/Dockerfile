# syntax=docker/dockerfile:1

# Stage 1: build
FROM rust:1.88-slim AS builder
WORKDIR /app

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY crates/sulcus-core/Cargo.toml crates/sulcus-core/
COPY crates/sulcus-local/Cargo.toml crates/sulcus-local/
COPY crates/sulcus-server/Cargo.toml crates/sulcus-server/
COPY crates/sulcus-wasm/Cargo.toml crates/sulcus-wasm/

# Create stub lib.rs for all crates, and main.rs only for sulcus-server (the binary)
RUN mkdir -p crates/sulcus-core/src crates/sulcus-local/src crates/sulcus-server/src crates/sulcus-wasm/src && \
    echo "pub fn placeholder() {}" > crates/sulcus-core/src/lib.rs && \
    echo "pub fn placeholder() {}" > crates/sulcus-local/src/lib.rs && \
    echo "pub fn placeholder() {}" > crates/sulcus-server/src/lib.rs && \
    echo "fn main() {}" > crates/sulcus-server/src/main.rs && \
    echo "pub fn placeholder() {}" > crates/sulcus-wasm/src/lib.rs

# Pre-fetch and cache dependencies
RUN cargo fetch

# Now copy real source and build
COPY crates/ crates/
RUN cargo build --release --features server-bin -p sulcus-server

# Stage 2: runtime
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/sulcus-server /app/sulcus-server

ENV SULCUS_BIND_ADDR=0.0.0.0:8080
EXPOSE 8080

CMD ["/app/sulcus-server"]
