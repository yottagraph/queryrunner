# Manage Secrets

Add, update, or remove environment variables (secrets) for your deployed app. Secrets are stored encrypted on Vercel and are available to your app at runtime and build time.

## Overview

This command manages environment variables on your project's Vercel deployment through the Broadchurch Portal API. After any change, it automatically syncs the updated values to your local `.env` file so your dev server stays in sync with production.

**Prerequisite:** The project must have a valid `broadchurch.yaml` (created during provisioning).

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

## Step 2: List Current Environment Variables

Fetch the current user-managed environment variables:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/env-vars"
```

Parse the JSON response. The `vars` array contains `{ key, value }` objects.

Present the current state to the user:

> **Environment Variables for this project:**
>
> | Key                  | Value          |
> | -------------------- | -------------- |
> | `MY_API_KEY`         | `sk-abc...xyz` |
> | `THIRD_PARTY_SECRET` | `secret_1234`  |
>
> _(or "No environment variables set yet." if empty)_
>
> What would you like to do?
>
> 1. **Add** a new variable
> 2. **Update** an existing variable
> 3. **Remove** a variable
> 4. **Done** — nothing to change

Wait for the user to choose.

---

## Step 3: Execute the Change

### If adding or updating:

Ask the user for the key name and value. Key names must match `[A-Za-z_][A-Za-z0-9_]*`.

```bash
curl -sf -X PUT "<GATEWAY_URL>/api/projects/<ORG_ID>/env-vars" \
  -H "Content-Type: application/json" \
  -d '{"vars": {"<KEY>": "<VALUE>"}}'
```

**If the API returns 403:** The key is a platform-managed variable and cannot be modified by users.

### If removing:

Confirm which key to delete, then:

```bash
curl -sf -X DELETE "<GATEWAY_URL>/api/projects/<ORG_ID>/env-vars/<KEY>"
```

**If the API returns 404:** The variable doesn't exist.

---

## Step 4: Sync Local .env

After the API call succeeds, update the local `.env` file to match.

1. Read the current `.env` file
2. Look for a `# User secrets (managed via Broadchurch Portal)` section delimiter
3. **If the section exists:** Replace everything from that delimiter to the next blank line (or end of file) with the updated variables
4. **If the section doesn't exist:** Append it at the end of `.env`

Fetch the current full list to ensure local is in sync:

```bash
curl -sf "<GATEWAY_URL>/api/projects/<ORG_ID>/env-vars"
```

Then write the section to `.env`:

```
# User secrets (managed via Broadchurch Portal)
KEY_ONE=value_one
KEY_TWO=value_two
```

**Important:** Do not modify any other lines in `.env`. Only touch lines within the user secrets section.

---

## Step 5: Confirm and Offer Next Steps

> Updated `<KEY>`:
>
> - Vercel (production + preview) — updated
> - Local `.env` — synced
>
> **Restart your dev server** (`npm run dev`) if it's running, to pick up the change locally.

If the variable name starts with `NUXT_PUBLIC_`:

> **Note:** `NUXT_PUBLIC_*` variables are baked into the app at build time. The Vercel deployment will need a rebuild for the change to take effect in production. Push a commit or trigger a redeployment from the Portal.

If the variable name does NOT start with `NUXT_PUBLIC_`:

> This server-side variable will be available on the next request in production — no redeployment needed.

Then ask:

> Would you like to add, update, or remove another variable? (or type "done")

If yes, go back to Step 3. If done, finish.

---

## Troubleshooting

### "Project has no Vercel project configured"

The project's Vercel integration wasn't set up during provisioning. Check the Broadchurch Portal for the project status.

### API returns 403 for a key

The key is platform-managed (Auth0, gateway, query server, etc.) and cannot be modified through this command. Use the Portal's Platform Services section instead.

### Variable not appearing in the deployed app

- **`NUXT_PUBLIC_*` vars** need a redeployment (push a commit or trigger from Portal)
- **Server-side vars** should be available immediately — check that the key name is correct
- Make sure you're reading the variable correctly in code: use `useRuntimeConfig()` in Nuxt, not `process.env` directly
