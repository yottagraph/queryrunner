# Compute Jobs

A compute job is a **container that runs and exits** as a Kubernetes
Job on the tenant's per-tenant GKE cluster. It's the right primitive
whenever the work doesn't fit the request/response shape of a UI
server route or the conversational shape of an agent. Use it
for:

- **Cron** (nightly aggregations, daily exports, periodic refreshes)
- **Event-triggered batch** (HTTP from the Aether app or from an Agent
  Engine tool — kick off 30-minute work and let it run async)
- **Sharded fan-out** (process 100k entities across N parallel tasks)
- **Workflow steps** (multi-step DAGs orchestrated by Cloud Workflows)
- **Heavy compute** (GPU training, multi-day simulations, ≥ 16 vCPU /
  64 GiB tasks — anything that would have spilled outside Cloud Run's
  ceilings)

Per [ADR-019](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md)
(Consolidate Compute on Kubernetes Jobs — Remove Cloud Run Jobs
Runner), Kubernetes Jobs is the **sole runner**. The Cloud Run Jobs
runner is gone — `runner: cloud_run` is hard-rejected by the validator
with a pointer to the ADR. `runner: k8s_job` stays in the schema as
the optional default; absence coerces to `k8s_job`.

| Capability       | How to check                                                           | Standard env injected                                                                                            | Deploy command |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- |
| **Compute Jobs** | Always on for BC 2.0 tenants. `gcp.project` set in `broadchurch.yaml`. | `ORG_ID`, `GATEWAY_URL`, `QUERY_SERVER_URL`, `GOOGLE_CLOUD_PROJECT`, plus Cloud SQL coords when enabled (below). | `/deploy_job`  |

The Aether app never holds GCP credentials directly. The deploy
workflow runs as the GitHub Deploy SA in the per-tenant project, and
the Pod runs as the tenant runtime SA (`bc-tenant-jobs@bc-<slug>.iam.gserviceaccount.com`)
via K8s Workload Identity. Standard env vars give the job everything
it needs to reach Cloud SQL, BigQuery, and the platform gateway.

## Critical: never do these

The agent reflexively reaches for patterns that fit Vercel functions
or long-running services but break compute jobs. **Stop**, re-read
this file, and use the patterns below instead:

- **DO NOT put a job container into the Aether app.** Jobs ship as
  their own image — they have a `main.py` (or any executable) and a
  `requirements.txt` separate from the app's `package.json`. Mixing
  them bloats the app image and breaks the job deploy.
- **DO NOT expect a job to listen on `$PORT`.** A K8s Job pod is
  headless — the container starts, runs `main.py`, exits. If you try
  to bind a port the pod exits 0 immediately because `main.py`
  returned and the controller marks the Job Complete with nothing
  actually done.
- **DO NOT keep state on the filesystem between runs.** Each
  execution is a fresh pod — `/tmp` doesn't survive. Store progress /
  cursors / output in Cloud SQL, BigQuery, Firestore, or GCS — never
  on local disk.
- **DO NOT block a UI request on a job.** Jobs can run 12h+; a UI
  server route must _trigger_ and return, never wait for completion
  (Vercel functions hard-cap at 60s, and a GKE-hosted Nuxt request
  shouldn't hang either). POST to
  `/api/projects/<orgId>/jobs/<name>/run` to _trigger_ (returns
  immediately with an execution ID) and poll
  `/api/projects/<orgId>/jobs/<name>/runs` for status.
- **DO NOT add a `Dockerfile` "just to be safe".** The deploy
  workflow auto-generates a Python 3.12 Dockerfile that runs
  `python main.py` if one isn't present. Only write your own when
  you genuinely need a non-Python runtime or unusual system deps.
- **DO NOT pass passwords or connection strings via `env:`.** Use
  `${secret://name/version}` (resolves from GCP Secret Manager into
  an ad-hoc K8s Secret keyed by env-var name). For Cloud SQL,
  passwords don't exist — IAM auth (below) gives the pod a
  one-time DB token via its GSA identity.

## Quick start: a Cloud SQL aggregation job

This is the canonical BC 2.0 batch pattern: read or compute something,
write the result to per-tenant Postgres. The platform injects the
Cloud SQL connection coords; the Python Connector handles IAM auth.

```
jobs/nightly_refresh/
├── main.py
├── requirements.txt
└── job.yaml
```

`main.py`:

```python
"""Nightly aggregation — runs as the tenant runtime GSA via Workload Identity."""

import os

from google.cloud.sql.connector import Connector, IPTypes

INSTANCE_CONNECTION_NAME = os.environ["INSTANCE_CONNECTION_NAME"]
DB_USER = os.environ["DB_USER"]
DB_NAME = os.environ.get("DB_NAME", "bctenant")

connector = Connector()
try:
    conn = connector.connect(
        INSTANCE_CONNECTION_NAME,
        "pg8000",
        user=DB_USER,
        db=DB_NAME,
        enable_iam_auth=True,
        ip_type=IPTypes.PUBLIC,
    )
    try:
        # pg8000's Cursor doesn't implement __enter__/__exit__, so the
        # context-manager form (`with conn.cursor() as cur:`) raises
        # `TypeError: 'Cursor' object does not support the context
        # manager protocol`. Use the explicit try/finally pattern.
        cur = conn.cursor()
        try:
            cur.execute("""
                INSERT INTO daily_summary (date, total_count)
                SELECT CURRENT_DATE, COUNT(*) FROM events
                    WHERE created_at::date = CURRENT_DATE
                ON CONFLICT (date) DO UPDATE
                    SET total_count = excluded.total_count
            """)
            conn.commit()
        finally:
            cur.close()
    finally:
        conn.close()
finally:
    connector.close()

print("aggregation complete")
```

`requirements.txt`:

```
cloud-sql-python-connector[pg8000]>=1.10
pg8000>=1.30
```

`job.yaml`:

```yaml
name: nightly-refresh
cpu: '1'
memory: '1Gi'
task_timeout: '10m'
schedule: '0 2 * * *' # 2 AM daily
schedule_timezone: 'UTC'
```

Then commit, push, and from Cursor / Claude Code:

```
/deploy_job nightly_refresh
```

The deploy workflow renders a K8s CronJob (because `schedule:` is set),
applies it through Connect Gateway, and the controller fires the first
execution at the next 2 AM tick. Run history and ad-hoc "Run now" live
in the Portal's "Compute Jobs" tab.

> **Push alone doesn't deploy — but the template auto-dispatches for
> you.** `deploy-job.yml` is `workflow_dispatch`-only, so editing a job
> and pushing wouldn't update the running K8s Job/CronJob on its own. The
> template ships `.github/workflows/auto-deploy-jobs.yml`, which watches
> `jobs/**` on the default branch and re-dispatches `deploy-job.yml` for
> each changed job dir, so a normal commit+push deploys. Running
> `/deploy_job <name>` explicitly still works and is the way to force a
> redeploy without a code change. (Surfaced in the portfolio-risk smoke
> test, 2026-06-02 — Linear ENG-822.)

> **Why IAM auth + the Python Connector?** Cloud SQL on BC 2.0 is
> provisioned by `gcp-bctenant` Terraform with IAM auth + Private
> Service Connect (PSC); no plaintext password ever exists for the
> tenant runtime user. The `cloud-sql-python-connector` package
> exchanges the pod's GSA identity for a one-time DB token, opens the
> connection over IAM-authenticated TLS, and refreshes the token
> automatically. This is the same pattern the Aether app uses in
> production — see [`storage.md`](storage.md).

## Quick start: trigger a job from your Aether app

The app kicks off any deployed job via the Portal gateway. Use this
for "run my 30-minute enrichment in the background while the user
keeps clicking around":

```typescript
// server/api/refresh.post.ts — runs server-side (Nitro), never the browser
export default defineEventHandler(async () => {
    const gateway = useRuntimeConfig().public.gatewayUrl;
    const orgId = useRuntimeConfig().public.tenantOrgId;

    const res = await $fetch<{ executionId: string }>(
        `${gateway}/api/projects/${orgId}/jobs/nightly-refresh/run`,
        { method: 'POST', body: {} }
    );

    return { kicked_off: res.executionId };
});
```

What actually happens on the trigger: the Portal receives the request,
calls the tenant's GKE cluster over [Connect Gateway](https://cloud.google.com/kubernetes-engine/enterprise/multicluster-management/gateway)
using its **own** platform service account, and creates a fresh K8s
Job in the `tenant-jobs` namespace by cloning the deployed Job/CronJob
template. The Job's pod then runs as the tenant runtime GSA
(`bc-tenant-jobs@bc-<slug>.iam`) via Workload Identity — that's the
identity holding Cloud SQL / BigQuery access, not the caller. The call
**returns immediately**; poll `/jobs/<name>/runs` for terminal status
(`Succeeded` / `Failed` / `Cancelled`).

> **Call it server-side.** The trigger must come from your app's Nitro
> server (`server/api/*.ts`), not the browser: the Portal's
> `/api/projects/*` routes are scoped by the `org_id` in the path and
> are not CORS-allowlisted for tenant origins, so a browser `fetch`
> straight to the gateway run endpoint is blocked. Route it through
> your own server handler — which is where the `gatewayUrl` +
> `tenantOrgId` runtime config already lives. Stronger per-tenant auth
> on these endpoints is a known follow-up; the end-to-end
> GKE-UI-triggers-compute path is being validated under
> [ENG-804](https://linear.app/lovelace-tech/issue/ENG-804).

> **Same cluster, but go through the gateway anyway.** On BC 2.0 your
> UI is hosted as a Deployment in the per-tenant cluster's `tenant-ui`
> namespace — a sibling of the `tenant-jobs` namespace the Job lands
> in. It's tempting to have the UI pod create the Job directly against
> the in-cluster Kubernetes API, but the `tenant-ui` ServiceAccount has
> **no RBAC** into `tenant-jobs` (the namespaces are isolated by
> design). The Portal gateway is the supported trigger path; don't try
> to reach the cluster API from the UI pod.

> **Trigger latency note**: K8s Jobs take ~10-30s from create to first
> container output (Pod scheduling + image pull). Don't show a spinner;
> show "queued" and reload run-history every few seconds.

## Quick start: a sharded fan-out

Set `parallelism` and `task_count` to the same value for embarrassingly
parallel work. K8s `Indexed` completion mode (which exposes per-task
`JOB_COMPLETION_INDEX`) is a known gap — tracked in
[ENG-697](https://linear.app/lovelace-tech/issue/ENG-697); until it
lands, parallel tasks all see the same env and you'll need to do work
that doesn't need per-task IDs, or temporarily run as `parallelism: 1`
with the shard chosen via a `--shard` CLI arg invoked by something
else (Cloud Workflows step).

For now, the most useful shape is "one job per shard" — submit N jobs
in parallel from the workflow / trigger side, each with its own
`SHARD_INDEX` env var, instead of one job with N tasks:

```yaml
# job.yaml
name: enrich-shard
cpu: '2'
memory: '4Gi'
task_timeout: '30m'
env:
    SHARD_INDEX: '0' # overridden per execution via env_overrides
    TOTAL_SHARDS: '8'
```

```python
import os

shard = int(os.environ["SHARD_INDEX"])
total = int(os.environ["TOTAL_SHARDS"])

for entity in get_all_entities()[shard::total]:
    process(entity)
```

The Portal's `POST /api/projects/<id>/jobs/<name>/run` accepts an
`env_overrides` body that supplies per-execution overrides:

```typescript
for (let shard = 0; shard < 8; shard++) {
    await $fetch(`${gateway}/api/projects/${orgId}/jobs/enrich-shard/run`, {
        method: 'POST',
        body: { env_overrides: { SHARD_INDEX: String(shard) } },
    });
}
```

When ENG-697 lands the renderer will set `completionMode: Indexed` and
this section will be rewritten to use a single Job with `parallelism: 8,
task_count: 8` and pods reading `JOB_COMPLETION_INDEX` natively.

## Quick start: a multi-step workflow

For pipelines with retry semantics, error branches, or "after all
shards complete, then aggregate" patterns, escalate from a single job
to a Cloud Workflow that calls multiple jobs:

```
jobs/
├── enrich_entities/      # sharded job
├── score_entities/       # aggregator job
└── write_results/        # bulk insert job

workflows/
└── refresh_pipeline/
    ├── workflow.yaml     # Cloud Workflows DSL
    └── manifest.yaml     # platform-side schedule/timezone/input
```

Deploy each job with `/deploy_job` and the workflow itself with
`/deploy_workflow`. The workflow DSL lives at
[cloud.google.com/workflows/docs/reference/syntax](https://cloud.google.com/workflows/docs/reference/syntax);
Cloud Workflows is a separate substrate from compute jobs (per ADR-019
item 6 — it's not affected by the K8s consolidation).

You almost certainly don't need a workflow if a single job suffices —
the workflow engine is the right call only when steps need
retry-on-failure / continue-on-error / fan-out-then-aggregate
semantics that a single job can't express.

## Job manifest (`job.yaml`) at a glance

| Field                | Default      | Notes                                                                                                                               |
| -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | dir name     | Lowercase, hyphenated, ≤ 49 chars.                                                                                                  |
| `runner`             | `k8s_job`    | Only currently-accepted value; extension point for future substrates. `cloud_run` is hard-rejected per ADR-019.                     |
| `cpu`                | `"1"`        | Whole or fractional vCPU. Caps at the GKE nodepool's allocatable.                                                                   |
| `memory`             | `"1Gi"`      | `"512Mi"`, `"1Gi"`, `"64Gi"`. Caps at the GKE nodepool's allocatable.                                                               |
| `max_retries`        | `1`          | Per-task retry count (0-10). Maps to `Job.spec.backoffLimit`.                                                                       |
| `task_timeout`       | `"1h"`       | `"300s"`, `"30m"`, `"12h"`. Maps to `Job.spec.activeDeadlineSeconds`.                                                               |
| `parallelism`        | `1`          | Tasks running concurrently.                                                                                                         |
| `task_count`         | `1`          | Total task count (for sharding).                                                                                                    |
| `provisioning_model` | `"standard"` | `"standard"` / `"spot"`. **`"spot"` rejected at deploy today** — pending [ENG-563](https://linear.app/lovelace-tech/issue/ENG-563). |
| `schedule`           | (none)       | 5-field cron expression. When set, the workflow renders a K8s CronJob instead of a Job.                                             |
| `schedule_timezone`  | `"UTC"`      | IANA timezone (`"America/New_York"`).                                                                                               |
| `env`                | `{}`         | Extra env vars (see secret-ref syntax below). Overrides the platform-injected env if you set the same key.                          |
| `notify`             | (none)       | Slack/email notification rendering server-side.                                                                                     |
| `post_steps`         | `[]`         | Inline shell scripts that run after the main task.                                                                                  |

Run the validator locally before pushing to catch malformed manifests
at edit-time:

```bash
python3 scripts/validate-job-manifest.py jobs/<name>/job.yaml
```

The same validator runs in the deploy workflow and is the canonical
schema enforcer — it rejects unknown fields, deprecated runner values
(`cloud_run`, `batch`), malformed durations, secret-ref typos, and
cross-field violations with line-level error messages.

### Env values

```yaml
env:
    SHARD_LIMIT: '5000' # literal
    DB_PASS: '${secret://nightly-db-pass/latest}' # required Secret Manager ref
    OPT_API_KEY: '${secret://maybe-missing/1?}' # optional; empty string if missing
```

`name` is a Secret Manager secret in the tenant's GCP project.
`version` is either a numeric version (`"1"`, `"42"`) or `"latest"`.
The trailing `?` makes the ref optional — required refs fail the
deploy when the secret is missing or the deploy SA can't read it.

The deploy workflow materializes secret refs into an ad-hoc K8s Secret
named `job-{job_name}-secrets`, then the rendered Pod spec wires them
in via `secretKeyRef`. No secret values live in your `env:` block, the
manifest, or the image.

### Notifications

```yaml
notify:
    on_failure:
        slack: '#bc-alerts'
    on_success:
        slack: '#bc-jobs'
        email: oncall@example.com
    artifacts:
        - path: /tmp/report.html # task-local file, auto-uploaded
          slack_link: 'Report'
        - gcs: gs://my-bucket/result.csv # already-uploaded GCS object
          slack_link: 'CSV'
    signed_url_ttl: '24h'
```

The notify renderer + signed-URL minter
([ENG-552](https://linear.app/lovelace-tech/issue/ENG-552)) is
in-flight. Until it lands, the schema parses but no Slack message is
sent — set up notifications when the issue closes.

## Standard environment variables

Every K8s Job task automatically receives:

| Env var                    | Value                                                                                               | When set          |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| `ORG_ID`                   | Auth0 org ID for this tenant                                                                        | Always            |
| `GATEWAY_URL`              | Broadchurch Portal base URL                                                                         | Always            |
| `QUERY_SERVER_URL`         | Yottagraph Elemental API URL                                                                        | Always            |
| `GOOGLE_CLOUD_PROJECT`     | `bc-{slug}` (per-tenant GCP project)                                                                | Always (BC 2.0)   |
| `INSTANCE_CONNECTION_NAME` | `bc-{slug}:us-central1:bc-{slug}-pg-{suffix}` — full Cloud SQL connection name                      | Cloud SQL enabled |
| `DB_USER`                  | `bc-tenant-jobs@bc-{slug}.iam` — IAM-auth Postgres user                                             | Cloud SQL enabled |
| `DB_NAME`                  | `bctenant` (default per-tenant database)                                                            | Cloud SQL enabled |
| `JOB_COMPLETION_INDEX`     | K8s per-task shard ID (0-based) — pending [ENG-697](https://linear.app/lovelace-tech/issue/ENG-697) | Indexed Jobs only |

The injection happens in the deploy workflow's
"Derive standard env (ENG-695)" step. The Cloud SQL coords are
best-effort — if the tenant doesn't yet have a Cloud SQL instance
(capability not enabled, or still provisioning) the three SQL env
vars are simply omitted, and any code that depends on them should
guard with `os.environ.get(...)` and fail fast with a clear "Cloud
SQL not enabled" message.

Anything in `job.yaml`'s `env:` block is merged on top with `env:`
keys taking precedence — useful when you need a per-job override
(e.g. a tenant with a non-default `DB_NAME` for a particular job).

BigQuery env (`BIGQUERY_DATASET`, `BIGQUERY_LOCATION`) is **not**
auto-injected today; if your job writes to BigQuery, set them
explicitly in `job.yaml` `env:` (the Portal's `gcp.bigquery_dataset`
field in `broadchurch.yaml` is a known follow-up under ENG-695).

## Cloud SQL vs BigQuery — where to write

A common source of confusion. The short answer:

| Dimension          | Cloud SQL (IAM auth via Python Connector)           | BigQuery (`BIGQUERY_DATASET`)                              |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| Workload           | Transactional. RMW, joins, FK, UI-driven mutations. | Analytical. Append-only, time-series, columnar.            |
| Typical row size   | KB                                                  | MB                                                         |
| Typical row count  | thousands–millions                                  | millions–billions                                          |
| Query latency      | ms                                                  | seconds                                                    |
| Idle cost          | constant (always-on instance)                       | zero (on-demand pricing)                                   |
| Schema flexibility | strict; migrations are real work                    | append-friendly                                            |
| App reads          | Yes — same IAM Connector pattern in the Aether app  | No — app reads via Portal API ([bigquery.md](bigquery.md)) |

**Rule of thumb for compute jobs:**

- Job _reads state and updates a few rows_ → **Cloud SQL**
- Job _appends a result set the UI doesn't mutate_ → **BigQuery**
- Job _generates a snapshot for a dashboard_ → **BigQuery**
- Job _fans out work and records what it did_ → **BigQuery** for the
  audit trail; Cloud SQL only if the UI needs to mutate the records
  afterwards

If the job needs both — transactional state AND an analytics snapshot
— write to Cloud SQL first, then have a follow-up sync step copy the
snapshot to BigQuery. Don't dual-write inside the same task.

Don't have one of these enabled? See [`storage.md`](storage.md) for
Cloud SQL provisioning and [`bigquery.md`](bigquery.md) for the
BigQuery analytical surface.

## Reaching Lovelace data from a compute job

Compute jobs read upstream Lovelace data (entities, filings, news,
sentiment, prices) **via the Query Server REST surface**, not via MCP.
Both endpoints front the same backend, but MCP is the LLM-tool protocol
— overhead, prose-shaped responses, and missing endpoints (e.g. the
`/elemental/find` expression language) when the caller is a deterministic
batch job that already knows what it wants. See
[`data.md`](data.md#choosing-the-access-path--query-server-rest-vs-mcp)
for the full access-path map.

The standard env vars (`GATEWAY_URL`, `QUERY_SERVER_URL`, `ORG_ID`) plus
the `qs_api_key` from `broadchurch.yaml` are all you need. Two equivalent
URL shapes:

- **Through the portal gateway** — `{GATEWAY_URL}/api/qs/{ORG_ID}/...`.
  Use this when the job runs anywhere outside the per-tenant cluster, or
  whenever you want the per-tenant brokerage layer in the path.
- **Direct to the Query Server** — `{QUERY_SERVER_URL}/elemental/...`.
  Slightly lower latency for in-cluster jobs; still routed through the
  same auth via `X-Api-Key`.

Quick example — a job that fetches a property bundle for a list of
entities and writes the result to Cloud SQL:

```python
import json
import os

import httpx
import yaml
from google.cloud.sql.connector import Connector, IPTypes

ORG_ID = os.environ["ORG_ID"]
GATEWAY_URL = os.environ["GATEWAY_URL"].rstrip("/")
QS_API_KEY = yaml.safe_load(open("broadchurch.yaml"))["gateway"]["qs_api_key"]

def get_property_values(eids: list[str], pids: list[int]) -> dict:
    """Batch-fetch property values from the Query Server via the gateway proxy."""
    resp = httpx.post(
        f"{GATEWAY_URL}/api/qs/{ORG_ID}/elemental/entities/properties",
        headers={"X-Api-Key": QS_API_KEY},
        data={"eids": json.dumps(eids), "pids": json.dumps(pids)},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()

# ... iterate, transform, write to Cloud SQL via the IAM-auth Connector ...
```

Patterns to copy:

- Read `qs_api_key` from `broadchurch.yaml`, not from an env var the job
  has to remember to set. The file is mounted into the image at deploy
  time alongside `main.py`.
- `eids` and `pids` are JSON-stringified arrays sent as
  `application/x-www-form-urlencoded` for the `/elemental/find` and
  `/elemental/entities/properties` endpoints — `application/json`
  everywhere else. See [`data.md`](data.md#step-2-curl-verify-exact-requestresponse-shapes).
- Treat FIDs and PIDs as strings in Python _and_ JS. Some are larger
  than `Number.MAX_SAFE_INTEGER`; `json.loads` is fine in Python but
  `JSON.parse` will silently round them in TypeScript.
- 404 from an entity/property endpoint = "no data for this query," not
  "the server is broken." Validate connectivity with the health endpoint
  separately if needed.

If your job genuinely needs prediction-market or live-stock signals
(neither has a QS-REST surface today), reach those via their MCP
servers (`polymarket`, `stocks`) — that's an exception, not the rule.
For everything in the Elemental graph (filings, news, sentiment,
entity relationships, events), use QS REST.

## Triggering jobs from your code

### From the Aether app (HTTP)

```typescript
const gateway = useRuntimeConfig().public.gatewayUrl;
const orgId = useRuntimeConfig().public.tenantOrgId;

await $fetch(`${gateway}/api/projects/${orgId}/jobs/<job-name>/run`, {
    method: 'POST',
    body: {
        /* optional env_overrides */
    },
});
```

Returns immediately. Call it **server-side** (Nitro `server/api/*.ts`,
not the browser — see the trigger quick-start above for why). The
Portal creates the Job in `tenant-jobs` via Connect Gateway under its
own platform SA; the pod runs as the tenant runtime GSA. Poll
`/jobs/<name>/runs` for status. Per-execution `env_overrides` (re-run
with a different `SHARD_INDEX`, say) is supported and lands as
overrides on the K8s container's env block.

### From an agent tool

Same endpoint, called over HTTP from inside a tool function — BC 2.0
agents run in-cluster and reach the Portal gateway the same way the UI
server does. See [`agents.md`](agents.md) for the tool-defining pattern
and [`agents-data.md`](agents-data.md) for how the agent reaches the
Portal URL.

### From a schedule

Set `schedule:` and `schedule_timezone:` in `job.yaml`. The deploy
workflow renders a K8s CronJob instead of a Job; the controller fires
the first execution at the next cron tick. Re-deploy to change the
schedule — there's no "edit schedule" UI yet.

### From a workflow

The workflow DSL calls the Portal's job-run endpoint with the job
name. See the workflow quick-start above.

## Common pitfalls

- **Hardcoded paths.** `/tmp` is the only writable filesystem location
  inside the pod, and it doesn't survive across executions. Write
  artifacts to GCS, not to a local path you'll never read again.
- **Slack URLs in `env:`.** Don't paste a webhook URL directly — put
  it in Secret Manager and reference it as
  `${secret://slack-webhook/latest}`. The `env:` block is visible in
  the Portal UI and in the rendered K8s manifest.
- **Skipping the validator.** The platform-side validator catches
  cross-field violations, deprecated runner names, malformed durations,
  etc. at deploy time. Running it locally first turns a 5-minute GHA
  feedback loop into a 5-second one.
- **Treating a job like an agent.** Agents are conversational and
  long-lived (an in-cluster GKE service on BC 2.0). Jobs are batch and exit. If you
  find yourself adding a chat loop or a tool-calling abstraction
  inside `main.py`, you're probably better off with an agent in
  `agents/` — see [`agents.md`](agents.md).
- **Trying to use a password with Cloud SQL.** There isn't one. BC 2.0
  Cloud SQL only accepts IAM auth — the `cloud-sql-python-connector`
  package with `enable_iam_auth=True` exchanges the pod's GSA identity
  for a one-time DB token. If you find yourself looking for
  `DATABASE_URL` or a `DB_PASSWORD` secret, you're on the wrong path
  — re-read the Quick Start above.
- **Forgetting to use `${secret://…}` for non-Cloud-SQL credentials.**
  API tokens, third-party DB passwords, signing keys all belong in
  Secret Manager and ride into the pod via the `${secret://name/version}`
  ref syntax — not pasted into `env:` as literals.
- **Hand-rolling MCP JSON-RPC envelopes from inside a compute job.** If
  you're writing `httpx.post(mcp_url, json={"jsonrpc": "2.0", "method": "tools/call", ...})`
  inside `main.py`, you're using the wrong protocol. MCP is the
  LLM-driven tool surface; a compute job is deterministic batch code
  that should be calling the Query Server REST endpoints directly. See
  the "Reaching Lovelace data from a compute job" section above and
  [`data.md`'s access-path map](data.md#choosing-the-access-path--query-server-rest-vs-mcp).
  The exception is when the data genuinely lives only behind an MCP
  server today (`stocks`, `polymarket`); for everything in the Elemental
  graph, use QS REST.

## Where things live

- **Job source**: `jobs/<name>/main.py`, `requirements.txt`,
  `job.yaml` (this repo).
- **Workflow source**: `workflows/<name>/workflow.yaml`,
  `manifest.yaml` (this repo).
- **Container image**: `gcr.io/bc-{slug}/job-<name>` in the per-tenant
  Artifact Registry (built by `deploy-job.yml`).
- **K8s Job**: in the `tenant-jobs` namespace of the per-tenant GKE
  cluster, labelled with `bc-job-name=<name>` and
  `compute-job-id=<uuid>` (per-execution).
- **K8s CronJob**: same namespace, name `bc-job-<name>`, when
  `schedule:` is set.
- **Portal registration**: `tenants/<orgId>.jobs.<name>` (platform
  Firestore in the `broadchurch` project, **not** the tenant
  Firestore).
- **Standard-env injection**: `.github/workflows/deploy-job.yml`'s
  "Derive standard env (ENG-695)" step.
- **Manifest renderer**: `scripts/render-k8s-job.py`.
- **Validator**: `scripts/validate-job-manifest.py`.
- **Starter**: `jobs/example_job/` — copy-and-customize.

## See also

- **K8s Jobs dispatcher design** (broadchurch repo):
  [`docs/BC_2_TENANT_JOBS_DISPATCHER.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_JOBS_DISPATCHER.md)
- **Substrate strategy + ADR-019 pivot** (broadchurch repo):
  [`docs/BC_2_TENANT_COMPUTE_JOBS.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_COMPUTE_JOBS.md)
- **Transactional storage**: [`storage.md`](storage.md) — Cloud SQL
  (IAM auth via Python Connector), Firestore, Neon Postgres.
- **Analytical storage**: [`bigquery.md`](bigquery.md) — append-only
  surface, `runQuery()` / `runMutation()`, wire-format gotchas.
- **Agents**: [`agents.md`](agents.md) and
  [`agents-data.md`](agents-data.md) — when to use an agent vs a job.
- **MCP servers**: [`mcp-servers.md`](mcp-servers.md) — when to
  expose tools instead of running batch work.
- **Deployment in general**: [`deployment.md`](deployment.md) — how
  agents, MCP servers, and the Aether app all reach production.
- **Kubernetes Jobs docs**:
  [kubernetes.io/docs/concepts/workloads/controllers/job/](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- **Cloud SQL Python Connector**:
  [cloud.google.com/sql/docs/postgres/connect-connectors](https://cloud.google.com/sql/docs/postgres/connect-connectors)
- **Cloud Workflows DSL**:
  [cloud.google.com/workflows/docs/reference/syntax](https://cloud.google.com/workflows/docs/reference/syntax)
