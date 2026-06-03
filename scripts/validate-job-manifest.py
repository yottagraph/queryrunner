#!/usr/bin/env python3
"""
job.yaml schema validator (ENG-546 / PR-A1).

Lightweight, dependency-free (beyond stdlib + pyyaml) validator that
reads a tenant's `jobs/<name>/job.yaml`, fails loudly with line-pointing
errors when the manifest is malformed, and prints a normalized JSON
document to stdout on success.

Run as:

    python3 scripts/validate-job-manifest.py jobs/example_job/job.yaml

Exit codes:
    0   manifest valid; normalized JSON on stdout
    1   manifest invalid; errors on stderr

The normalized JSON output is the contract `deploy-job.yml` consumes:
defaulted fields are present with their default values, so downstream
jq invocations don't have to repeat the `// "..."` fallbacks.

--- Why pure Python ---

The validator runs inside `deploy-job.yml`, which already pre-installs
nothing beyond `gcloud` + `yq`. `python3` and `python3-yaml` are baked
into `ubuntu-latest` runners; adding a Node-side validator would force
`setup-node` + a fresh `npm install` (~10-20s) on every deploy. A
hand-rolled Python check stays small, fast, and offline.

--- Why hand-rolled instead of jsonschema ---

`jsonschema` would be a single `pip install` away, but the same
single-file constraint applies: we want this script to be runnable
straight out of `actions/checkout` with zero `pip install` step.
The schema is small enough that the wins from a real schema library
don't pay for that overhead.

--- Schema reference ---

See `docs/COMPUTE_JOBS.md` (broadchurch repo) for the user-facing
schema doc. This script is the canonical enforcer.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

import yaml

# --- Schema constants -------------------------------------------------------

# Per ADR-019 (Consolidate Compute on Kubernetes Jobs — Remove Cloud
# Run Jobs Runner), Kubernetes Jobs are the sole supported runner. The
# `runner` field stays in the schema (optional, defaults to `k8s_job`)
# for forward extensibility — if a third runner ever needs to be added
# (e.g. `argo_workflow`, `knative`), the schema doesn't have to change
# shape. But the only currently-accepted value is `k8s_job`.
VALID_RUNNERS = ("k8s_job",)
VALID_PROVISIONING_MODELS = ("standard", "spot")
VALID_ON_NONZERO_EXIT = ("fail", "warn")

# Old runner value names with their replacements, used to produce a
# helpful did-you-mean message instead of a bare enum-rejection error.
#   - `batch` → `k8s_job` (Phase A pivot 2026-05-23: moved from GCP
#     Batch to per-tenant GKE Jobs).
#   - `cloud_run` → `k8s_job` (ADR-019, 2026-05-27: Cloud Run Jobs
#     runner removed; everything moves to K8s Jobs for cross-cloud
#     portability and a single dispatch surface).
RUNNER_DEPRECATIONS: dict[str, tuple[str, str]] = {
    "batch": (
        "k8s_job",
        "the `batch` runner was renamed to `k8s_job` (Phase A substrate moved "
        "from GCP Batch to per-tenant GKE Jobs)",
    ),
    "cloud_run": (
        "k8s_job",
        "the `cloud_run` runner was removed per ADR-019 (Consolidate Compute "
        "on Kubernetes Jobs). Kubernetes Jobs on the per-tenant GKE cluster "
        "is now the sole runner. See "
        "https://github.com/Lovelace-AI/broadchurch/blob/main/docs/DECISIONS.md "
        "for the ADR and migration notes",
    ),
}

# `name` is the Cloud Run Job / K8s Job stable name. Lowercase letters
# / digits / hyphens, must start with a letter, no consecutive hyphens,
# max 49 chars (Cloud Run cap — K8s Jobs cap at 52 so the same constraint
# fits both runners).
RE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,47}[a-z0-9]$|^[a-z]$")

# `cpu`: a numeric vCPU count as a string. Cloud Run accepts integer
# vCPU; K8s Jobs accept fractional / millicores (we let the dispatcher
# convert). Allow whole numbers and decimals up to one place.
RE_CPU = re.compile(r"^[0-9]+(\.[0-9])?$")

# `memory`: gibibytes or mebibytes. e.g. "512Mi", "1Gi", "64Gi".
RE_MEMORY = re.compile(r"^[1-9][0-9]*(Mi|Gi)$")

# `task_timeout`: simple duration with a single unit suffix. e.g.
# "300s", "30m", "1h", "12h". Compound durations like "1h30m" are
# intentionally not supported (Cloud Run + K8s Jobs both prefer a single
# unit; pick the largest unit that fits cleanly).
RE_DURATION = re.compile(r"^[1-9][0-9]*(s|m|h)$")

# `schedule`: five-field cron (minute hour day month weekday). We
# don't parse cron expression semantics here — Cloud Scheduler will
# do that on its end. We only check shape so typos like "every 5
# minutes" fail at deploy time instead of silently rejecting later.
RE_CRON = re.compile(r"^\S+\s+\S+\s+\S+\s+\S+\s+\S+$")

# `${secret://name/version}` and `${secret://name/version?}` (optional).
# Secret names are GCP Secret Manager names — alphanum + dash +
# underscore, 1-255 chars. Version is either a number or "latest".
RE_SECRET_REF = re.compile(
    r"^\$\{secret://"
    r"(?P<name>[A-Za-z0-9_-]{1,255})"
    r"/(?P<version>[1-9][0-9]*|latest)"
    r"(?P<optional>\?)?"
    r"\}$"
)

# Free-form GCS URI used in notify.artifacts[].gcs. May reference
# Cloud Run / Batch substitution vars like {exec_id} in the path;
# we don't parse those, just ensure the bucket prefix is sane.
RE_GCS_URI = re.compile(r"^gs://[a-z0-9][a-z0-9._-]{1,221}[a-z0-9](/.+)?$")

# Top-level keys we know about. Anything else is a typo and we reject.
KNOWN_TOP_LEVEL_KEYS = {
    "name",
    "runner",
    "cpu",
    "memory",
    "max_retries",
    "task_timeout",
    "parallelism",
    "task_count",
    "provisioning_model",
    "schedule",
    "schedule_timezone",
    "env",
    "notify",
    "post_steps",
}

KNOWN_NOTIFY_KEYS = {"on_failure", "on_success", "artifacts", "signed_url_ttl"}
KNOWN_NOTIFY_TARGET_KEYS = {"slack", "email", "block_kit"}
KNOWN_ARTIFACT_KEYS = {"path", "gcs", "slack_link"}
KNOWN_POST_STEP_KEYS = {"script", "on_nonzero_exit"}


# --- Default values ---------------------------------------------------------

DEFAULTS: dict[str, Any] = {
    # Default per ADR-019: K8s Jobs on per-tenant GKE is the sole
    # runner; absence in `job.yaml` coerces to `k8s_job`.
    "runner": "k8s_job",
    "cpu": "1",
    "memory": "1Gi",
    "max_retries": 1,
    "task_timeout": "1h",
    "parallelism": 1,
    "task_count": 1,
    "provisioning_model": "standard",
    "schedule": "",
    "schedule_timezone": "UTC",
    "env": {},
    "notify": None,
    "post_steps": [],
}


# --- Error accumulator ------------------------------------------------------


class ValidationErrors:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def add(self, path: str, msg: str) -> None:
        self.errors.append(f"{path}: {msg}")

    def __bool__(self) -> bool:
        return bool(self.errors)

    def print(self, file=sys.stderr) -> None:
        for e in self.errors:
            print(f"::error::{e}", file=file)


# --- Field-level validators -------------------------------------------------


def _check_string(errs: ValidationErrors, path: str, value: Any) -> bool:
    if not isinstance(value, str):
        errs.add(path, f"expected string, got {type(value).__name__}")
        return False
    return True


def _check_int(
    errs: ValidationErrors,
    path: str,
    value: Any,
    *,
    min_value: int | None = None,
    max_value: int | None = None,
) -> bool:
    # yaml parses `5` as int and `"5"` as str; for the substrate, we
    # treat both as valid (Cloud Run / K8s Jobs both accept either) and
    # coerce at normalization time.
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        errs.add(path, f"expected integer, got {type(value).__name__}")
        return False
    try:
        n = int(value)
    except (TypeError, ValueError):
        errs.add(path, f"expected integer, got {value!r}")
        return False
    if min_value is not None and n < min_value:
        errs.add(path, f"must be >= {min_value}, got {n}")
        return False
    if max_value is not None and n > max_value:
        errs.add(path, f"must be <= {max_value}, got {n}")
        return False
    return True


def _check_enum(
    errs: ValidationErrors, path: str, value: Any, allowed: tuple[str, ...]
) -> bool:
    if not _check_string(errs, path, value):
        return False
    if value not in allowed:
        errs.add(path, f"must be one of {list(allowed)}, got {value!r}")
        return False
    return True


def _check_unknown_keys(
    errs: ValidationErrors,
    path: str,
    value: dict[str, Any],
    allowed: set[str],
) -> None:
    for k in value:
        if k not in allowed:
            errs.add(f"{path}.{k}", f"unknown field (allowed: {sorted(allowed)})")


def _validate_env_value(errs: ValidationErrors, path: str, value: Any) -> None:
    """
    Env values are always strings post-deploy (Cloud Run + K8s Jobs both
    coerce to string). YAML parses unquoted `true`/`false`/`42` to
    bool/int — we tolerate those and coerce. The only structural check
    that matters is the `${secret://...}` reference syntax: if it
    LOOKS like a secret ref (starts with `${`), it MUST match the
    full pattern, otherwise we flag the typo here instead of having
    the secret-resolver layer mishandle a half-formed `${secret://}`.
    """
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str) and value.startswith("${"):
            if not RE_SECRET_REF.match(value):
                errs.add(
                    path,
                    f"looks like a secret/var reference but doesn't match "
                    f"`${{secret://NAME/VERSION}}` or `${{secret://NAME/VERSION?}}`: "
                    f"{value!r}",
                )
        return
    errs.add(path, f"env values must be scalars, got {type(value).__name__}")


def _validate_notify_target(
    errs: ValidationErrors, path: str, value: Any
) -> None:
    if not isinstance(value, dict):
        errs.add(path, f"expected object, got {type(value).__name__}")
        return
    _check_unknown_keys(errs, path, value, KNOWN_NOTIFY_TARGET_KEYS)
    if "slack" in value:
        slack = value["slack"]
        if not isinstance(slack, str) or not slack.strip():
            errs.add(f"{path}.slack", "expected non-empty Slack channel string")
    if "email" in value:
        email = value["email"]
        if not isinstance(email, str) or "@" not in email:
            errs.add(f"{path}.email", f"expected email address, got {email!r}")
    if "block_kit" in value and not isinstance(value["block_kit"], (dict, list)):
        errs.add(
            f"{path}.block_kit",
            "expected Block Kit JSON (object or array of blocks)",
        )
    if not any(k in value for k in ("slack", "email")):
        errs.add(path, "must specify at least one of `slack` or `email`")


def _validate_artifact(errs: ValidationErrors, path: str, value: Any) -> None:
    if not isinstance(value, dict):
        errs.add(path, f"expected object, got {type(value).__name__}")
        return
    _check_unknown_keys(errs, path, value, KNOWN_ARTIFACT_KEYS)
    has_path = "path" in value
    has_gcs = "gcs" in value
    if has_path and has_gcs:
        errs.add(path, "specify exactly one of `path` or `gcs`, not both")
        return
    if not has_path and not has_gcs:
        errs.add(path, "must specify either `path` (task-local file) or `gcs` URI")
        return
    if has_path:
        p = value["path"]
        if not isinstance(p, str) or not p.startswith("/"):
            errs.add(f"{path}.path", f"expected absolute container path, got {p!r}")
    if has_gcs:
        g = value["gcs"]
        if not isinstance(g, str) or not RE_GCS_URI.match(g):
            errs.add(
                f"{path}.gcs",
                f"expected `gs://bucket/path...` URI, got {g!r}",
            )
    if "slack_link" in value:
        link = value["slack_link"]
        if not isinstance(link, str) or not link.strip():
            errs.add(f"{path}.slack_link", "expected non-empty label string")


def _validate_notify(errs: ValidationErrors, value: Any) -> None:
    if not isinstance(value, dict):
        errs.add("notify", f"expected object, got {type(value).__name__}")
        return
    _check_unknown_keys(errs, "notify", value, KNOWN_NOTIFY_KEYS)
    if not any(k in value for k in ("on_failure", "on_success")):
        errs.add(
            "notify",
            "must specify at least one of `on_failure` or `on_success` "
            "(an empty notify block has no effect)",
        )
    if "on_failure" in value:
        _validate_notify_target(errs, "notify.on_failure", value["on_failure"])
    if "on_success" in value:
        _validate_notify_target(errs, "notify.on_success", value["on_success"])
    if "artifacts" in value:
        if not isinstance(value["artifacts"], list):
            errs.add("notify.artifacts", "expected array")
        else:
            for i, art in enumerate(value["artifacts"]):
                _validate_artifact(errs, f"notify.artifacts[{i}]", art)
    if "signed_url_ttl" in value:
        ttl = value["signed_url_ttl"]
        if not isinstance(ttl, str) or not RE_DURATION.match(ttl):
            errs.add(
                "notify.signed_url_ttl",
                f"expected duration like `1h`, `24h`, `7d` won't work — "
                f"use hours, got {ttl!r}",
            )


def _validate_post_steps(errs: ValidationErrors, value: Any) -> None:
    if not isinstance(value, list):
        errs.add("post_steps", f"expected array, got {type(value).__name__}")
        return
    for i, step in enumerate(value):
        path = f"post_steps[{i}]"
        if not isinstance(step, dict):
            errs.add(path, f"expected object, got {type(step).__name__}")
            continue
        _check_unknown_keys(errs, path, step, KNOWN_POST_STEP_KEYS)
        if "script" not in step:
            errs.add(path, "missing required field `script`")
        else:
            _check_string(errs, f"{path}.script", step["script"])
        if "on_nonzero_exit" in step:
            _check_enum(
                errs, f"{path}.on_nonzero_exit", step["on_nonzero_exit"],
                VALID_ON_NONZERO_EXIT,
            )


# --- Top-level validator + normalizer ---------------------------------------


def validate(raw: Any, default_name: str) -> tuple[dict[str, Any], ValidationErrors]:
    """
    Return (normalized_manifest, errors). The normalized dict is only
    meaningful when `errors` is empty.
    """
    errs = ValidationErrors()

    if raw is None:
        # Empty job.yaml — treat as `{name: <dir>}`.
        raw = {}

    if not isinstance(raw, dict):
        errs.add("<root>", f"expected mapping, got {type(raw).__name__}")
        return {}, errs

    _check_unknown_keys(errs, "<root>", raw, KNOWN_TOP_LEVEL_KEYS)

    # name (required-ish — defaults to the directory name)
    name = raw.get("name", default_name)
    if not isinstance(name, str):
        errs.add("name", f"expected string, got {type(name).__name__}")
        name = default_name
    # Cloud Run + our convention: underscores get translated to hyphens
    # at deploy time. We normalize here too so the validator's regex
    # is the actually-deployed name.
    name = name.replace("_", "-").lower()
    if not RE_NAME.match(name):
        errs.add(
            "name",
            f"must be lowercase letters/digits/hyphens, start with a "
            f"letter, max 49 chars; normalized name {name!r} failed",
        )

    # runner — special-cases renamed values (e.g. the pre-pivot `batch`)
    # with a migration hint so tenant authors don't have to grep release
    # notes to figure out what changed.
    runner = raw.get("runner", DEFAULTS["runner"])
    if not isinstance(runner, str):
        errs.add("runner", f"expected string, got {type(runner).__name__}")
    elif runner in RUNNER_DEPRECATIONS:
        new_value, hint = RUNNER_DEPRECATIONS[runner]
        errs.add(
            "runner",
            f"{hint}; change `runner: {runner}` to `runner: {new_value}`",
        )
    elif runner not in VALID_RUNNERS:
        errs.add(
            "runner",
            f"must be one of {list(VALID_RUNNERS)}, got {runner!r}",
        )

    # cpu
    cpu = raw.get("cpu", DEFAULTS["cpu"])
    if isinstance(cpu, (int, float)):
        cpu = str(cpu)
    if _check_string(errs, "cpu", cpu):
        if not RE_CPU.match(cpu):
            errs.add(
                "cpu",
                f"must be a number-as-string like `'1'`, `'2'`, `'16'`, got {cpu!r}",
            )

    # memory
    memory = raw.get("memory", DEFAULTS["memory"])
    if _check_string(errs, "memory", memory):
        if not RE_MEMORY.match(memory):
            errs.add(
                "memory",
                f"must be like `'512Mi'`, `'1Gi'`, `'64Gi'`, got {memory!r}",
            )

    # ints
    max_retries = raw.get("max_retries", DEFAULTS["max_retries"])
    if not _check_int(errs, "max_retries", max_retries, min_value=0, max_value=10):
        max_retries = DEFAULTS["max_retries"]
    else:
        max_retries = int(max_retries)

    parallelism = raw.get("parallelism", DEFAULTS["parallelism"])
    if not _check_int(errs, "parallelism", parallelism, min_value=1):
        parallelism = DEFAULTS["parallelism"]
    else:
        parallelism = int(parallelism)

    task_count = raw.get("task_count", DEFAULTS["task_count"])
    if not _check_int(errs, "task_count", task_count, min_value=1):
        task_count = DEFAULTS["task_count"]
    else:
        task_count = int(task_count)

    # task_timeout
    task_timeout = raw.get("task_timeout", DEFAULTS["task_timeout"])
    if _check_string(errs, "task_timeout", task_timeout):
        if not RE_DURATION.match(task_timeout):
            errs.add(
                "task_timeout",
                f"must be a single-unit duration like `300s`, `30m`, "
                f"`1h`, `12h`, got {task_timeout!r}",
            )

    # provisioning_model — k8s_job-only feature that selects a spot
    # nodepool. Pre-ADR-019 this section also gated `cloud_run` (which
    # never had a spot tier); now that `cloud_run` is rejected
    # upstream in the RUNNER_DEPRECATIONS branch, the runner-specific
    # gate is moot and a plain enum check is enough. The dispatcher
    # still rejects `provisioning_model: spot` at K8s render time
    # because per-tenant clusters don't have a spot nodepool today
    # (tracked in ENG-563).
    provisioning_model = raw.get("provisioning_model", DEFAULTS["provisioning_model"])
    _check_enum(errs, "provisioning_model", provisioning_model, VALID_PROVISIONING_MODELS)

    # schedule
    schedule = raw.get("schedule", DEFAULTS["schedule"])
    if schedule:
        if not isinstance(schedule, str):
            errs.add("schedule", f"expected cron expression, got {type(schedule).__name__}")
        elif not RE_CRON.match(schedule):
            errs.add(
                "schedule",
                f"expected 5-field cron expression `'minute hour dom month dow'`, "
                f"got {schedule!r}",
            )
        # PR-A3-v2 / ENG-550 lifted the `runner: k8s_job` + `schedule:`
        # restriction: the dispatcher now renders a K8s CronJob natively
        # when both are set, so no validator-level rejection is needed.

    schedule_timezone = raw.get("schedule_timezone", DEFAULTS["schedule_timezone"])
    _check_string(errs, "schedule_timezone", schedule_timezone)

    # env
    env = raw.get("env", DEFAULTS["env"])
    normalized_env: dict[str, str] = {}
    if env is None:
        env = {}
    if not isinstance(env, dict):
        errs.add("env", f"expected mapping, got {type(env).__name__}")
        env = {}
    for k, v in env.items():
        if not isinstance(k, str):
            errs.add("env", f"env key {k!r} must be a string")
            continue
        if not re.match(r"^[A-Z_][A-Z0-9_]*$", k):
            errs.add(
                f"env.{k}",
                f"env var names must be UPPER_SNAKE_CASE (POSIX), got {k!r}",
            )
        _validate_env_value(errs, f"env.{k}", v)
        # Coerce non-string scalars to strings to match Cloud Run /
        # Batch behavior; the runtime sees env values as strings either
        # way, so the YAML author's `RETRIES: 3` shouldn't blow up.
        if isinstance(v, bool):
            normalized_env[k] = "true" if v else "false"
        elif v is None:
            normalized_env[k] = ""
        else:
            normalized_env[k] = str(v)

    # notify (optional)
    notify_raw = raw.get("notify")
    notify_normalized: dict[str, Any] | None = None
    if notify_raw is not None:
        _validate_notify(errs, notify_raw)
        if isinstance(notify_raw, dict):
            notify_normalized = dict(notify_raw)
            notify_normalized.setdefault("signed_url_ttl", "24h")
            notify_normalized.setdefault("artifacts", [])

    # post_steps (optional)
    post_steps_raw = raw.get("post_steps", [])
    post_steps_normalized: list[dict[str, Any]] = []
    if post_steps_raw:
        _validate_post_steps(errs, post_steps_raw)
        if isinstance(post_steps_raw, list):
            for step in post_steps_raw:
                if isinstance(step, dict):
                    normalized = dict(step)
                    normalized.setdefault("on_nonzero_exit", "fail")
                    post_steps_normalized.append(normalized)

    normalized = {
        "name": name,
        "runner": runner,
        "cpu": cpu if isinstance(cpu, str) else str(cpu),
        "memory": memory if isinstance(memory, str) else str(memory),
        "max_retries": max_retries,
        "task_timeout": task_timeout if isinstance(task_timeout, str) else str(task_timeout),
        "parallelism": parallelism,
        "task_count": task_count,
        "provisioning_model": provisioning_model,
        "schedule": schedule if isinstance(schedule, str) else "",
        "schedule_timezone": schedule_timezone if isinstance(schedule_timezone, str) else "UTC",
        "env": normalized_env,
        "notify": notify_normalized,
        "post_steps": post_steps_normalized,
    }
    return normalized, errs


# --- CLI entry point --------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: validate-job-manifest.py <path/to/job.yaml>",
            file=sys.stderr,
        )
        return 2

    manifest_path = argv[1]
    if not os.path.isfile(manifest_path):
        print(f"::error::manifest file not found: {manifest_path}", file=sys.stderr)
        return 1

    job_dir = os.path.basename(os.path.dirname(os.path.abspath(manifest_path)))
    default_name = job_dir.replace("_", "-").lower()

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
    except yaml.YAMLError as e:
        print(f"::error::YAML parse error in {manifest_path}: {e}", file=sys.stderr)
        return 1

    normalized, errs = validate(raw, default_name=default_name)

    if errs:
        print(
            f"::error::Job manifest validation failed for {manifest_path} "
            f"({len(errs.errors)} error(s)):",
            file=sys.stderr,
        )
        errs.print()
        return 1

    json.dump(normalized, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
