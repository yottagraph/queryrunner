If you are in a claude.ai/code cloud session, the `environment.json` install
step runs `init-project.js` and `npm install` automatically, and starts a dev
server on port 3000.

**Verify before starting:** check that `.env` exists and `node_modules/` is
present. If either is missing, run: `node init-project.js && npm install`

**Do NOT** manually run `nvm install` or `nvm use` — Node version is managed
by the environment.

### Sessions are ephemeral

Each claude.ai/code session clones a fresh copy of the repo. Uncommitted
changes are lost when the session ends. Commit and push work regularly.

### GitHub connection required

The repo must be hosted on GitHub. On first use, you will be prompted to
install the Claude GitHub App on the repository. Alternatively, run
`/web-setup` in Claude Code to sync a local `gh` CLI token to your account.
Both public and private repos are supported.

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

Lovelace MCP servers (`lovelace-elemental`, `lovelace-stocks`, etc.) are
available after running `/broadchurch_setup`, which writes `.agents/mcp.json`
with the tenant's portal proxy URLs. Check your tool list for `elemental_*`
tools. If they're not available, use the Elemental API client
(`useElementalClient()`) and the skill docs in `.agents/skills/elemental-api/`
and `.agents/skills/data-model/` for platform data access instead.

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

### Availability

claude.ai/code is available on Pro, Max, Team, and Enterprise plans
(Research Preview). Sessions are billed against your plan's usage.
