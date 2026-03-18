# syntax=docker/dockerfile:1

# Stage 1: install dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && echo "deps-installed"

# Stage 2: build
FROM node:20-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
ARG NEXT_PUBLIC_SULCUS_SERVER_URL=https://api.sulcus.ca
ENV NEXT_PUBLIC_SULCUS_SERVER_URL=${NEXT_PUBLIC_SULCUS_SERVER_URL}

ARG NEXT_PUBLIC_SULCUS_API_KEY=icarus-sulcus-2026
ENV NEXT_PUBLIC_SULCUS_API_KEY=${NEXT_PUBLIC_SULCUS_API_KEY}

ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51T9sL6E2tKgsZqDKoYm7M6ZsI9GDUENWAeEAGfpVrQ0UdSvyZEAXi96OZ8z9h98lpEjwMs0vXYmW4TwtKJHqf2Vz00ZSdSU50n
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}

COPY --from=deps /app/node_modules ./node_modules

# CACHE_BUST: unique timestamp to invalidate all layers below
ARG CACHE_BUST=1
RUN echo "cache_bust=$CACHE_BUST" && date > /tmp/build_ts
COPY . .
RUN echo "post-copy verification: $(date)" && head -1 src/app/page.tsx

# Verify source content before building
RUN grep -c "ThermodynamicDiagram" src/app/page.tsx || (echo "ERROR: page.tsx missing ThermodynamicDiagram!" && exit 1)
RUN grep -c "NeonBlockCanvas" src/app/page.tsx && (echo "ERROR: page.tsx still has NeonBlockCanvas!" && exit 1) || true
RUN echo "page.tsx lines: $(wc -l < src/app/page.tsx)"

# FORCE_REBUILD is set to the CACHE_BUST value so this RUN layer is unique per build
# rm -rf .next to nuke any cached build artifacts
ARG FORCE_REBUILD=0
RUN echo "force_rebuild=$FORCE_REBUILD" && rm -rf .next && npm run build

# Stage 3: production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_PUBLIC_SULCUS_SERVER_URL=${NEXT_PUBLIC_SULCUS_SERVER_URL}
ENV PORT=8080

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["npm", "run", "start"]