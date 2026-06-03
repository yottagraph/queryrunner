# Aether UI — Kubernetes Reference

This directory is intentionally light. The Aether UI's Kubernetes
resources on a BC 2.0 GCP-hosted tenant come from a Helm chart that
**ArgoCD** syncs from an OCI registry; nothing in this directory is
applied to your cluster.

> If your tenant has `hosting: vercel` in `broadchurch.yaml`, nothing
> in this directory applies to you. Vercel handles your UI; this
> directory is dormant.

## Where the manifests actually live

- **Helm chart source**: [`aether-dev/charts/aether-ui/`](../../charts/aether-ui/) —
  source of truth for the Deployment + Service + ServiceAttachment +
  OnePasswordItem(s) + ServiceAccount.
- **Published chart**: `oci://ghcr.io/lovelace-ai/internal/charts/aether-ui`
  (CI publishes from `charts/aether-ui` on every change to `main`;
  see [`publish-aether-ui-chart.yml`](../../.github/workflows/publish-aether-ui-chart.yml),
  filed under Linear ENG-718).
- **ArgoCD Application** (per-tenant): provisioned by
  `gcp-bctenant`'s `argocd-applications/templates/aether-ui-application.yaml`
  (filed under Linear ENG-720). Pulls the OCI chart, plumbs Terraform
  outputs into Helm values.
- **Image tag flow**: tenant repo push → `deploy-ui.yml` → Cloud Build
  → Artifact Registry → Portal `POST /ui-deploys` → Firestore →
  `gcp-bctenant tf-apply` → ArgoCD sync → rolling Deployment update.
  Total latency ~6-11 minutes.

## What the deploy workflow actually does

`deploy-ui.yml` in the tenant repo:

1. Builds the Aether Docker image via Cloud Build, tagged with the
   commit SHA.
2. Pushes to the per-tenant Artifact Registry `aether` repo.
3. Calls the Portal `POST /api/projects/<org_id>/ui-deploys` endpoint
   with the new image tag.

It does **not** call `kubectl` at all. The Portal records the new image
tag in Firestore and dispatches a `tf-apply` that re-renders the
ArgoCD Application's values; ArgoCD picks up the change and rolls
the Deployment.

## See also

- [Design contract](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_TENANT_UI_HOSTING_PHASE1.md)
  — the authoritative v2 GitOps-first contract.
- [Substrate ADR-020](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md#adr-020-tenant-ui-substrate--gke-deployment-in-per-tenant-cluster)
- Sibling: `jobs/<name>/` — K8s Jobs manifests live in the tenant repo
  because jobs are many-per-tenant and tenant-customisable. UI is
  exactly-one-per-tenant and uniform across tenants, so its manifests
  live in the platform-controlled Helm chart instead.
- Deploy command: `commands/deploy_ui.md` (and the post-install
  `.agents/commands/deploy_ui.md` mirror).
