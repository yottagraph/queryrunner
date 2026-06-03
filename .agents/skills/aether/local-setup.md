## Manual / Local Setup

Node 20 is the baseline (pinned in `.nvmrc`). Newer versions generally work.

```bash
export AR_NPM_TOKEN="$(gcloud auth print-access-token)"  # @yottagraph-app/* is private (GCP Artifact Registry)
npm run init -- --local   # creates .env with dev defaults (no Auth0)
npm install               # public deps from npmjs; @yottagraph-app/* from Artifact Registry
npm run dev               # dev server on port 3000
```

> `@yottagraph-app/*` packages are served from the org's GCP Artifact Registry,
> not public npmjs. You need `roles/artifactregistry.reader` on
> `broadchurch/aether-npm` and an `AR_NPM_TOKEN` (the `export` above). See
> `broadchurch/docs/NPM_PRIVATE_REGISTRY.md`.

For the full interactive wizard (project name, Auth0, query server, etc.):

```bash
npm run init              # interactive, or --non-interactive for CI (see --help)
```
