# Deploy Agent

Deploy an ADK agent from the `agents/` directory to Vertex AI Agent Engine via the Broadchurch Portal.

## Overview

This command deploys a Python ADK agent by triggering a Cloud Build job through the Portal API. No local GCP credentials are needed — Cloud Build authenticates via the project's service account.

The agent must live in `agents/<name>/` with the standard ADK structure (`agent.py`, `__init__.py`, `requirements.txt`).

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

## Step 2: Discover Agents

List the directories under `agents/`:

```bash
ls -d agents/*/
```

**If no directories exist:**

> No agents found. Create one by making a directory under `agents/` with the following structure:
>
> ```
> agents/my_agent/
> ├── __init__.py
> ├── agent.py       # Your ADK agent definition (must export root_agent)
> └── requirements.txt
> ```
>
> See [`agents.md`](../skills/aether/agents.md) in the `aether` skill for guidance on writing ADK agents.

Stop here.

**Skip `example_agent`** — this is a template placeholder and should
never be deployed. Filter it out before proceeding.

**If multiple agents remain:** Deploy all of them. If called interactively
(not from `/build_my_app`), ask the user which one to deploy.

**If only one agent remains:** Proceed with it — no confirmation needed.

**Important:** Agent directory names must use underscores, not hyphens (e.g., `my_agent` not `my-agent`).

---

## Step 3: Validate Agent Structure

For the selected agent directory, verify the required files exist:

```bash
ls agents/<name>/__init__.py agents/<name>/agent.py agents/<name>/requirements.txt
```

**If any are missing:** Tell the user what's needed.

Also verify that `agent.py` exports a `root_agent`:

```bash
grep -l "root_agent" agents/<name>/agent.py
```

---

## Step 4: Ensure Code is Pushed

The deployment workflow runs on the code in the GitHub repo, not the local working directory. Make sure the agent code is committed and pushed:

```bash
git status
```

**If there are uncommitted changes in `agents/<name>/`:**

> Your agent code has local changes that aren't pushed yet. The deployment will use the version on GitHub. Would you like me to commit and push first?

If yes, commit and push. If no, warn them and continue.

---

## Step 5: Trigger Deployment

Call the Portal API to trigger the deploy workflow:

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/deploy" \
  -H "Content-Type: application/json" \
  -d '{"type": "agent", "name": "<AGENT_NAME>"}'
```

**If this fails with 404:** The agent directory may not exist on GitHub yet. Push your code first.

**If this succeeds:** The response will look like:

```json
{
    "ok": true,
    "method": "cloud-build",
    "build_id": "...",
    "log_url": "https://console.cloud.google.com/cloud-build/builds/...",
    "target": "agents/<name>",
    "repo": "<owner>/<repo>"
}
```

Save the `build_id` — you'll need it for monitoring.

---

## Step 6: Monitor Progress and Confirm Registration

Deployment uses Cloud Build and typically takes 2-5 minutes. Monitor it
yourself rather than asking the user to check.

### 6a. Poll build status

Use the deploy-status endpoint to check whether the build has finished:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/deploy-status" | jq '.cloud_builds[]'
```

Each build entry has a `status` field. Terminal statuses are: `SUCCESS`,
`FAILURE`, `CANCELLED`, `TIMEOUT`, `INTERNAL_ERROR`, `EXPIRED`.

Poll every 30 seconds until the build reaches a terminal status (up to
5 minutes). If it's still running after 5 minutes, tell the user and
share the `log_url` from the deploy response.

### 6b. Confirm agent registration

A successful build doesn't guarantee the agent is usable yet — it also
needs to be registered with the tenant config. Poll the config endpoint
until the agent appears:

```bash
curl -sf "<GATEWAY_URL>/api/config/<ORG_ID>" | jq '.agents'
```

Check that the `agents` array contains an entry whose name matches your
agent. Poll every 30 seconds for up to 3 minutes after the build
succeeds.

### 6c. Report result

**If the agent appears in config:**

> Agent `<name>` is deployed and registered. It should now be available
> in the app's chat interface.

**If the build succeeded but the agent doesn't appear in config after
3 minutes:**

> The Cloud Build job succeeded, but the agent hasn't appeared in the
> tenant config yet. This may indicate the registration step failed
> silently. Check the build logs: <log_url>

**If the build failed:**

> Agent deployment failed with status `<status>`. Check the build logs
> for details: <log_url>

---

## Troubleshooting

### Cloud Build fails

Check the build logs at the `log_url` returned by the deploy endpoint.
Common issues:

- **"agent.py does not export root_agent"**: Ensure your agent module defines `root_agent`.
- **"Module not found"**: All dependencies must be in the agent's `requirements.txt`.
- **Service account permissions**: The Broadchurch admin may need to verify the project's service account has the required IAM roles.

### Agent directory naming

ADK requires directory names to use underscores (Python package convention). If your directory uses hyphens, rename it:

```bash
mv agents/my-agent agents/my_agent
```

### "No agents found" after successful deploy

The workflow registers the agent with the Portal automatically. If it doesn't appear, check the workflow logs for the "Register with Portal" step.
