# Restoring Broken Functionality from Git History

**Trigger phrases:** "this used to work", "this broke", "it was working before", "I want it back the way it was", "it looked right before", or similar.

**Important:** If the user says it "just" worked or worked "a moment ago", the working version may not be in any commit yet — it may be an uncommitted change you made earlier in the conversation. In that case, review your own chat history to find what changed and revert it directly. This workflow is for restoring functionality that existed in a **previous commit**.

## 1. Gather Context

Ask the user:

- What specifically broke or changed?
- When do they remember it last working? (A rough timeframe, a branch, a specific action, etc.)

## 2. Find the Working Commit

Use `git log` (with relevant flags like `--oneline`, `--since`, `-- <path>`) to locate a commit where the feature was working. Show candidates to the user so they can help narrow it down.

## 3. Confirm the Working State

Check out the candidate commit so the user can verify it's the version they want. Save any uncommitted work first and resolve any conflicts or discrepancies that arise when switching between commits.

If it's not right, try other commits. Collaborate with the user until the correct commit is identified. Once confirmed, return to the working branch.

## 4. Extract Only What's Needed

From the confirmed commit, extract **only** the parts that fix the regression — this could be entire files or as little as a single line. Do NOT blindly take the whole commit if only part of it is relevant.

Show the user the combined result (current code + restored pieces) and have them confirm it works as desired **before** creating a commit.

## 5. Commit the Restoration

Only after the user confirms the restored version is correct, follow the standard git workflow (see [git-support.md](git-support.md) in this skill) to commit the changes.

# "The platform API is broken" — read this first

If the symptom is **"the Query Server / Elemental MCP / Portal Gateway is
returning errors,"** stop. The single most common cause of platform
outage reports from build agents is the agent itself hitting a
non-existent URL and misreading the resulting `404`, `401`, or HTML
body as a server-side failure. Before patching any caller, probe the
endpoint with curl and classify the response:

1. Run `/diagnose <url>` (see `commands/diagnose.md`) — it walks you
   through capturing the request, probing with curl, and classifying
   the response before you change any code.
2. Cross-reference [data.md](data.md) § "Interpreting portal-proxy
   errors" for the status-code → cause mapping.
3. Only after Step 1's probe shows a real `5xx` from the portal or a
   captured timeout should you treat this as an upstream incident.
   Patching the caller because "the API seems flaky" without a
   captured failing response is how false bug reports get filed and
   how silent regressions land in `useServerStatus`-style health
   checks. See the cautionary tale in [data.md](data.md) § "Before
   you 'fix' an apparent platform outage."

# Common Build Errors

When `npm run build` fails, check these common causes:

### `Cannot find module '~/composables/...'` or `'~/utils/...'`

Wrong import path or the file doesn't exist. Nuxt auto-imports everything in `composables/` but NOT `utils/` -- use explicit imports for utils:

```typescript
import { myHelper } from '~/utils/myHelper';
```

### `Type 'X' is not assignable to type 'Y'`

Usually an API response shape mismatch. Common case: `getSchema()` nests data under `response.schema` but TypeScript types suggest top-level access. See [data.md](data.md)'s API Gotchas section in this skill.

### `SyntaxError` or blank page with "missing export"

Nuxt's auto-import scanner misdetected a function parameter as an export. Verify the `imports:dirs` hook in `nuxt.config.ts` excludes `utils/` from scanning:

```typescript
hooks: {
    'imports:dirs': (dirs: string[]) => {
        const idx = dirs.findIndex((d) => d.endsWith('/utils'));
        if (idx !== -1) dirs.splice(idx, 1);
    },
},
```

### Prettier pre-commit failure

Run `npm run format` then `git add -A` and retry the commit. Do not run Prettier directly -- always use `npm run format`.

### `sh: nuxt: command not found`

Dependencies aren't installed. Run `npm install` first.
