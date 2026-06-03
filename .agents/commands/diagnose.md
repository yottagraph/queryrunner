# Diagnose a Platform API

Probe a Broadchurch Portal Gateway endpoint with curl, inspect the **actual**
response, and use that evidence — not inferred behavior — before deciding
whether anything is broken or proposing any fix.

## When to use

Run `/diagnose` whenever you are about to:

- Patch a caller, composable, or server route because a platform API
  "seems to be returning 500s," "is broken," or "is timing out."
- Add a workaround that bypasses a health/status check or short-circuits
  a real probe with an unconditional "available" branch.
- File a `/critique` claiming a platform endpoint is misbehaving.
- Tell the user "the gateway is down" or "Elemental MCP is returning
  errors" without having run an actual probe in the last few minutes.

If any of those is in front of you, stop and run this command first.
The single most common cause of "platform outage" reports from build
agents is the agent itself hitting a non-existent URL and misreading
the resulting `404`, `401`, or HTML body as a server-side failure.

## How to invoke

```
/diagnose <url-or-endpoint>
```

`<url-or-endpoint>` is either:

- A full URL the app is calling (preferred — copy the exact URL from
  the failing request, network tab, or thrown error).
- A relative path like `/api/qs/{org}/status` or `/elemental/find`
  (the command will fill in the gateway URL and tenant org ID from
  `broadchurch.yaml`).

If no argument is given, ask the user (or yourself) **"what is the
exact URL and method that's failing?"** before doing anything else.
If you can't answer that question, the diagnosis has already failed —
you are about to "fix" a symptom whose cause you haven't observed.

---

## Step 1: Establish the exact request

Capture, in writing (in the chat), four things:

1. **Method + URL** — the full URL, including query string, exactly as
   the failing code is constructing it.
2. **Headers** — at minimum, `Content-Type` (if a body is being sent),
   `X-Api-Key` (if hitting `/api/qs/*`), and `Authorization` (if
   anything else expects a bearer token).
3. **Body** — the actual bytes being sent, JSON-stringified if applicable.
4. **The error symptom** — the literal error message, status code, or
   HTML/JSON snippet the caller saw, copy-pasted, not paraphrased.

If you can't produce (1)–(4), go back to the failing code and instrument
it (a single `console.log` of `{ url, method, headers, body }` right
before the `fetch` / `$fetch`) and re-run. Then come back.

> **Read this before you proceed:** the worst-case failure mode of this
> command is to skip Step 1 because "it's obvious what's failing." It
> isn't. The point of /diagnose is to refuse to skip Step 1.

## Step 2: Probe with curl

Read `broadchurch.yaml` for the gateway URL, tenant org ID, and (if
the endpoint is QS) the API key:

```bash
GW=$(grep -A1 '^gateway:' broadchurch.yaml | grep url | awk -F"'" '{print $2}')
ORG=$(grep -A1 '^tenant:' broadchurch.yaml | grep org_id | awk -F"'" '{print $2}')
KEY=$(grep qs_api_key broadchurch.yaml | awk -F"'" '{print $2}')
echo "GW=$GW ORG=$ORG KEY=${KEY:0:8}..."
```

Then issue the request as a curl with the **same** method, headers,
and body you captured in Step 1. Use `-i` so you see headers, and
`-w '\n--- %{http_code} %{content_type} %{size_download}b ---\n'`
so the status code, content type, and body size are unambiguous:

```bash
# For QS (REST):
curl -i -X GET "$GW/api/qs/$ORG/status" \
  -H "X-Api-Key: $KEY" \
  -w '\n--- %{http_code} %{content_type} %{size_download}b ---\n'

# For MCP (JSON-RPC):
curl -i -X POST "$GW/api/mcp/$ORG/elemental/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  -w '\n--- %{http_code} %{content_type} %{size_download}b ---\n'
```

Capture the **full response**: status line, headers, and body. Do not
truncate.

## Step 3: Classify the response

Use the table below before doing anything else. The classification
determines what (if anything) is actually wrong and where the fix
belongs. **Most "platform outage" reports resolve at this step.**

| Status  | `content-type`     | First thing to check                                                                                                       |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `200`   | `application/json` | Endpoint is healthy. The bug is in the caller — usually wrong body shape, schema mismatch, or downstream JSON parse logic. |
| `200`   | `text/html`        | Caller hit a non-existent path that fell through to a SPA fallback. Fix the URL, not the caller's error handling.          |
| `204`   | (none)             | Healthy empty response. Caller probably expected JSON and barfed on empty body — handle the 204 explicitly.                |
| `400`   | `application/json` | Portal rejected the request shape. Read the `statusMessage` / `data` body — usually missing field or wrong content type.   |
| `401`   | `application/json` | Missing/wrong `X-Api-Key` (QS) or missing/expired bearer (MCP). Not a server outage; not a 500.                            |
| `403`   | `application/json` | Tenant is `suspended` or `deprovisioning`. Check tenant status in the portal.                                              |
| `404`   | `application/json` | Bad URL path or unknown server/tenant. Read the `data.hint` and `data.valid_paths` fields. **Not a server failure.**       |
| `404`   | `text/html`        | (Shouldn't happen post-2026-05-26.) Indicates the portal SPA fallback is back; report to the platform team.                |
| `5xx`   | `application/json` | Genuine upstream failure. The body usually contains the upstream error; capture it for the platform team.                  |
| `5xx`   | `text/html`        | Genuine portal-side failure. Capture the full response and report to the platform team.                                    |
| timeout | —                  | Network or cold-start issue. Retry once with `--max-time 30`; if it persists for >2 min, report to the platform team.      |

Cross-reference against `.agents/skills/aether/data.md` §
"Interpreting portal-proxy errors" for the same table in skill form.

## Step 4: Decide where the fix lives

Based on Step 3's classification:

- **Status was `200 application/json`**: the platform is fine. The bug is
  in the caller's parsing, schema assumptions, or downstream logic.
  Do not "harden" the call or suppress its result.
- **Status was `200 text/html`**: stop. You are constructing a URL that
  does not exist. **Fix the URL** in the caller. Do not catch the
  HTML response and treat it as a successful empty result. (This is
  the failure mode that triggered the 2026-05-26 incident — see
  `skills/aether/data.md` § "Lovelace MCP Servers" for the canonical
  URL shapes.)
- **Status was `4xx application/json`**: read the response body's
  `data.hint` field (the portal writes one). The hint will tell you
  whether your URL, your headers, or your body is wrong. Fix the
  request, not the caller's error handling.
- **Status was `5xx`**: capture the full response and **escalate to the
  platform team** with the request/response pair from Steps 1–2. Do
  not paper over the failure with a fallback that masks the signal.
- **Timed out**: retry once with a longer timeout. If the symptom
  persists, escalate.

## Step 5: Apply the fix (or escalate)

Only after Step 4 classifies the response, propose code changes. Each
change must be tied directly to the actual response shape — not to
"the API is flaky" or "the proxy sometimes returns 500s on /status"
unless you have a captured 500 response in this very session that
demonstrates that.

When you write the fix:

- Reference the captured response in the commit message ("portal
  returned `404 application/json` with `data.hint: '...'`, root cause
  was the URL using `/macro` instead of `/mcp`").
- Do not add code comments that assert upstream behavior you haven't
  observed. Comments like "the proxy sometimes returns noisy 500s on
  `/status`" are speculation if they're not backed by a captured
  response — and they will mislead the next agent that reads them.

## What never to do

- **Never patch a caller because "the API seems broken."** Always probe
  first. The platform endpoint is almost always not the problem.
- **Never wrap a probe in a blanket "treat as healthy" short-circuit.**
  If the probe is reliable, you don't need the short-circuit. If it
  isn't, the short-circuit just hides the real signal.
- **Never assume a `200 text/html` is a successful empty response.**
  It is, by construction, a SPA shell being served because no API
  route matched. The caller is wrong about the URL.
- **Never trust an inherited code comment about platform behavior** —
  re-run the probe and confirm. Comments rot; HTTP probes don't.

## After the diagnosis

Post a short summary in the chat with:

1. The exact request (method, URL, headers, body) from Step 1.
2. The actual response status + content-type + body excerpt from Step 2.
3. The classification from Step 3.
4. The action from Step 4 (fix in caller / fix URL / escalate).

If the platform was healthy, that's a worthwhile result — the user
now knows where the real bug is. If the platform is genuinely
misbehaving, the chat message above is the artifact the platform
team needs to act on it.
