# Aether

Build AI-powered apps on the Lovelace platform.

## Quick Start

```bash
npm run init          # interactive project setup
npm install
npm run dev           # dev server on port 3000
```

Or for a quick local setup without the wizard:

```bash
npm run init -- --local   # creates .env with dev defaults
npm install
npm run dev
```

## Project Structure

| Directory      | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `pages/`       | App pages (Nuxt file-based routing)               |
| `components/`  | Reusable Vue components                           |
| `composables/` | Shared logic (`useXxx.ts`, auto-imported by Nuxt) |
| `server/api/`  | Nitro server routes (deploy with app to Vercel)   |
| `agents/`      | Python ADK agents (deploy to Vertex AI)           |
| `mcp-servers/` | Python MCP servers (deploy to Cloud Run)          |
| `design/`      | Feature design docs for AI-assisted development   |

## Building Your App

1. Edit `DESIGN.md` with your project vision
2. Run `/build_my_app` in Cursor or Claude Code -- the AI agent designs and implements your app
3. Push to main to deploy on Vercel

## AI Development

Aether is optimized for AI-assisted development with Cursor and Claude Code.
Agent instructions live in `.agents/`, with `.cursor` and `.claude` symlinks
so both tools read the same files.

- **`.agents/skills/aether/`** -- the Aether skill: architecture, APIs, UI patterns, agents, MCP servers, deployment (read `SKILL.md` first)
- **`DESIGN.md`** -- project vision that agents read first
- **`design/*.md`** -- feature docs for collaborative planning
- **`.agents/skills/`** -- additional skill docs (populated by `npm install` and `/update_instructions`)

## Deployment

- **App**: Vercel auto-deploys on push to `main`
- **Agents**: Run `/deploy_agent` in Cursor or Claude Code, or use the Portal UI
- **MCP servers**: Run `/deploy_mcp` in Cursor or Claude Code, or use the Portal UI

## Configuration

`broadchurch.yaml` contains tenant-specific settings. It's generated during
provisioning -- don't edit manually.

## Auth

Auth0 is configured automatically for provisioned projects. For local dev,
`NUXT_PUBLIC_USER_NAME=dev-user` bypasses Auth0.
