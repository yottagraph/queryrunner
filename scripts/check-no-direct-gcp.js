#!/usr/bin/env node
/**
 * prebuild guard: refuse to build if a forbidden direct-GCP-SDK
 * dependency snuck into the tenant app's package.json.
 *
 * How a tenant app reaches GCP data services depends on where it runs,
 * and BOTH sanctioned paths are already scaffolded in `server/utils/`
 * — neither needs a `@google-cloud/*` SDK or a pasted service-account
 * key:
 *
 *   - BC 2.0 (GKE-hosted): the pod runs under Workload Identity in its
 *     own per-tenant GCP project, so `server/utils/bigquery.ts`,
 *     `server/utils/firestore.ts`, and `server/utils/db.ts` reach
 *     BigQuery / Firestore / Cloud SQL DIRECTLY — no portal hop. None of
 *     them needs a `@google-cloud/*` SDK: BigQuery uses the REST API over
 *     `fetch`, Firestore uses the already-present `firebase-admin`, and
 *     Cloud SQL goes through the in-pod Cloud SQL Auth Proxy sidecar
 *     (injected by the aether-ui Helm chart, `--auto-iam-authn`) so the
 *     app just speaks Postgres over `pg` to 127.0.0.1. Notably this keeps
 *     `@google-cloud/cloud-sql-connector` OUT — it depends on
 *     `google-auth-library`, which is forbidden below; the proxy moves
 *     that auth out of the Node process.
 *
 *   - Vercel-hosted (legacy/transitional): the function can't hold a
 *     GCP identity, so the same helpers proxy through the Broadchurch
 *     Portal gateway (BigQuery) or use the portal-injected
 *     `NUXT_FIRESTORE_SA_KEY` (Firestore prefs, ENG-520).
 *
 * The helpers pick the transport at runtime — code that imports
 * `runQuery` / `getFirestoreDb` works on both. See
 * `.agents/skills/aether/bigquery.md` and `.agents/skills/aether/pref.md`.
 *
 * The forbidden SDK packages below stay forbidden in EITHER mode: the
 * direct GKE path deliberately uses `fetch` + `firebase-admin`, so
 * `@google-cloud/bigquery`, `google-auth-library`, `gcp-metadata`, the
 * lower-level `@google-cloud/firestore`, etc. are never needed — they'd
 * only bloat the bundle and bypass the wrapper/init logic. If a coding
 * agent reflexively `npm install`s one of them (or asks the user to
 * paste a `GOOGLE_SERVICE_ACCOUNT_KEY`), this guard fails the build with
 * a pointer at the right helper instead of letting the pattern deploy.
 *
 * This script runs at the tenant project build. It is intentionally
 * cheap and side-effect-free — it just reads package.json and exits
 * non-zero on a hit.
 */
const fs = require('fs');
const path = require('path');

const PKG = path.join(process.cwd(), 'package.json');
if (!fs.existsSync(PKG)) {
    process.exit(0); // nothing to check
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

// Forbidden direct GCP SDK packages. The tenant app must always go through
// the portal gateway (`server/utils/bigquery.ts` etc.) and never hold
// credentials of its own.
const FORBIDDEN = [
    '@google-cloud/bigquery',
    '@google-cloud/bigquery-storage',
    '@google-cloud/storage',
    '@google-cloud/firestore',
    '@google-cloud/secret-manager',
    '@google-cloud/pubsub',
    'google-auth-library',
    'gcp-metadata',
];

const hits = FORBIDDEN.filter((name) => Object.hasOwn(deps, name));
if (hits.length === 0) {
    process.exit(0);
}

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

console.error('');
console.error(red(bold('✖ Forbidden GCP SDK dependency in package.json')));
console.error('');
for (const h of hits) console.error(`  - ${h}@${deps[h]}`);
console.error('');
console.error('The tenant Aether app must NEVER hold GCP credentials directly.');
console.error('Instead, go through the Broadchurch Portal gateway, which runs');
console.error("BigQuery / Storage / etc. in the tenant's GCP project on the");
console.error("app's behalf. The relevant helpers are already scaffolded:");
console.error('');
console.error(yellow('  server/utils/bigquery.ts'));
console.error('');
console.error('Required steps to fix:');
console.error(
    `  1. Remove the forbidden package(s) from package.json: ` +
        hits.map((h) => `\`${h}\``).join(', ')
);
console.error('  2. Replace any custom BigQuery client with the existing helper:');
console.error('       import { runQuery } from "~/server/utils/bigquery";');
console.error('  3. Read the skill for usage patterns: .agents/skills/aether/bigquery.md');
console.error('');
console.error('If you genuinely need a GCP capability the gateway does not yet');
console.error('cover, open an issue in broadchurch rather than installing the SDK');
console.error('here.');
console.error('');

process.exit(1);
