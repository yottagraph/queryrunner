# Configure Query Server

Change the Query Server address used by this project for data access (Elemental API).

## Overview

This command updates the Query Server URL in both `broadchurch.yaml` and `.env` so your local dev server uses the new address. No portal access is needed.

**Prerequisite:** The project must have a `broadchurch.yaml` file (created during provisioning or `/broadchurch_setup`).

---

## Step 1: Read Current Configuration

Read `broadchurch.yaml` from the project root.

```bash
cat broadchurch.yaml
```

**If the file does not exist:**

> This project doesn't have a `broadchurch.yaml` yet. Run `/broadchurch_setup` first, or create one manually.

Stop here.

Extract the current `query_server.url` value.

Also read `.env` to check the current `NUXT_PUBLIC_QUERY_SERVER_ADDRESS`:

```bash
grep NUXT_PUBLIC_QUERY_SERVER_ADDRESS .env
```

Show the user the current value from both files.

---

## Step 2: Ask for the New Address

Present the user with common options:

> **Current Query Server:** `<current_url>`
>
> Which Query Server would you like to use?
>
> 1. **Production** — `https://query.pip.prod.g.lovelace.ai`
> 2. **Sandbox** — `https://query.news.sbox.g.lovelace.ai`
> 3. **Local** — `http://localhost:8080`
> 4. **Custom** — Enter a custom URL

Wait for the user to choose.

---

## Step 3: Update broadchurch.yaml

Replace the `query_server.url` value in `broadchurch.yaml` with the new URL. The line to update looks like:

```yaml
query_server:
    url: '<NEW_URL>'
```

Preserve all other content in the file.

---

## Step 4: Update .env

Update the `NUXT_PUBLIC_QUERY_SERVER_ADDRESS` line in `.env`:

```
NUXT_PUBLIC_QUERY_SERVER_ADDRESS=<NEW_URL>
```

**If the line doesn't exist in `.env`:** Add it.

---

## Step 5: Confirm

> Query Server updated to `<NEW_URL>`.
>
> - `broadchurch.yaml` — updated
> - `.env` — updated
>
> **Restart your dev server** (`npm run dev`) for the change to take effect.
>
> Note: This only affects your local environment. To update the deployed app, change the Query Server address in the Broadchurch Portal (it will propagate to your repo and Vercel automatically).
