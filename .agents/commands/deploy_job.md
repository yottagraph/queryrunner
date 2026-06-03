# Deploy Compute Job

Deploy a compute job from the `jobs/` directory via the Broadchurch Portal.

## Overview

A "compute job" is a containerized Python (or any-language) entrypoint
that runs as a Kubernetes Job on the tenant's per-tenant GKE cluster.
Per [ADR-019](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md)
(Consolidate Compute on Kubernetes Jobs — Remove Cloud Run Jobs
Runner), K8s Jobs is the sole runner. The `runner` field in `job.yaml`
defaults to `k8s_job` and `runner: cloud_run` is hard-rejected at
validation.

Use compute jobs for:

- **Cron jobs** (set `schedule:` in `job.yaml` — the workflow renders a
  K8s CronJob and the controller fires runs per the schedule)
- **Event-triggered batch work** (HTTP-triggered from your Vercel app
  or an Agent Engine tool via `POST /api/projects/<orgId>/jobs/<name>/run`)
- **Heavy compute** (entity enrichment, scoring, ETL, exports,
  aggregations — up to the per-tenant cluster's allocatable resources)
- **Workflow steps** (called from a Cloud Workflow definition under
  `workflows/`)

This command triggers the Portal's `POST /deploy` endpoint, which
dispatches the tenant repo's `deploy-job.yml` GitHub Actions workflow.
The workflow builds the image with Cloud Build in the per-tenant GCP
project, pushes to Artifact Registry, renders a Job / CronJob manifest
via `scripts/render-k8s-job.py`, and applies it through Connect
Gateway. No local GCP credentials are needed for any step.

The job must live in `jobs/<name>/` with at minimum:

```
jobs/<name>/
├── main.py             # Entrypoint (or any executable; see Dockerfile)
├── requirements.txt    # Python deps (only required if no custom Dockerfile)
├── job.yaml            # Manifest: resources, schedule, env
└── Dockerfile          # Optional — auto-generated if missing
```

**Prerequisite:** The project must have a valid `broadchurch.yaml`
(created during provisioning).

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

## Step 2: Discover Jobs

List the directories under `jobs/`:

```bash
ls -d jobs/*/
```

**If no directories exist:**

> No jobs found. Create one by making a directory under `jobs/` with the structure above.
> See `skills/aether/compute.md` (or copy `jobs/example_job/`) for a starting point.

Stop here.

**Skip `example_job`** — this is a template placeholder and should
never be deployed. Filter it out before proceeding.

**If multiple jobs remain:** Deploy all of them. If called
interactively (not from `/build_my_app`), ask the user which one to
deploy.

**If only one job remains:** Proceed with it — no confirmation needed.

**Important:** Job directory names should use underscores; the deploy
workflow translates them to K8s-friendly hyphens automatically when
naming the K8s Job resource.

---

## Step 3: Validate Job Structure

For the selected job directory, verify the required files exist:

```bash
ls jobs/<name>/main.py jobs/<name>/job.yaml
```

If `Dockerfile` exists, the deploy uses it as-is. If not, the deploy
auto-generates a Python 3.12 Dockerfile that runs `python main.py`.

If using the auto-Dockerfile, `requirements.txt` must also exist:

```bash
ls jobs/<name>/requirements.txt 2>/dev/null
```

Preview the manifest locally to catch shape issues before the
round-trip to GitHub Actions:

```bash
python3 scripts/validate-job-manifest.py jobs/<name>/job.yaml
```

The validator is the canonical enforcer — it rejects unknown fields,
deprecated runner values (`cloud_run` from before ADR-019, `batch`
from before the Phase A pivot), malformed durations, secret-ref
typos, and cross-field violations. If it exits 0 locally, the deploy
workflow will accept the manifest. See
[`skills/aether/compute.md`](../skills/aether/compute.md) for the full
schema reference, the IAM-auth Cloud SQL pattern, the
`${secret://name/version}` env-deref syntax, the `notify:` block
(Slack on failure/success + artifact links), and the `post_steps:`
inline cleanup hooks.

---

## Step 4: Ensure Code is Pushed

The deployment workflow runs on the code in the GitHub repo, not the
local working directory:

```bash
git status
```

**If there are uncommitted changes in `jobs/<name>/`:**

> Your job code has local changes that aren't pushed yet. The
> deployment will use the version on GitHub. Would you like me to
> commit and push first?

If yes, commit and push. If no, warn them and continue.

---

## Step 5: Trigger Deployment

Call the Portal API to dispatch the GitHub Actions deploy workflow:

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/deploy" \
  -H "Content-Type: application/json" \
  -d '{"type": "job", "name": "<JOB_NAME>"}'
```

A successful response looks like:

```json
{
    "ok": true,
    "method": "github-actions",
    "workflow": "deploy-job.yml",
    "target": "jobs/<JOB_NAME>",
    "repo": "<org>/<repo>",
    "monitor_url": "https://github.com/<org>/<repo>/actions/workflows/deploy-job.yml"
}
```

**If the POST fails with 404:** The job directory may not exist on
GitHub yet. Push your code and retry.

**If the POST fails with 400 "GCP service account":** Old guardrail
that no longer applies for `type: "job"` after PR-#169 lands; the K8s
path doesn't require a tenant SA for dispatch. If the error persists,
verify the Portal is on the post-#169 build.

---

## Step 6: Monitor Progress

> Deployment dispatched! The compute job is being deployed via
> GitHub Actions on the tenant repo.
>
> - **Job:** <name>
> - **Workflow:** deploy-job.yml
> - **Monitor:** <monitor_url from response>
>
> Typical timeline:
>
> - 0-30s — Workflow queues, checks out the repo, validates the manifest
> - 30s-3m — Cloud Build builds the container image, pushes to Artifact Registry
> - 3-4m — `kubectl apply` over Connect Gateway; Pod scheduled & image pull
> - 4-5m — Container starts; logs streaming to the cluster
>
> Once the workflow succeeds:
>
> - The job is callable via the Portal "Run now" button
> - If `schedule:` is set, the K8s CronJob fires runs per the cron
> - Run history is visible in the Portal's "Compute Jobs" tab
>
> Live log following:
>
> ```bash
> gh run watch -R <repo>
> # or
> gh run view --log -R <repo> --workflow deploy-job.yml
> ```

---

## Step 7: (Optional) Trigger a Test Run

After deployment, trigger an ad-hoc run to verify the job works:

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/jobs/<JOB_NAME>/run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Per-execution env overrides are supported:

```bash
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/jobs/<JOB_NAME>/run" \
  -H "Content-Type: application/json" \
  -d '{"env_overrides": {"SHARD_INDEX": "3"}}'
```

Then poll for results:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/jobs/<JOB_NAME>/runs" | jq '.runs[0]'
```

Each run has a `status` field. Terminal statuses are: `Succeeded`,
`Failed`, `Cancelled`.

---

## What the workflow actually does (k8s_job path)

For agents debugging a failed deploy:

1. **Read config from broadchurch.yaml** — resolves `gcp.project`,
   `gcp.region`, `tenant.org_id`, `gateway.url`, `query_server.url`,
   `gcp.github_deploy_sa`, `gcp.wif_provider`.
2. **Validate manifest** (`scripts/validate-job-manifest.py`) —
   normalizes to JSON, applies defaults, rejects bad shape.
3. **Reject spot if requested** (ENG-563 — no spot nodepool yet).
4. **WIF auth** to the per-tenant project as the github-deploy SA.
5. **Derive standard env** (ENG-695) — builds `ORG_ID`, `GATEWAY_URL`,
   `QUERY_SERVER_URL`, `GOOGLE_CLOUD_PROJECT`, plus
   `INSTANCE_CONNECTION_NAME` / `DB_USER` / `DB_NAME` (if Cloud SQL is
   provisioned in the project). Merges into the manifest's `env`
   block with manifest values overriding platform-injected ones.
6. **Generate Dockerfile if missing** + **bundle broadchurch.yaml**
   into the build context.
7. **Cloud Build** the image into the per-tenant project's GCR.
8. **Resolve cluster coordinates** from the Portal
   (`GET /api/projects/<org_id>/connect-gateway`) — no new fields in
   `broadchurch.yaml`, Portal is the single source of truth.
9. **Generate execution ID** (UUID, plumbed into the K8s Job name and
   the `compute-job-id` label so cockpit log filters can correlate).
10. **Render** the K8s Job (or CronJob, if `schedule:` set) manifest
    via `scripts/render-k8s-job.py`. Extracts the list of secret refs
    to materialize.
11. **Resolve secrets** from GCP Secret Manager in the per-tenant
    project; materialize a K8s Secret named `job-<name>-secrets` keyed
    by env-var name. The rendered Pod spec already references it via
    `secretKeyRef`. Optional secret refs (`?` suffix) are tolerated
    when the secret is missing.
12. **Configure kubectl** with a Connect Gateway kubeconfig (the WIF
    token gets ~1h TTL — plenty for one deploy).
13. **Apply** the K8s Secret + **Create** the Job (immediate) or
    **Apply** the CronJob (scheduled). Verifies the apiserver accepted
    it and that the Pod doesn't fail at submit time (image-pull errors,
    RBAC denials).
14. **Register** with the Portal
    (`POST /api/projects/<org_id>/jobs`) so the cockpit accumulates
    deploy provenance and the historical-runs view works.

---

## Troubleshooting

### Validation fails with "runner: must be one of ['k8s_job']"

You have `runner: cloud_run` in `job.yaml`. The Cloud Run Jobs runner
was removed per ADR-019; drop the `runner:` field entirely (it
defaults to `k8s_job`) or set it explicitly to `k8s_job`.

### Validation fails with "the `cloud_run` runner was removed per ADR-019"

Same issue as above — the migration hint with the ADR link. Remove
the `runner: cloud_run` line.

### Build fails

Check the GitHub Actions logs:

```bash
gh run list -R <repo> --workflow deploy-job.yml --limit 3
gh run view <run-id> --log -R <repo>
```

Common issues:

- **`requirements.txt` errors**: list every Python dep your `main.py`
  imports.
- **Custom Dockerfile**: ensure the `CMD` actually runs your
  entrypoint.
- **Image too large / OOM during build**: the build runs in a 4 GiB
  Cloud Build worker by default; split heavy dep installs or use a
  custom Dockerfile that's already trimmed.

### Job times out

Increase `task_timeout` in `job.yaml`. K8s Jobs run as long as the pod
stays alive — there's no Cloud Run 24h cap any more. For very-long
runs (>12h) consider whether the work should be a Cloud Workflow with
multiple shorter Jobs instead of one giant Job.

### Schedule doesn't fire

K8s CronJobs are named `bc-job-<name>` in the `tenant-jobs` namespace.
Check via:

```bash
kubectl get cronjob -n tenant-jobs --kubeconfig=<connect-gateway-config> -l bc-job-name=<name>
```

Verify the cron expression matches what you set in `job.yaml` and
that `concurrencyPolicy: Forbid` isn't blocking a still-running prior
execution.

### Need to update an existing job

Just run `/deploy_job` again. For one-shot Jobs the workflow generates
a fresh `bc-job-<name>-<exec_id>` resource so collisions can't happen.
For CronJobs the workflow `kubectl apply`s in place (CronJob spec is
mutable).

### Cloud SQL connection fails with "no such instance"

The `INSTANCE_CONNECTION_NAME` env wasn't injected — the deploy
workflow's "Derive standard env" step didn't find a Cloud SQL instance
in the per-tenant project. Verify Cloud SQL is provisioned:

```bash
gcloud sql instances list --project bc-<slug>
```

If it returns nothing, Cloud SQL capability isn't enabled for this
tenant yet. Enable it via the Portal cockpit's "DATA PLANE" panel or
the MCP tool `enable_cloudsql`, wait 5-15 min for the async
provisioner, then re-deploy.

### Cloud SQL connection fails with "permission denied for database"

The job's runtime GSA needs IAM bindings on the Cloud SQL instance +
the per-database `GRANT` from `tools/jobs-smoke/realistic-workload/qs-to-cloudsql/scripts/setup-db.sh`.
If you're seeing this on a fresh tenant, run that setup script (or its
equivalent — gcp-bctenant TF should be doing this automatically; if
it's not, file a bug with the project ID).

### Want to delete a job

Use the MCP tool `delete_compute_job` (recommended) or:

```bash
curl -sf -X DELETE "<GATEWAY_URL>/api/projects/<ORG_ID>/jobs/<JOB_NAME>"
```

This deletes the K8s Job/CronJob from the cluster and removes the
Portal's registration. The source repo is untouched — the job
reappears on next `/deploy_job`.

---

## See also

- [`skills/aether/compute.md`](../skills/aether/compute.md) — full
  schema reference, IAM-auth Cloud SQL quickstart, sharding patterns,
  notification setup
- ADR-019 (broadchurch repo):
  [`docs/DECISIONS.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md)
- Dispatcher design:
  [`docs/BC_2_TENANT_JOBS_DISPATCHER.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_JOBS_DISPATCHER.md)
- Substrate strategy + pivot history:
  [`docs/BC_2_TENANT_COMPUTE_JOBS.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_COMPUTE_JOBS.md)
- Working canonical reference (the smoke that proved this path):
  [`docs/bc-2-foundation-drafts/realistic-workload-smoke-001.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/bc-2-foundation-drafts/realistic-workload-smoke-001.md)
