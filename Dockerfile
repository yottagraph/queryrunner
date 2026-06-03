# syntax=docker/dockerfile:1.7
#
# Container image for the Aether tenant app — used by the BC 2.0 tenant
# UI hosting spike (broadchurch ENG-666). Production-ready for both
# Cloud Run-in-tenant (Option A) and a GKE Deployment in the existing
# tenant cluster (Option C); the substrate decision lives in the ADR
# the spike produces.
#
# Build context is the aether-dev repo root. Nuxt's nitro preset
# defaults to `node-server` whenever the VERCEL env var is unset
# (see `nuxt.config.ts` ~L84), so `npm run build` produces a
# self-contained `.output/server/index.mjs` that this image runs.
#
# Local build (needs an AR read token for the private @yottagraph-app scope):
#   AR_NPM_TOKEN="$(gcloud auth print-access-token)" \
#     docker build --secret id=ar_npm_token,env=AR_NPM_TOKEN -t aether-app:dev .
#   docker run --rm -p 3000:3000 aether-app:dev
#   # → open http://localhost:3000
#
# Tenant build (Cloud Build, no local docker daemon required):
#   gcloud builds submit \
#     --tag "us-central1-docker.pkg.dev/${TENANT_PROJECT_ID}/aether/aether-app:v0.1" \
#     --project "${TENANT_PROJECT_ID}" .

# ============================================================
# Stage 1 — builder
# ============================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Husky's `prepare` script (run automatically by `npm ci`) tries to
# install git hooks; it fails inside a Docker context with no `.git/`.
# Setting HUSKY=0 short-circuits it without disabling the genuinely
# useful postinstall hooks (`copy-skills`, `nuxi prepare`).
ENV HUSKY=0

# Native-build deps occasionally pulled in by Nuxt/Nitro toolchain
# (e.g., better-sqlite3, sharp). Cheap to keep; trims via apt cache.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# The @yottagraph-app/* scope is served ONLY from the org's private GCP
# Artifact Registry (broadchurch/aether-npm) — the committed .npmrc scope-pins
# it and fails closed (401) without a token. `npm ci` therefore needs an AR
# read token. It's passed as a BuildKit secret (never written to a layer); the
# .npmrc copied here only ever contains the literal ${AR_NPM_TOKEN} reference,
# not the value. deploy-ui.yml mints the token from the github-deploy WIF
# identity; a local build needs:
#   AR_NPM_TOKEN="$(gcloud auth print-access-token)" \
#     docker build --secret id=ar_npm_token,env=AR_NPM_TOKEN -t aether-app:dev .
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=ar_npm_token \
    AR_NPM_TOKEN="$(cat /run/secrets/ar_npm_token 2>/dev/null || true)" \
    npm ci --no-audit --no-fund

COPY . .

# `prebuild` (scripts/check-no-direct-gcp.js) guards against direct
# `@google-cloud/*` SDK imports — that guard stays in place; this
# image inherits the same Portal-gateway-for-GCP-data pattern as the
# Vercel build target. If the ADR picks Option A or Option C with a
# direct-ADC pattern, the guard relaxation lives in ENG-667 (Phase 1).
RUN npm run build

# ============================================================
# Stage 2 — runtime
# ============================================================
FROM node:20-bookworm-slim AS runtime

# Non-root user for PodSecurity `restricted` admission (matches the
# direction-of-travel of ENG-636 for K8s Jobs pods — same rationale
# applies to UI pods on the per-tenant GKE cluster). Cloud Run is
# indifferent to UID but accepts non-root cleanly.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --shell /usr/sbin/nologin nuxt

WORKDIR /app

# Nuxt's `.output/` is fully self-contained — its `server/node_modules`
# carries everything the runtime needs. No top-level npm install.
COPY --from=builder --chown=nuxt:nodejs /app/.output ./.output

USER nuxt

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
