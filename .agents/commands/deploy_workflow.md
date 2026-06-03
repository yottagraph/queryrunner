# Deploy Cloud Workflow

Deploy a Cloud Workflow definition from the `workflows/` directory via
the Broadchurch Portal.

## Overview

A Cloud Workflow orchestrates one or more compute jobs. It's the
declarative DAG layer on top of the job runtime — useful for:

- **Multi-step pipelines** ("for each entity: enrich, score, write")
- **Fan-out / fan-in** patterns (parallel jobs that converge)
- **Retry / error-branch logic** managed by the workflow runner, not the jobs
- **Scheduled multi-step orchestration** (set `schedule:` in `manifest.yaml`)

Cloud Workflows handles state, retries, fan-out, and observability.
Your jobs stay stateless and idempotent — that's the design point.

The workflow must live in `workflows/<name>/` with:

```
workflows/<name>/
├── workflow.yaml       # Cloud Workflows DSL — the DAG itself
└── manifest.yaml       # Name, schedule, log level, schedule input
```

**Prerequisite:** The project must have a valid `broadchurch.yaml`,
and any jobs the workflow references must already be deployed via
`/deploy_job`.

---

## Step 1: Read Configuration

```bash
cat broadchurch.yaml
```

**If the file does not exist:** Stop and tell the user the project
isn't provisioned yet.

Extract:

- `tenant.org_id`
- `gateway.url`

---

## Step 2: Discover Workflows

```bash
ls -d workflows/*/
```

**If no directories exist:** Suggest copying `workflows/example_workflow/`
or creating a new one matching the structure above. Stop here.

**Skip `example_workflow`** — it's a template placeholder. Filter it out.

**If multiple remain:** Ask which to deploy.
**If one remains:** Proceed without confirmation.

---

## Step 3: Validate Workflow Structure

```bash
ls workflows/<name>/workflow.yaml workflows/<name>/manifest.yaml
```

Validate `workflow.yaml` is syntactically valid:

```bash
yq -e '.main.steps' workflows/<name>/workflow.yaml >/dev/null
```

Validate `manifest.yaml` has a name:

```bash
yq -e '.name' workflows/<name>/manifest.yaml >/dev/null
```

---

## Step 4: Ensure Referenced Jobs Are Deployed

Cloud Workflows can't deploy referenced jobs for you. Check the
workflow definition for any `googleapis.run.v1.namespaces.jobs.run`
calls and verify those jobs exist:

```bash
grep -oP 'jobs/\K[a-z0-9-]+' workflows/<name>/workflow.yaml | sort -u
```

For each job name found, confirm it appears in the Portal:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/jobs" | jq '.jobs[].job_name'
```

If a referenced job isn't deployed yet:

> The workflow `<name>` references job `<job>` which isn't deployed.
> Deploy it first with `/deploy_job <job>`.

---

## Step 5: Ensure Code is Pushed

```bash
git status
```

If there are uncommitted changes in `workflows/<name>/`, prompt to
commit and push.

---

## Step 6: Trigger Deployment

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/deploy" \
  -H "Content-Type: application/json" \
  -d '{"type": "workflow", "name": "<WORKFLOW_NAME>"}'
```

**If 404:** The directory may not exist on GitHub yet. Push first.

**If success:** The Portal has triggered the `deploy-workflow.yml`
GitHub Actions workflow.

---

## Step 7: Monitor Progress

> Workflow deployment triggered.
>
> - **Workflow:** <name>
> - **GitHub Action:** deploy-workflow.yml
>
> Typically completes in under a minute (workflow definitions are tiny).
>
> Once deployed:
>
> - The workflow is executable via the Portal "Run now" button on the Workflows tab
> - If `schedule:` is set, Cloud Scheduler invokes it automatically
> - Execution history is in the Portal Workflows tab

---

## Step 8: (Optional) Trigger a Test Execution

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/workflows/<WORKFLOW_NAME>/run" \
  -H "Content-Type: application/json" \
  -d '{"input": {"limit": 10}}'
```

Then poll for the result:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/workflows/<WORKFLOW_NAME>/executions" | jq '.executions[0]'
```

---

## Troubleshooting

### Workflow rejected with parsing errors

Cloud Workflows YAML has strict syntax. Common gotchas:

- Indentation must use spaces (no tabs)
- `${...}` expressions must be quoted strings in YAML
- `parallel for` requires `value` and `range` (or `in`) under `for:`
- `args:` for `googleapis.run.v1.*` must include `name: namespaces/<project>/jobs/<job>`

Reference: https://cloud.google.com/workflows/docs/reference/syntax

### Workflow times out

Cloud Workflows has a 1-year max duration but each step has its own
limits. Long-running step calls (`googleapis.run.v1.namespaces.jobs.run`)
should use `connector_params: {timeout: <seconds>}` to bound them.

### Schedule doesn't fire

Cloud Scheduler entries are named `workflow-<name>`. Verify in the
Cloud Console.
