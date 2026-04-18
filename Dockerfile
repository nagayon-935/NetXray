# --- Stage 1: Build Rust WASM Engine ---
FROM rust:1.85-slim AS engine-builder
RUN apt-get update && apt-get install -y \
    binaryen \
    curl \
    pkg-config \
    libssl-dev \
    build-essential \
    && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh \
    && rustup target add wasm32-unknown-unknown
WORKDIR /build/engine
COPY engine/ .
# Run build. We disable wasm-opt here (via --no-pack or manual flag) 
# as it can fail in slim docker environments.
RUN wasm-pack build --target web --release

# --- Stage 2: Build Frontend ---
FROM node:22-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
# Copy WASM build files directly into src/wasm to match import paths
COPY --from=engine-builder /build/engine/pkg/netxray_engine.js /build/frontend/src/wasm/netxray_engine.js
COPY --from=engine-builder /build/engine/pkg/netxray_engine_bg.wasm /build/frontend/src/wasm/netxray_engine_bg.wasm
COPY --from=engine-builder /build/engine/pkg/netxray_engine.d.ts /build/frontend/src/wasm/netxray_engine.d.ts
RUN npm run build

# --- Stage 3: Final Image (Python Backend) ---
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies, Docker CLI, and containerlab
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    openssh-client \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y docker-ce-cli \
    && bash -c "$(curl -sL https://get.containerlab.dev)" -- -v 0.56.0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
COPY backend/pyproject.toml backend/uv.lock ./
# Install backend dependencies
RUN uv sync --frozen --no-cache

# Copy backend code and static assets built in Stage 2
COPY backend/ .
COPY --from=frontend-builder /build/frontend/dist ./static

# Expose the API port
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
