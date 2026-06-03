# Deploy Aether UI

Deploy the Aether UI to the per-tenant GKE cluster (BC 2.0 GCP
substrate, per [ADR-020](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md#adr-020-tenant-ui-substrate--gke-deployment-in-per-tenant-cluster)).

## When to use

This command applies to tenants whose `broadchurch.yaml` has `hosting:
gcp` — i.e. **BC 2.0 tenants that opted into the GCP substrate during
provisioning**.

If your tenant has `hosting: vercel` (or no `hosting:` field at all),
your UI deploys through Vercel automatically on push to `main`. This
command does nothing for you — see the Vercel dashboard linked from
the BC 2.0 cockpit for deploy state.

## What it does (v2 GitOps shape)

Triggers the tenant repo's `.github/workflows/deploy-ui.yml` workflow.
The workflow:

1. Reads `broadchurch.yaml` and confirms `hosting: gcp`.
2. WIF-authenticates as the shared `github-deploy@broadchurch.iam.gserviceaccount.com`
   service account.
3. Resolves the per-tenant GCP project + region via the Portal
   `GET /api/projects/<org_id>/connect-gateway` endpoint (the same
   canonical pattern `deploy-job.yml` uses). The per-tenant project
   ID lives in Firestore as `tenants/<id>.gcp.project_id`, written
   back by tf-apply under ENG-709; it is **not** duplicated into
   `broadchurch.yaml`.
4. Builds the repo-root `Dockerfile` with a runner-side `docker build`
   and pushes to `<region>-docker.pkg.dev/<tenant-project>/aether/aether-app:<sha-7>`.
   (Earlier revisions used Cloud Build; ENG-757 switched to runner-side
   docker after the smoke uncovered org-policy + IAM friction on the
   Cloud Build path.)
5. POSTs to the Portal `/api/projects/<org_id>/ui-deploys` endpoint with
   the new `image_tag` + `image_repository`. The Portal writes Firestore
   and dispatches `gcp-bctenant tf-apply.yaml`.
6. `tf-apply.yaml` re-renders the `aether-ui` ArgoCD Application's
   `image.tag` value. ArgoCD detects the change and rolls the
   Deployment automatically.

No `kubectl` calls anywhere outside ArgoCD's own apply path. All
K8s resources for the UI (Deployment + Service + ServiceAttachment +
OnePasswordItem + ServiceAccount) come from the `aether-ui` OCI
Helm chart published by `aether-dev`; ArgoCD owns the apply.

## Prerequisites

- Tenant has `hosting: gcp` in `broadchurch.yaml`.
- Tenant's per-tenant GCP project has been provisioned **with the UI
  substrate enabled** — i.e. `bc_infra_tenants/<org_id>.enable_tenant_ui`
  is `true`. The Portal sets this when a BC 2.0 wizard run picks
  `hosting: gcp`, or you can flip it via the cockpit's "Enable GCP
  substrate" button.
- The repo-root `Dockerfile` exists (it does — shipped from the aether
  template).
- The commit you want to deploy is pushed to `main` (or whatever branch
  you want to roll from — the workflow uses the workflow-run's SHA).

## Step 1: Read configuration

```bash
cat broadchurch.yaml | yq '{hosting, gcp, tenant, gateway}'
```

If `hosting` is `vercel` (or missing), stop — this command isn't for
you.

If `hosting` is `gcp`, note `tenant.org_id` and `gateway.url` for the
manual fallback in Step 3.

## Step 2: Ensure code is pushed

```bash
git status
```

If there are uncommitted changes you want deployed, commit and push
first. The workflow builds from the GitHub SHA, not your local tree.

## Step 3: Trigger the deploy

Two paths, both wired to the same workflow (ENG-759):

**Auto-trigger (default).** Pushing UI-relevant files to `main` triggers
`deploy-ui.yml` automatically — mirrors the Vercel "push to main =
deploy" mental model. The path filter on the `push:` trigger covers:

- `pages/`, `components/`, `composables/`, `layouts/`, `plugins/`,
  `middleware/`, `server/`, `utils/`, `assets/`, `public/`,
  `features/`, `agents/`
- `app.vue`, `error.vue`, `nuxt.config.ts`, `tsconfig.json`,
  `package.json`, `package-lock.json`
- `Dockerfile`, `.dockerignore`, `broadchurch.yaml`,
  `.github/workflows/deploy-ui.yml`

Doc-only commits (`README.md`, `docs/`, `DESIGN.md`),
instruction-package updates (`.agents/`), and dev-only directories
(`tests/`) do NOT trigger a deploy — they don't change the runtime
image.

**Manual trigger.** Always available as a fallback (e.g. you want to
re-run an old SHA, or roll back, or push touched only non-listed
paths and you still want a deploy):

```bash
gh workflow run deploy-ui.yml
```

(Or click "Run workflow" in the GitHub Actions UI on the Aether UI
workflow.)

The two triggers share a `concurrency` group keyed on the branch, so
a `push` + `workflow_dispatch` for the same SHA will queue rather than
race. Queued runs don't cancel-in-progress (cancelling mid-`docker
push` leaves orphan AR layers).

## Step 4: Monitor

```bash
gh run watch -R <owner>/<repo>
# or
gh run list -R <owner>/<repo> --workflow deploy-ui.yml --limit 3
```

The workflow output emits a `::notice::` with the `gcp-bctenant
tf-apply.yaml` run URL the Portal dispatched — follow that link to
watch the ArgoCD-side roll land:

```bash
gh run watch <tf-apply-run-id> -R Lovelace-AI/gcp-bctenant
```

Typical timeline:

- **0-30s**: workflow queues, checks out, validates substrate,
  resolves per-tenant project via `/connect-gateway`.
- **30s-1.5m**: runner-side `docker build` + `docker push`
  (~30-90s, depending on cache).
- **1.5-2m**: `POST /ui-deploys` lands; Firestore patched;
  `gcp-bctenant tf-apply.yaml` dispatch confirmed.
- **2-8m**: `tf-apply.yaml` runs (~5-8m end-to-end — Terraform
  init/plan/apply for a small ArgoCD Application diff).
- **8-10m**: ArgoCD detects the value change (poll interval ≤ 3m)
  and the rolling Deployment update completes (~30-90s).

Once both runs succeed, the new SHA is live at
`https://*.<slug>.tenant.g.lovelace.ai`. The cockpit's UI Substrate
panel reflects the new image and "Deployed at" time within ~5s of
ArgoCD's sync completing.

## Rollback

The same path as a forward deploy, with the prior SHA written to
Firestore instead:

```bash
# Operator-side rollback (writes Firestore via the same endpoint
# the deploy workflow uses):
curl -sf -X POST "<GATEWAY_URL>/api/projects/<ORG_ID>/ui-deploys" \
  -H 'Content-Type: application/json' \
  -d '{
    "image_tag": "<previous-sha-7>",
    "image_repository": "<region>-docker.pkg.dev/<project>/aether/aether-app",
    "commit_sha": "<previous-full-sha>",
    "deployed_by": "rollback"
  }'

# Or click "Rollback to <prev-sha>" in the cockpit's UI Substrate
# panel — same endpoint, same Firestore + tf-apply path.
```

DO NOT use `kubectl rollout undo` against the live Deployment.
ArgoCD's `selfHeal: true` policy will immediately re-roll it to the
SHA in Firestore. The cockpit / `POST /ui-deploys` is the only way
to roll back persistently.

## Troubleshooting

### "hosting=vercel — Aether UI is not on the GCP substrate"

The workflow exited cleanly because `broadchurch.yaml` says
`hosting: vercel`. To migrate to the GCP substrate, follow
[ENG-665 Phase 3](https://linear.app/lovelace-tech/issue/ENG-665) (not
yet shipped — migration playbook still in design).

### "Repo root Dockerfile is required for the GCP substrate"

The workflow couldn't find `Dockerfile` at the repo root. The
canonical multi-stage Dockerfile shipped from the aether template in
[aether-dev#129](https://github.com/Lovelace-AI/aether-dev/pull/129);
re-run `/update_instructions` or compare against `aether-dev/Dockerfile`.

### Portal `POST /ui-deploys` returns 412 ("enable_tenant_ui is not true")

The substrate hasn't been enabled for this tenant. Either:

- Flip `hosting: gcp` in `broadchurch.yaml` and re-run BC 2.0
  provisioning (preferred for new tenants).
- Manually set `bc_infra_tenants/<org_id>.enable_tenant_ui = true`
  in Firestore and run `gcp-bctenant tf-apply.yaml` once (operator
  workaround for tenants that predate the capability flag).

### `docker build` / `docker push` fails

Check the workflow logs for the failing step. Common causes:

- **`prebuild` guard trips on direct `@google-cloud/*` imports**: the
  build still rejects direct SDK calls because Phase 1 hasn't yet
  relaxed the guard for the GCP substrate. For now, route GCP data
  calls through the Portal proxy.
- **AR repo missing** (`name unknown: Repository "aether" not found`):
  the per-tenant `aether` AR repo is provisioned by `gcp-bctenant`'s
  `enable_tenant_ui` capability bundle ([ENG-707](https://linear.app/lovelace-tech/issue/ENG-707)).
  If your tenant predates that, the first push fails; ping
  #broadchurch-platform.
- **`denied: Permission "artifactregistry.repositories.uploadArtifacts" denied`**:
  the `github-deploy@broadchurch.iam.gserviceaccount.com` SA is
  missing `roles/artifactregistry.writer` on the per-tenant project.
  gcp-bctenant grants this automatically when `enable_tenant_ui` is
  true ([ENG-758](https://linear.app/lovelace-tech/issue/ENG-758));
  if it's missing, re-run `gcp-bctenant tf-apply.yaml`.

### Auto-trigger fires during tenant init and exits with "substrate not yet provisioned"

Expected, not a failure. During the first ~15-25 min of a new BC 2.0
tenant's life, the Portal pushes several setup commits
(`[Broadchurch] Configure tenant`, `[Aether] Initialize project`)
to `main` while `gcp-bctenant tf-apply.yaml` is still warming up the
per-tenant project. Those pushes can match the auto-trigger's path
filter (the init commit touches `package.json` etc.). The substrate
guard catches this: Portal `/connect-gateway` returns 404/409, the
workflow logs a `::notice::` and exits 0 cleanly. The next push
(typically the agent's first UI commit) lands after the substrate is
ready and deploys normally. No operator action required.

### "Portal /connect-gateway returned HTTP 5xx" (not 404/409)

The Portal couldn't reach Firestore or returned an unexpected error.
This IS a hard fail (distinct from the 404/409 "not yet ready" case
above). Check Portal health:

```bash
curl -s -w '%{http_code}\n' "${gateway.url}/api/projects/<org>/connect-gateway"
```

If the Portal returns 200 manually, the failure was transient — re-run
the workflow. If it persists, ping #broadchurch-platform.

### ArgoCD shows the Application as `OutOfSync` but never rolls

Three places to check:

1. **The tf-apply run** dispatched by the Portal — did it succeed?
   Follow the `::notice::` link in the deploy workflow output. If
   tf-apply failed, the Application's `image.tag` value didn't get
   updated and ArgoCD has nothing new to sync.
2. **ArgoCD's sync interval** — the auto-sync policy polls every
   3 min by default. Force a sync from the ArgoCD UI if you can't
   wait.
3. **Image pull errors** — `kubectl describe pod -n tenant-ui -l app.kubernetes.io/name=aether-ui`
   (read-only — the tenant's deployer role has `get`/`list`/`watch`
   only, intentionally; for any actual remediation see ArgoCD or
   the cockpit, not direct kubectl).

## See also

- Phase 1 design contract:
  [`broadchurch/docs/BC_2_TENANT_UI_HOSTING_PHASE1.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_UI_HOSTING_PHASE1.md)
- Substrate ADR:
  [`broadchurch/docs/DECISIONS.md` § ADR-020](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md#adr-020-tenant-ui-substrate--gke-deployment-in-per-tenant-cluster)
- Aether UI Helm chart source: [`aether-dev/charts/aether-ui/`](https://github.com/Lovelace-AI/aether-dev/tree/main/charts/aether-ui)
  (published as `oci://ghcr.io/lovelace-ai/internal/charts/aether-ui`).
- Sibling: `/deploy_job` for the K8s Jobs substrate.
