# Aether

**Read first:** [`.agents/skills/aether/SKILL.md`](.agents/skills/aether/SKILL.md) — the Aether skill indexes every topic below and is the canonical entry point for any work in this repo.

**Stack:** Nuxt 3 (SPA), Vue 3 Composition API (`<script setup>`), Vuetify 3, TypeScript (required), Auth0.

**Structure:** `pages/` (file-based routing), `components/`, `composables/`, `server/api/`, `agents/` (Python ADK), `mcp-servers/` (Python FastMCP).

**Data:** This app runs on the Lovelace platform -- entities, news, filings, sentiment, relationships, events. See [`data.md`](.agents/skills/aether/data.md) in the `aether` skill for access patterns and gotchas. Additional skill docs: `.agents/skills/data-model/` (entity types, properties, relationships; `SKILL.md` first), `.agents/skills/elemental-mcp-patterns/` (MCP response shapes, property type handling, Python patterns for agent tools). Do NOT call external APIs for data the platform provides.

**Storage:** Per-tenant Firestore for user preferences and lightweight state via `useAppPrefs` / `useGlobalPrefs` / `useAppFeaturePrefs` / `useGlobalFeaturePrefs` (see [`pref.md`](.agents/skills/aether/pref.md) in the `aether` skill); legacy BC 1.0 tenants transparently fall back to Upstash KV. Neon Postgres for relational data if connected (see [`storage.md`](.agents/skills/aether/storage.md) in the `aether` skill). BigQuery for analytical/warehouse data when configured — go through `server/utils/bigquery.ts` (which proxies the Broadchurch Portal gateway), never `@google-cloud/bigquery` or a pasted service-account key. See [`bigquery.md`](.agents/skills/aether/bigquery.md) in the `aether` skill.

**Source of truth:** `DESIGN.md` -- read before starting work, update when changing features. The starter UI is placeholder -- replace freely. Feature docs in `design/` for implementation planning.

**Git:** Commit meaningful units of work. Run `npm run format` before commit. Message format: `[Agent commit] {summary}`. Push directly to `main` with `git push origin main` — do NOT create PRs, do NOT run `gh pr create`, and do NOT use feature branches. This project's `main` is not protected; Vercel auto-deploys on push to `main`, and that's how the app gets live. A PR blocks the auto-deploy and breaks the smooth first-run flow.

**First action for a new project:** Run `/build_my_app`.

## Task-specific topics

The `aether` skill (`.agents/skills/aether/SKILL.md`) covers architecture, data, UI cookbook, agents, MCP servers, deployment, env, storage, troubleshooting, and more. Read `SKILL.md` first; it's a short index that points you to the specific topic file you need.

## Environment

Detect your runtime once at startup, then read the matching topic in the `aether` skill:

- **Claude Code (claude.ai/code)** if you are Claude Code running in a cloud session (Linux container, `$HOME` starts with `/root` or `/home/ubuntu`, and you were invoked via claude.ai/code rather than a local CLI). → Read [`claude-code-cloud.md`](.agents/skills/aether/claude-code-cloud.md). Sessions are ephemeral — commit and push changes regularly.
- **Cursor Cloud** if `$HOME` starts with `/root` or `/home/ubuntu`, OR `uname -s` reports `Linux` in a container-shaped path, OR a "Dev Server" terminal was auto-started from `.agents/environment.json`, AND you are running inside Cursor. → Read [`cursor-cloud.md`](.agents/skills/aether/cursor-cloud.md).
- **Local dev** if `$HOME` is under `/Users/…` (macOS) or a normal Linux/Windows user home, and no "Dev Server" terminal is auto-running. → If `.env` and `node_modules/` are present, you're set up; otherwise read [`local-setup.md`](.agents/skills/aether/local-setup.md).

This check is cheap and only needs to run once per session.

### Agent instructions (`.agents/`)

Agent commands and skills are installed from the
`@yottagraph-app/aether-instructions` npm package during project init, under
`.agents/`. `.cursor` and `.claude` are symlinks to `.agents/`, and
`.mcp.json` is a symlink to `.agents/mcp.json`, so Cursor and Claude Code
both read the same files.

`.agents/skills/aether/` is the main Aether skill.
`.agents/skills/elemental-api/` contains API skill documentation (endpoint
reference, types, usage patterns). `.agents/skills/data-model/` contains
Lovelace data model documentation (entity types, schemas per fetch source).
If these directories are missing, run `/update_instructions` to reinstall.

## Configuration

`broadchurch.yaml` contains tenant-specific settings (GCP project, org ID,
service account, gateway URL, query server URL). It's generated during
provisioning and committed by the `tenant-init` workflow. Don't edit manually
unless you know what you're doing.

## Verification Commands

```bash
npm run dev          # dev server -- check browser at localhost:3000
npm run build        # production build -- catches compile errors
npm run format       # Prettier formatting (run before committing)
```

## Known Issues

### Port 3000 conflict

The dev server binds to port 3000 by default. If another service is already
using that port, start with `PORT=3001 npm run dev`.

### Formatting

Pre-commit hook runs `lint-staged` with Prettier. Run `npm run format` before
committing to avoid failures.
