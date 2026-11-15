# TetGen compiled to WebAssembly
FROM emscripten/emsdk:6.0.13 AS tetgen

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/build-tetgen.sh scripts/
COPY src/mesher/tetgen_wrapper.cpp src/mesher/
RUN bash scripts/build-tetgen.sh

# Build stage
FROM node:22-slim AS builder

# Public repository URL, linked from the page as the AGPL requires
ARG VITE_SOURCE_URL

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
COPY --from=tetgen /app/src/mesher/wasm src/mesher/wasm

# Deploy gate: lint, the verification suite, then the build
RUN npm run lint && npm test && npm run build

# Production stage
FROM nginx:alpine-slim

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Run as non-root user
RUN adduser -D -g '' nginxuser && \
    chown -R nginxuser:nginxuser /usr/share/nginx/html && \
    chown -R nginxuser:nginxuser /var/cache/nginx && \
    chown -R nginxuser:nginxuser /var/log/nginx && \
    chown -R nginxuser:nginxuser /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginxuser:nginxuser /var/run/nginx.pid

USER nginxuser

EXPOSE 8081

CMD ["nginx", "-g", "daemon off;"]
