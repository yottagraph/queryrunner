# Deploy MCP Server

Deploy a custom MCP server from the `mcp-servers/` directory to Google Cloud Run via the Broadchurch Portal.

## Overview

This command deploys a Python MCP server (typically built with FastMCP) by triggering a GitHub Actions workflow through the Portal API. No local GCP credentials are needed -- the workflow authenticates via Workload Identity Federation, builds a container with Cloud Build, and deploys to Cloud Run.

The server must live in `mcp-servers/<name>/` with at minimum `server.py` and `requirements.txt`. A `Dockerfile` is auto-generated if not provided.

**Prerequisite:** The project must have a valid `broadchurch.yaml` (created during provisioning).

---

## Step 1: Read Configuration

Read `broadchurch.yaml` from the project root.

```bash
cat broadchurch.yaml
```

**If the file does not exist:**

> This project hasn't been provisioned yet. Create it in the Broadchurch Portal first.

Stop here.

Extract these values:

- `tenant.org_id` (tenant org ID)
- `gateway.url` (Portal Gateway URL)

---

## Step 2: Discover MCP Servers

List the directories under `mcp-servers/`:

```bash
ls -d mcp-servers/*/
```

**If no directories exist:**

> No MCP servers found. Create one by making a directory under `mcp-servers/` with:
>
> ```
> mcp-servers/my-server/
> ├── server.py         # FastMCP server definition
> └── requirements.txt  # Must include 'fastmcp'
> ```

Stop here.

**If multiple servers exist:** Ask which one to deploy.

**If only one exists:** Confirm with the user.

---

## Step 3: Validate Server Structure

Verify required files:

```bash
ls mcp-servers/<name>/server.py mcp-servers/<name>/requirements.txt
```

**If missing:** Tell the user what's needed.

---

## Step 4: Ensure Code is Pushed

The deployment workflow runs on the code in the GitHub repo. Make sure the server code is committed and pushed:

```bash
git status
```

**If there are uncommitted changes in `mcp-servers/<name>/`:**

> Your server code has local changes that aren't pushed yet. The deployment will use the version on GitHub. Would you like me to commit and push first?

If yes, commit and push. If no, warn them and continue.

---

## Step 5: Trigger Deployment

Call the Portal API to trigger the deploy workflow:

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/deploy" \
  -H "Content-Type: application/json" \
  -d '{"type": "mcp", "name": "<SERVER_NAME>"}'
```

**If this fails with 404:** The server directory may not exist on GitHub yet. Push your code first.

**If this succeeds:** The Portal has triggered the `deploy-mcp.yml` GitHub Actions workflow.

---

## Step 6: Monitor Progress

> Deployment triggered! The MCP server is being deployed via GitHub Actions.
>
> - **Server:** <name>
> - **Workflow:** deploy-mcp.yml
>
> This typically takes 2-5 minutes (container build + Cloud Run deploy).
> You can monitor progress:
>
> - In the Broadchurch Portal under your project's Deployment Status section
> - On GitHub: `https://github.com/<REPO>/actions`
>
> Once complete, the Cloud Run service URL will be available.

---

## Step 7: Register in Cursor MCP Config

After deployment completes, add the new server to `.agents/mcp.json` so Cursor and Claude Code can connect to it through the Portal Gateway proxy.

Read `.agents/mcp.json`, then add a new entry for the server:

```json
{
    "<SERVER_NAME>": {
        "url": "<GATEWAY_URL>/api/mcp/<ORG_ID>/<SERVER_NAME>/mcp"
    }
}
```

Where `<SERVER_NAME>`, `<GATEWAY_URL>`, and `<ORG_ID>` are the values from Steps 1-2.

Write the updated JSON back to `.agents/mcp.json`.

> The MCP server is now registered. Cursor will connect to it through the Portal Gateway proxy — no credentials needed.
>
> You may need to reload Cursor (Cmd+Shift+P → "Developer: Reload Window") for the new MCP server to appear in your tool list.

---

## Troubleshooting

### Build fails

Check the GitHub Actions logs for the `Deploy MCP Server` workflow. Common issues:

- **"requirements.txt" errors**: Make sure `fastmcp` and all dependencies are listed.
- **Dockerfile issues**: If you have a custom Dockerfile, ensure it exposes port 8080.
- **WIF auth failure**: The Broadchurch admin needs to run the WIF setup script.

### "Permission denied" when agents call the server

The Cloud Run service is deployed with `--no-allow-unauthenticated`. Only the tenant's service account can invoke it. The deployment workflow grants this automatically.

### Need to update an existing server

Just run `/deploy_mcp` again. It will rebuild and redeploy to the same Cloud Run service.
