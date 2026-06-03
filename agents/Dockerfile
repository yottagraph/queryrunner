# BC 2.0 in-cluster GKE agent server (ADR-021).
#
# Built by .github/workflows/deploy-agent.yml and run as a Deployment in
# the per-tenant GKE cluster's `tenant-agent` namespace by the aether-agent
# Helm chart. Serves every agent package under agents/ via `adk api_server`
# (a uvicorn FastAPI app), which the GKE-hosted Aether UI calls in-cluster
# over the ClusterIP Service — no Vertex Agent Engine, no Portal
# /authorize hop.
#
# Build context is the repo's agents/ directory. broadchurch.yaml is copied
# in by the deploy workflow (the bundle step) so broadchurch_auth can read
# the gateway URL + org_id at runtime; agents reach the Elemental MCP /
# Query Server through the Portal proxy in Phase 1 (per-tenant MCP is
# Phase 2).
FROM python:3.12-slim

# Vertex via Workload Identity: ADK reads these to route model calls
# (gemini-*) through Vertex AI in the per-tenant project. GOOGLE_CLOUD_PROJECT
# + GOOGLE_CLOUD_LOCATION are overridden at runtime by the chart's env
# block (Portal-seeded); the defaults here keep `docker run` smoke sane.
ENV GOOGLE_GENAI_USE_VERTEXAI=TRUE \
    GOOGLE_CLOUD_LOCATION=us-central1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user (uid 1001) — matches the chart's podSecurityContext.
RUN groupadd --gid 1001 aether \
    && useradd --uid 1001 --gid 1001 --create-home aether

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the agents tree (every <agent>/ package + broadchurch_auth.py, and
# broadchurch.yaml when the deploy workflow bundled it in).
COPY . .

# Drop dev-only content that shouldn't ship in the runtime image.
RUN rm -rf tests pyproject.toml

USER 1001

EXPOSE 8080

# `adk api_server <AGENTS_DIR>` discovers each agent package under the
# directory (each exporting root_agent) and serves the ADK REST API
# (session + /run + /run_sse). /app is the agents dir AND the cwd, so
# `from broadchurch_auth import ...` resolves for every agent.
CMD ["sh", "-c", "adk api_server --host 0.0.0.0 --port ${PORT:-8080} /app"]
