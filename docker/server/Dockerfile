# syntax=docker/dockerfile:1

# Stage 1: build
FROM rust:1.88-slim AS builder
WORKDIR /app

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download ONNX Runtime 1.23.0 for linux-x64
RUN curl -fsSL \
    "https://github.com/microsoft/onnxruntime/releases/download/v1.23.0/onnxruntime-linux-x64-1.23.0.tgz" \
    -o /tmp/ort.tgz && \
    tar -xzf /tmp/ort.tgz -C /tmp && \
    mkdir -p /opt/onnxruntime && \
    cp -r /tmp/onnxruntime-linux-x64-1.23.0/lib /opt/onnxruntime/ && \
    rm -rf /tmp/ort.tgz /tmp/onnxruntime-linux-x64-1.23.0

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
ENV ORT_DYLIB_PATH=/opt/onnxruntime/lib/libonnxruntime.so
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

# Copy ONNX Runtime dylib
COPY --from=builder /opt/onnxruntime/lib/libonnxruntime.so* /usr/local/lib/
RUN ldconfig

COPY --from=builder /app/target/release/sulcus-server /app/sulcus-server

ENV SULCUS_BIND_ADDR=0.0.0.0:8080
ENV ORT_DYLIB_PATH=/usr/local/lib/libonnxruntime.so
EXPOSE 8080

CMD ["/app/sulcus-server"]
