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
# Must include ALL workspace members or cargo fetch/build will fail
COPY Cargo.toml Cargo.lock ./
COPY crates/sulcus-core/Cargo.toml crates/sulcus-core/
COPY crates/sulcus/Cargo.toml crates/sulcus/
COPY crates/sulcus-server/Cargo.toml crates/sulcus-server/
COPY crates/sulcus-store/Cargo.toml crates/sulcus-store/
COPY crates/sulcus-sync/Cargo.toml crates/sulcus-sync/
COPY crates/sulcus-types/Cargo.toml crates/sulcus-types/
COPY crates/sulcus-vectors/Cargo.toml crates/sulcus-vectors/
COPY crates/sulcus-wasm/Cargo.toml crates/sulcus-wasm/

# Create stub lib.rs for all crates, and main.rs only for sulcus-server (the binary)
RUN mkdir -p crates/sulcus-core/src crates/sulcus/src crates/sulcus-server/src \
    crates/sulcus-store/src crates/sulcus-sync/src crates/sulcus-types/src \
    crates/sulcus-vectors/src crates/sulcus-wasm/src && \
    for d in sulcus-core sulcus sulcus-store sulcus-sync sulcus-types sulcus-vectors sulcus-wasm; do \
      echo "pub fn placeholder() {}" > crates/$d/src/lib.rs; \
    done && \
    echo "pub fn placeholder() {}" > crates/sulcus-server/src/lib.rs && \
    echo "fn main() {}" > crates/sulcus-server/src/main.rs

# Pre-fetch and cache dependencies
ENV ORT_DYLIB_PATH=/opt/onnxruntime/lib/libonnxruntime.so
RUN cargo fetch

# Now copy real source and build
COPY crates/ crates/
COPY .build-timestamp* .build-ref* ./

# Pass git ref for version string — write to file AND env for build.rs
ARG BUILD_REF=unknown
ENV SULCUS_BUILD_REF=${BUILD_REF}
# If BUILD_REF was passed, overwrite the file; otherwise use the one from repo
RUN if [ "${BUILD_REF}" != "unknown" ]; then echo "${BUILD_REF}" > .build-ref; fi
RUN cargo build --release --features server-bin -p sulcus-server

# Stage 2: runtime
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    locales \
    && sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Copy ONNX Runtime dylib
COPY --from=builder /opt/onnxruntime/lib/libonnxruntime.so* /usr/local/lib/
RUN ldconfig

COPY --from=builder /app/target/release/sulcus-server /app/sulcus-server

# Copy SIU v2 ONNX models (SIVU quality gate + SICU type classifier)
# These must be present for the SIU classification pipeline to activate.
COPY models/siu-v2/ /opt/sulcus/models/siu-v2/

# Ensure writable cache dir for fastembed model downloads
RUN mkdir -p /app/.fastembed_cache

ENV SULCUS_BIND_ADDR=0.0.0.0:8080
ENV ORT_DYLIB_PATH=/usr/local/lib/libonnxruntime.so
ENV FASTEMBED_CACHE_PATH=/app/.fastembed_cache
ENV SIU_V2_MODEL_DIR=/opt/sulcus/models/siu-v2
EXPOSE 8080

CMD ["/app/sulcus-server"]
