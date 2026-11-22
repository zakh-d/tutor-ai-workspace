ARG APP_VERSION=dev
FROM node:22.14.0-bookworm-slim AS frontend
ARG APP_VERSION
ENV VITE_APP_VERSION=$APP_VERSION
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_KEYCLOAK_URL=https://auth.localhost
ARG VITE_KEYCLOAK_REALM=tutor
ARG VITE_KEYCLOAK_CLIENT_ID=tutor-web
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
RUN npm run build

FROM python:3.12.10-slim-bookworm
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.7.13
WORKDIR /app
ENV PYTHONPATH=/app/backend UV_PROJECT_ENVIRONMENT=/app/.venv PATH=/app/.venv/bin:$PATH UV_NO_CACHE=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./backend/
COPY --from=frontend /src/frontend/dist ./frontend/dist
RUN useradd --uid 10001 --create-home tutor && chown -R tutor:tutor /app
USER tutor
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
