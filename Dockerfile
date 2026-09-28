FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.10 AS uv

FROM python:3.12-slim AS app
LABEL org.opencontainers.image.title="Taiga Metrics" \
      org.opencontainers.image.description="Flow and team metrics for self-hosted Taiga. An independent project, not affiliated with or endorsed by Taiga or Kaleidos Inc." \
      org.opencontainers.image.source="https://github.com/DVSAWR/taiga-metrics-extension" \
      org.opencontainers.image.licenses="MIT"
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    TAIGA_METRICS_STATIC_DIR=/app/static
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE THIRD_PARTY_NOTICES.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY taiga_metrics ./taiga_metrics
RUN uv sync --frozen --no-dev --no-editable
COPY --from=frontend /frontend/dist ./static
RUN useradd --system --no-create-home taiga-metrics
USER taiga-metrics
EXPOSE 8000
CMD ["python", "-m", "taiga_metrics", "serve"]
