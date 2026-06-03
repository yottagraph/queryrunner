### App (Nuxt UI + server routes)

Vercel auto-deploys on every push to `main`. Preview deployments are created for
other branches. The app is available at `{slug}.yottagraph.app`.

### Agents (`agents/`)

Each subdirectory in `agents/` is a self-contained Python ADK agent. Deploy via
the Portal UI or `/deploy_agent` in Cursor.

### MCP Servers (`mcp-servers/`)

Each subdirectory in `mcp-servers/` is a Python FastMCP server. Deploy via
the Portal UI or `/deploy_mcp` in Cursor.

### Compute Jobs (`jobs/`) and Workflows (`workflows/`)

Each subdirectory in `jobs/` is a Cloud Run Job (or K8s Job on the
per-tenant GKE cluster when `runner: k8s_job` is set in `job.yaml`).
Each subdirectory in `workflows/` is a Cloud Workflow that orchestrates
jobs into a DAG. Deploy via the Portal UI or `/deploy_job` /
`/deploy_workflow` in Cursor. See [`compute.md`](compute.md) for
patterns and `job.yaml` reference.
