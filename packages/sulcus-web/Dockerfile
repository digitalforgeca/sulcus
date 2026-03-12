# syntax=docker/dockerfile:1

# Stage 1: install dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Stage 2: build
FROM node:20-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
ARG NEXT_PUBLIC_SULCUS_SERVER_URL=https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io
ENV NEXT_PUBLIC_SULCUS_SERVER_URL=${NEXT_PUBLIC_SULCUS_SERVER_URL}

ARG NEXT_PUBLIC_SULCUS_API_KEY=icarus-sulcus-2026
ENV NEXT_PUBLIC_SULCUS_API_KEY=${NEXT_PUBLIC_SULCUS_API_KEY}

COPY --from=deps /app/node_modules ./node_modules

# CACHE_BUST must come BEFORE COPY to invalidate the layer cache
ARG CACHE_BUST=1
RUN echo "build=$CACHE_BUST"
COPY . .

RUN npm run build

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