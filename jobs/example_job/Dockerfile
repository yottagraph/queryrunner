# Compute Job container — built by `deploy-job.yml` and run as a K8s
# Job pod on the per-tenant GKE cluster (per ADR-019).
#
# `deploy-job.yml` auto-generates a Dockerfile matching this template
# if you don't ship one; only override here if your job needs system
# packages, a custom base image, or a non-standard entrypoint.
FROM python:3.12-slim

WORKDIR /app

# System deps that data-processing libs often want.  `libpq5` is for
# psycopg (still useful if you go non-Connector); `ca-certificates` +
# `curl` cover the TLS / gcloud-side fetches the Python Connector does
# during the IAM-auth handshake.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# K8s Job's container invokes CMD on Pod start; no port binding.
CMD ["python", "main.py"]
