"""
Example Compute Job — minimal K8s Job entrypoint for BC 2.0.

Per ADR-019, compute jobs run as Kubernetes Jobs on the per-tenant GKE
cluster. The deploy workflow (`/deploy_job <name>` → Portal → tenant
repo's `.github/workflows/deploy-job.yml`) builds the image, renders a
Job (or CronJob, when `job.yaml` sets `schedule:`) manifest, and
applies it through Connect Gateway.

This is a starting point. The body below shows the four canonical BC
2.0 patterns — replace whatever you don't need.

Triggers:
- Cron schedule via K8s CronJob (when `job.yaml` sets `schedule:`)
- Ad-hoc via the Portal "Run now" button
- From your Vercel app via the Portal Jobs API
- From an Agent Engine tool call
- As a step in a Cloud Workflows DAG (`workflows/example_workflow/`)

Auth:
- Pod identity via K8s Workload Identity → `bc-tenant-jobs@…iam.gserviceaccount.com`
  GCP service account in the per-tenant project
- This SA has the IAM bindings to call Cloud SQL with IAM-auth, write
  to per-tenant BigQuery, read Secret Manager, etc.
- No local credentials, no service-account-key JSON files in the image

Platform-injected env (deploy workflow handles this — see
`skills/aether/compute.md`):
- `ORG_ID`, `GATEWAY_URL`, `QUERY_SERVER_URL`, `GOOGLE_CLOUD_PROJECT`
- `INSTANCE_CONNECTION_NAME`, `DB_USER`, `DB_NAME` (when the tenant
  has Cloud SQL enabled)

Local testing (no GCP auth, dry run):
    cd jobs/example_job
    pip install -r requirements.txt
    python main.py --shard 0 --total-shards 1
"""

import argparse
import logging
import os
import sys
from pathlib import Path

import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("example_job")


def load_config() -> dict:
    """Load broadchurch.yaml from the working dir or job directory.

    The deploy workflow copies the repo's `broadchurch.yaml` into the
    job directory at image build time so the pod can read it without
    a Portal round-trip.
    """
    for candidate in [
        Path("broadchurch.yaml"),
        Path(__file__).parent / "broadchurch.yaml",
    ]:
        if candidate.exists():
            return yaml.safe_load(candidate.read_text()) or {}
    log.warning("broadchurch.yaml not found — running with environment-only config")
    return {}


def parse_args() -> argparse.Namespace:
    """K8s Indexed Jobs expose JOB_COMPLETION_INDEX as the per-task
    shard ID (0-based, < parallelism). For non-indexed Jobs there is
    no per-task index — every task sees the same env.

    K8s `Job.spec.completionMode: Indexed` is a known gap for the
    render pipeline (tracked in ENG-697); until it lands, parallel
    fan-out within a single Job won't have per-task IDs. The CLI flag
    here gives local testing the same shape and lets the job degrade
    gracefully to a single-shard run when JOB_COMPLETION_INDEX isn't
    set (the parallelism==1 case).
    """
    parser = argparse.ArgumentParser(description="Example compute job")
    parser.add_argument(
        "--shard",
        type=int,
        default=int(os.environ.get("JOB_COMPLETION_INDEX", "0")),
        help="This task's shard index (0-based). Defaults to JOB_COMPLETION_INDEX.",
    )
    parser.add_argument(
        "--total-shards",
        type=int,
        default=int(os.environ.get("BC_TOTAL_SHARDS", "1")),
        help="Total parallel shards. Defaults to env BC_TOTAL_SHARDS (set this in job.yaml if needed).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config()

    org_id = os.environ.get("ORG_ID", config.get("tenant", {}).get("org_id", "<unknown>"))
    log.info(
        "Starting example_job (shard=%d/%d, org_id=%s)",
        args.shard,
        args.total_shards,
        org_id,
    )

    # --- Customize below this line ---
    #
    # The canonical BC 2.0 compute pattern: read from APIs / MCP /
    # Cloud SQL, do work, write results to Cloud SQL (transactional)
    # or BigQuery (analytical / append-only).
    #
    # 1. ETL/enrichment loop over entities from the yottagraph:
    #
    #     from broadchurch_auth import elemental_client
    #     resp = elemental_client.post(
    #         "/elemental/find",
    #         data={"expression": '{"type":"is_type","is_type":{"fid":10}}', "limit": "10000"},
    #     )
    #     eids = resp.json().get("eids", [])
    #     rows = [enrich(eid) for eid in eids[args.shard::args.total_shards]]
    #     write_to_cloud_sql(rows)
    #
    # 2. Cloud SQL writes via the IAM-auth Python Connector (Postgres).
    #    The platform injects INSTANCE_CONNECTION_NAME, DB_USER, and
    #    DB_NAME when the tenant has Cloud SQL enabled (ENG-695). The
    #    pod's K8s service account is bound to the tenant runtime GSA
    #    via Workload Identity, so no password is needed — the
    #    connector exchanges the GSA identity for a one-time DB token.
    #
    #     from google.cloud.sql.connector import Connector, IPTypes
    #
    #     conn_name = os.environ["INSTANCE_CONNECTION_NAME"]
    #     db_user   = os.environ["DB_USER"]
    #     db_name   = os.environ.get("DB_NAME", "bctenant")
    #     connector = Connector()
    #     try:
    #         conn = connector.connect(
    #             conn_name,
    #             "pg8000",
    #             user=db_user,
    #             db=db_name,
    #             enable_iam_auth=True,
    #             ip_type=IPTypes.PUBLIC,
    #         )
    #         try:
    #             # NOTE: pg8000's Cursor doesn't implement
    #             # __enter__/__exit__, so DO NOT use
    #             # `with conn.cursor() as cur:` — it raises
    #             # "Cursor object does not support the context
    #             # manager protocol" at runtime. Use the explicit
    #             # try/finally + cur.close() pattern below.
    #             cur = conn.cursor()
    #             try:
    #                 cur.execute(
    #                     "INSERT INTO daily_summary (date, total_count) "
    #                     "SELECT CURRENT_DATE, COUNT(*) FROM events "
    #                     "WHERE created_at::date = CURRENT_DATE "
    #                     "ON CONFLICT (date) DO UPDATE "
    #                     "SET total_count = excluded.total_count"
    #                 )
    #                 conn.commit()
    #             finally:
    #                 cur.close()
    #         finally:
    #             conn.close()
    #     finally:
    #         connector.close()
    #
    # 3. BigQuery append-only writes (preferred for analytical result
    #    sets — append-only, columnar scans, no row-level conflicts).
    #    Auto-injection of BIGQUERY_DATASET is pending follow-up under
    #    ENG-695; until then set it explicitly in job.yaml `env:`.
    #
    #     from google.cloud import bigquery
    #     bq = bigquery.Client()
    #     dataset = os.environ.get("BIGQUERY_DATASET")
    #     if not dataset:
    #         raise RuntimeError(
    #             "BIGQUERY_DATASET not set; add it to job.yaml `env:` "
    #             "(e.g. BIGQUERY_DATASET: 'bc-<slug>.bctenant_analytics')"
    #         )
    #     table = f"{dataset}.daily_summary"
    #     rows = [{"date": today_iso(), "count": 42, "shard": args.shard}]
    #     errors = bq.insert_rows_json(table, rows)
    #     if errors:
    #         raise RuntimeError(f"BQ insert failed: {errors}")
    #
    # 4. Workflow step (called from workflows/<name>/workflow.yaml):
    #
    #     import json
    #     payload = json.loads(os.environ.get("WORKFLOW_INPUT", "{}"))
    #     result = do_work(payload)
    #     print(json.dumps(result))
    #
    # See `skills/aether/compute.md` for the full decision rubric on
    # Cloud SQL vs BigQuery, secret refs, sharding, scheduling, and
    # local testing tips.
    #
    log.info("This is the example job. Customize main.py for your workload.")
    log.info("Job complete (shard=%d/%d)", args.shard, args.total_shards)

    return 0


if __name__ == "__main__":
    sys.exit(main())
