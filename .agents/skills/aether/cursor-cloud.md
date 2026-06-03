If you are in Cursor Cloud, the `environment.json` install step runs
`init-project.js` and `npm install` automatically, and starts a dev server
on port 3000.

**Verify before starting:** check that `.env` exists and `node_modules/` is
present. If either is missing, run: `node init-project.js --local && npm install`
(the `--local` flag is the non-interactive cloud path; bare
`node init-project.js` launches the interactive wizard, which will hang a
cloud agent). If `.agents/skills/` is empty, the instruction install
didn't land — re-run `node init-project.js --local` to fetch it.

**Do NOT** manually run `nvm install` or `nvm use` — Node version is managed
by the environment.

### Initial environment setup only

This subsection applies ONLY when first asked to "set up the development
environment" or "demonstrate that the environment is working." It does
**NOT** apply to ongoing development — once the app is built, use the
browser normally to test and verify UI changes.

**During initial setup**, skip browser/UI testing. The starter UI is a
placeholder template that will be replaced by `/build_my_app`. Do not
launch a browser, record videos, or take screenshots at this stage.
Verifying `npm run build` passes is sufficient.

1. Check the "Dev Server" terminal output for a line containing
   `Listening on` or `Local: http://localhost:3000`. If present, the
   environment is working.
2. If the dev server is NOT running, start it with `npm run dev` and wait
   for the "Listening on" line.
3. Run `npm run build` to verify the project compiles.
4. Once confirmed, tell the user the environment is ready, then
   immediately run the `/build_my_app` command.

### MCP tools

Lovelace MCP servers (`lovelace-elemental`, `lovelace-stocks`, etc.)
should be available if configured at the org level. Check your tool list
for `elemental_*` tools. If they're not available, use the Elemental API
client (`useElementalClient()`) and the skill docs in
`.agents/skills/elemental-api/` and `.agents/skills/data-model/` for platform data access instead.

### Technical details

Node 20 is the baseline (`.nvmrc`). The `environment.json` install step
handles this via `nvm install 20 && nvm alias default 20`. Newer Node
versions (22, 25) generally work but may produce `EBADENGINE` warnings
during install — safe to ignore.

The install step runs `node init-project.js --local` (creates `.env` if
absent) then `npm install` (triggers `postinstall` → `nuxt prepare`).
Auth0 is bypassed via `NUXT_PUBLIC_USER_NAME=dev-user`
in the generated `.env`.

**No automated test suite.** Verification is `npm run build` (compile
check) and `npm run format:check` (Prettier). See Verification Commands.

**Before committing:** always run `npm run format` — the husky pre-commit
hook runs `lint-staged` with `prettier --check` and will reject
unformatted files.

### After you push to `main` — the deploy is NOT instant

How your push goes live depends on the tenant's hosting (see `hosting:`
in `broadchurch.yaml`):

- **`hosting: gcp` (GKE — the BC 2.0 default):** the push does NOT serve
  immediately. A GitHub Action builds + publishes the UI image, the
  Portal dispatches a `gcp-bctenant` apply, and **ArgoCD rolls the new
  revision — typically ~8–10 min end-to-end** (image build + ArgoCD poll
  interval ≤ 3 min + a ~30–90s rolling update). Your only honest signal
  that it's live is the public URL responding with the new code — poll it,
  don't assume the push = live:

    ```bash
    # <slug> is your tenant slug; host is ui.<slug>.tenant.g.lovelace.ai
    curl -sf -o /dev/null -w '%{http_code}\n' https://ui.<slug>.tenant.g.lovelace.ai/
    ```

    A first-time deploy may also wait on the managed cert (DNS-01) — a 5xx
    or TLS error for the first few minutes is warm-up, not failure. See
    `/deploy_ui` (`commands/deploy_ui.md`) for the full timing breakdown.

- **`hosting: vercel` (legacy BC 1.0):** Vercel auto-deploys on push to
  `main` in ~1–2 min. See `git-support.md`.

Either way: a fresh tenant's data planes (Cloud SQL especially) keep
warming for ~5–15 min, so a route can compile clean and still return
"warming up" right after the first deploy. That's expected.
