#!/usr/bin/env python3
"""
job.yaml -> K8s Job / CronJob manifest renderer (ENG-550 / PR-A3-v2).

Pure Python, dependency-free beyond stdlib + pyyaml. Reads the
normalized JSON manifest emitted by `scripts/validate-job-manifest.py`
on stdin (or `--manifest <path>`), plus cluster coordinates + container
image from CLI flags, and writes a single `Job` or `CronJob` YAML
document to stdout suitable for `kubectl create -f -` (Jobs) or
`kubectl apply -f -` (CronJobs).

Run as:

    # Direct (manifest on stdin):
    python3 scripts/validate-job-manifest.py jobs/example_job/job.yaml \\
      | python3 scripts/render-k8s-job.py \\
          --image gcr.io/PROJECT/job-example:abc123 \\
          --namespace tenant-jobs \\
          --execution-id $(uuidgen) \\
          --org-id 12345678-...

    # From a file:
    python3 scripts/render-k8s-job.py \\
      --manifest /tmp/manifest.json \\
      --image gcr.io/PROJECT/job-example:abc123 \\
      --namespace tenant-jobs \\
      --execution-id $(uuidgen) \\
      --org-id 12345678-...

Exit codes:
    0  - manifest rendered; YAML on stdout
    1  - invalid input (CLI args, JSON parse, unsupported field)
    2  - manifest rejected at dispatch time (e.g. `provisioning_model:
         spot` when the cluster has no spot nodepool — see ENG-563)

--- Why pure Python + pyyaml (no kubernetes-client) ---

The workflow runs in `ubuntu-latest` which has `python3` + `python3-yaml`
baked in. Pulling in `kubernetes` (~25 MB, transitive deps) for a
pure-template task would add ~20s of `pip install` to every deploy.
The YAML we're emitting is small and well-understood; a hand-rolled
dict→yaml.dump is plenty.

--- Why the rendered manifest names + labels matter ---

`bc-job-name` (stable across executions) is what the Portal's
`k8s-jobs.ts` lists by; it's how the platform groups all of a job's
historical runs under one logical name. `compute-job-id` (per-execution
UUID) is what log lines and the cockpit's execution-detail view
correlate on. Both ride on metadata.labels AND
spec.template.metadata.labels so they're queryable at both Job and Pod
scope.

The K8s `Job` `metadata.name` is `bc-job-{job_name}-{exec_id_short}`,
unique per execution — `kubectl create` (rather than `apply`) rejects
collisions so a re-deploy can't accidentally clobber an in-flight run.
CronJobs use `bc-job-{job_name}` (stable) so subsequent re-deploys
patch the schedule rather than racing two CronJobs for the same job.

--- Secret references ---

`${secret://NAME/VERSION}` env values become `valueFrom.secretKeyRef`
entries pointing at a single K8s Secret named `job-{job_name}-secrets`,
keyed by env-var name. The renderer does NOT fetch secret values — that's
the workflow's job (it has `gcloud` auth as github-deploy, the renderer
shouldn't). The renderer just emits the right `secretKeyRef` plumbing
so when the workflow later `kubectl apply`s the materialized Secret,
the Job picks it up cleanly.

`--print-secret-refs` flag emits the list of `(env_var, secret_name,
version, optional)` tuples as JSON to stderr (separate channel so the
YAML stdout stays clean) for the workflow's secret-resolver step.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import yaml


class _NoAliasDumper(yaml.SafeDumper):
    """Disable YAML anchors/aliases in the rendered output. Some K8s
    YAML consumers (older kubectl, kustomize variants, k9s) trip on
    anchor refs even though the YAML spec allows them. Forcing every
    repeated dict to render as its own copy keeps the output portable
    and human-readable at the cost of a few extra lines per CronJob."""

    def ignore_aliases(self, data: object) -> bool:
        return True

# Mirrors `validate-job-manifest.py`'s RE_SECRET_REF. Kept in lockstep
# because both scripts share the contract — if validate accepts a
# secret ref, render MUST be able to wire it.
RE_SECRET_REF = re.compile(
    r"^\$\{secret://"
    r"(?P<name>[A-Za-z0-9_-]{1,255})"
    r"/(?P<version>[1-9][0-9]*|latest)"
    r"(?P<optional>\?)?"
    r"\}$"
)

# K8s + Broadchurch label keys. `bc-job-name` is the stable identifier
# the Portal lists by (`k8s-jobs.ts` uses it as the `labelSelector`).
# `compute-job-id` is the per-execution correlation key the cockpit
# uses for execution-detail views. Both are required on every rendered
# Job / Pod by contract.
STABLE_JOB_LABEL = "bc-job-name"
EXECUTION_ID_LABEL = "compute-job-id"
MANAGED_BY_LABEL = "app.kubernetes.io/managed-by"
ORG_ID_LABEL = "broadchurch.io/org-id"
RUNNER_LABEL = "broadchurch.io/runner"

# task_timeout duration regex (matches validator's RE_DURATION).
_DURATION = re.compile(r"^([1-9][0-9]*)(s|m|h)$")
_DURATION_MULT = {"s": 1, "m": 60, "h": 3600}


def _duration_to_seconds(duration: str) -> int:
    """`'300s'` -> 300, `'30m'` -> 1800, `'12h'` -> 43200. Validator
    guarantees the format, so this only fails if called with a manifest
    that bypassed validation."""
    m = _DURATION.match(duration)
    if not m:
        raise ValueError(f"invalid duration {duration!r} (expected `Ns`/`Nm`/`Nh`)")
    return int(m.group(1)) * _DURATION_MULT[m.group(2)]


def _short_id(execution_id: str) -> str:
    """Take the first 8 chars of a UUID-shaped execution ID. Used in
    Job metadata.name; keeps the name human-recognizable while staying
    unique enough across an operator's working set of recent runs."""
    return execution_id.replace("-", "")[:8]


def _build_env(
    env: dict[str, str],
    secret_ref_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Convert the normalized env dict into K8s `env: []` entries.

    Returns `(env_entries, secret_refs)` where:
      - `env_entries` is the list to plant in container.spec.env
      - `secret_refs` is the JSON-serializable list of secret tuples
        the workflow needs to fetch + materialize. Sorted by env name
        for deterministic output.
    """
    env_entries: list[dict[str, Any]] = []
    secret_refs: list[dict[str, Any]] = []
    for var_name in sorted(env.keys()):
        value = env[var_name]
        m = RE_SECRET_REF.match(value) if isinstance(value, str) else None
        if m:
            secret_refs.append({
                "env_var": var_name,
                "name": m.group("name"),
                "version": m.group("version"),
                "optional": m.group("optional") is not None,
            })
            entry: dict[str, Any] = {
                "name": var_name,
                "valueFrom": {
                    "secretKeyRef": {
                        "name": secret_ref_name,
                        "key": var_name,
                    },
                },
            }
            if m.group("optional"):
                # Allow missing optional secrets to leave the env var
                # unset rather than failing pod start.
                entry["valueFrom"]["secretKeyRef"]["optional"] = True
            env_entries.append(entry)
        else:
            env_entries.append({"name": var_name, "value": str(value)})
    return env_entries, secret_refs


def _build_resources(cpu: str, memory: str) -> dict[str, dict[str, str]]:
    """K8s requests + limits. Requests set what the scheduler reserves;
    limits match requests so we don't get throttled or OOM-killed at
    the boundary."""
    return {
        "requests": {"cpu": cpu, "memory": memory},
        "limits": {"cpu": cpu, "memory": memory},
    }


def _build_pod_spec(
    *,
    manifest: dict[str, Any],
    image: str,
    secret_ref_name: str,
    base_labels: dict[str, str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build the `template.spec` body shared by both Job and CronJob."""
    env_entries, secret_refs = _build_env(manifest["env"], secret_ref_name)

    container: dict[str, Any] = {
        "name": "job",
        "image": image,
        # Always: the deploy-job workflow rebuilds and pushes a fresh
        # image on every dispatch, but historically tagged with a
        # mutable `:latest`-equivalent (`gcr.io/<project>/job-<name>`
        # with no tag). Kubelet's default IfNotPresent treats that as
        # cacheable, so updated builds were silently masked by stale
        # node-local images. Always forces a pull on every Pod start
        # — small startup cost, guaranteed-correct semantics. Once
        # images are SHA-tagged (ENG-705 follow-up), this can revert.
        "imagePullPolicy": "Always",
        "resources": _build_resources(manifest["cpu"], manifest["memory"]),
    }
    if env_entries:
        container["env"] = env_entries

    pod_spec: dict[str, Any] = {
        "restartPolicy": "Never",
        # KSA name MUST match the one the gcp-bctenant `tenant-jobs` Helm
        # chart creates (see `charts/tenant-jobs/templates/serviceaccount.yaml`
        # in gcp-bctenant; the chart's default `ksaName: tenant-jobs` is
        # passed through unchanged by every BC 2.0 tenant). The KSA is
        # Workload-Identity-bound to the per-tenant `bc-tenant-jobs@`
        # runtime GSA - that's the identity Pods authenticate to GCP as
        # for Cloud SQL IAM auth, Secret Manager, GCS, etc. Using any
        # other name fails Pod creation with `serviceaccount "X" not found`
        # because the chart never created it. See ENG-700.
        "serviceAccountName": "tenant-jobs",
        "containers": [container],
    }

    template: dict[str, Any] = {
        "metadata": {"labels": dict(base_labels)},
        "spec": pod_spec,
    }
    return template, secret_refs


def _build_job_spec(
    *,
    manifest: dict[str, Any],
    image: str,
    secret_ref_name: str,
    base_labels: dict[str, str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build a `Job.spec` body (also reused inside `CronJob.spec.jobTemplate.spec`)."""
    template, secret_refs = _build_pod_spec(
        manifest=manifest,
        image=image,
        secret_ref_name=secret_ref_name,
        base_labels=base_labels,
    )
    return {
        "backoffLimit": manifest["max_retries"],
        "parallelism": manifest["parallelism"],
        "completions": manifest["task_count"],
        "activeDeadlineSeconds": _duration_to_seconds(manifest["task_timeout"]),
        # ttlSecondsAfterFinished cleans up completed Jobs after 24h so
        # the namespace doesn't accumulate finished Job objects. Logs
        # are tailed in the workflow before this kicks in.
        "ttlSecondsAfterFinished": 86400,
        "template": template,
    }, secret_refs


def render(
    *,
    manifest: dict[str, Any],
    image: str,
    namespace: str,
    execution_id: str,
    org_id: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Returns `(top_level_manifest, secret_refs)`."""

    if manifest.get("provisioning_model") == "spot":
        # v0 limitation. Surface here (rather than only in the workflow
        # step) so a misconfigured manifest fails the renderer's tests
        # too. ENG-563 tracks landing the spot nodepool + flipping
        # this to render a Spot toleration instead.
        raise _DispatchError(
            "provisioning_model: spot requires a spot nodepool, which "
            "isn't present on per-tenant GKE clusters yet. Track Linear "
            "ENG-563 (https://linear.app/lovelace-tech/issue/ENG-563), "
            "or set provisioning_model: standard for now."
        )

    job_name = manifest["name"]
    short = _short_id(execution_id)
    secret_ref_name = f"job-{job_name}-secrets"

    base_labels: dict[str, str] = {
        STABLE_JOB_LABEL: job_name,
        EXECUTION_ID_LABEL: execution_id,
        MANAGED_BY_LABEL: "broadchurch",
        RUNNER_LABEL: "k8s-job",
    }
    if org_id:
        base_labels[ORG_ID_LABEL] = org_id

    job_spec, secret_refs = _build_job_spec(
        manifest=manifest,
        image=image,
        secret_ref_name=secret_ref_name,
        base_labels=base_labels,
    )

    if manifest.get("schedule"):
        # CronJobs use a stable name so re-deploys patch the schedule
        # in place; the jobTemplate's pods get an exec-id label at
        # cron-fire time via templating below. But because cron-fired
        # Jobs are created by the controller (not us), we can't inject
        # a per-run UUID at render time — the per-run correlation
        # label for cron-spawned runs is the controller-generated Job
        # name suffix instead. We omit `compute-job-id` from the cron
        # template's labels so each fired Job/Pod doesn't carry the
        # render-time UUID forever.
        cron_template_labels = {
            k: v for k, v in base_labels.items() if k != EXECUTION_ID_LABEL
        }
        # Re-render the job_spec under the cron template labels so the
        # selector matches when the controller spawns runs.
        job_template_spec, secret_refs = _build_job_spec(
            manifest=manifest,
            image=image,
            secret_ref_name=secret_ref_name,
            base_labels=cron_template_labels,
        )
        top: dict[str, Any] = {
            "apiVersion": "batch/v1",
            "kind": "CronJob",
            "metadata": {
                "name": f"bc-job-{job_name}",
                "namespace": namespace,
                "labels": cron_template_labels,
            },
            "spec": {
                "schedule": manifest["schedule"],
                "timeZone": manifest["schedule_timezone"],
                "concurrencyPolicy": "Forbid",
                "successfulJobsHistoryLimit": 3,
                "failedJobsHistoryLimit": 3,
                "jobTemplate": {
                    "metadata": {"labels": cron_template_labels},
                    "spec": job_template_spec,
                },
            },
        }
        return top, secret_refs

    top = {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": f"bc-job-{job_name}-{short}",
            "namespace": namespace,
            "labels": dict(base_labels),
        },
        "spec": job_spec,
    }
    return top, secret_refs


class _DispatchError(Exception):
    """Raised when a manifest is structurally valid but the dispatcher
    can't render it on the current substrate (e.g. spot nodepool
    absence in v0)."""


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Render job.yaml → K8s Job / CronJob manifest.",
    )
    p.add_argument(
        "--manifest",
        help="Path to the normalized JSON manifest from validate-job-manifest.py. "
        "If omitted, reads from stdin.",
    )
    p.add_argument("--image", required=True, help="Container image (incl. tag).")
    p.add_argument(
        "--namespace",
        default="tenant-jobs",
        help="K8s namespace (default: tenant-jobs).",
    )
    p.add_argument(
        "--execution-id",
        required=True,
        help="Per-run UUID (used for the compute-job-id label and Job name suffix).",
    )
    p.add_argument(
        "--org-id",
        default=None,
        help="Tenant org_id. Plumbed as the broadchurch.io/org-id label "
        "for cross-cluster correlation.",
    )
    p.add_argument(
        "--print-secret-refs",
        action="store_true",
        help="Emit secret refs as JSON to stderr (one line). Used by the "
        "workflow's secret-resolver step.",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()

    try:
        if args.manifest:
            with open(args.manifest, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        else:
            manifest = json.load(sys.stdin)
    except (OSError, json.JSONDecodeError) as e:
        print(f"::error::failed to read normalized manifest: {e}", file=sys.stderr)
        return 1

    try:
        top, secret_refs = render(
            manifest=manifest,
            image=args.image,
            namespace=args.namespace,
            execution_id=args.execution_id,
            org_id=args.org_id,
        )
    except _DispatchError as e:
        print(f"::error::{e}", file=sys.stderr)
        return 2
    except (KeyError, ValueError) as e:
        # Malformed manifest (missing required field, bad duration, etc).
        # Validator should have caught these; treat as exit-1 contract bug.
        print(f"::error::renderer failed: {e}", file=sys.stderr)
        return 1

    yaml.dump(
        top,
        sys.stdout,
        Dumper=_NoAliasDumper,
        default_flow_style=False,
        sort_keys=False,
    )

    if args.print_secret_refs:
        # Single line of JSON so the workflow can parse with `read -r`.
        sys.stderr.write(json.dumps(secret_refs) + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
