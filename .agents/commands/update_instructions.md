# Update Instructions

Update agent commands and skills from the `@yottagraph-app/aether-instructions` npm package.

## Overview

This command downloads the latest instructions package and extracts it to `.agents/`. A manifest file (`.agents/.aether-instructions-manifest`) tracks which files came from the package so updates only replace package-provided files.

`.cursor/` and `.claude/` are whole-directory symlinks to `.agents/`, and `.mcp.json` is a symlink to `.agents/mcp.json`. Cursor and Claude Code therefore both read the same files; in the repo itself every reference points at the real `.agents/` path.

**What happens:**

1. Ensures the `.agents/` layout exists (migrating a legacy `.cursor/` directory and creating the `.cursor`, `.claude`, `.mcp.json` symlinks as needed)
2. Downloads the latest `@yottagraph-app/aether-instructions` package
3. Deletes files listed in the existing manifest
4. Removes the deprecated `.agents/rules/` directory if present (rules were replaced by the `aether` skill)
5. Extracts fresh files from the package
6. Writes a new manifest
7. Commits the changes

**Your files are safe:** Only paths listed in the manifest are removed before reinstall. Other files under `.agents/` are left alone.

**Shell compatibility:** Run the bash snippets below with **`bash`**, not bare `zsh`. An **empty line** in the manifest can make `rm -rf ".agents/$rel"` delete **all of `.agents/`** — Step 5 skips blank lines to avoid that.

**Registry auth (do this first):** `@yottagraph-app/aether-instructions` lives in the org's GCP Artifact Registry, not public npmjs. Every `npm view`/`npm pack` below needs an `AR_NPM_TOKEN`. Cloud agents have it injected; locally, run `export AR_NPM_TOKEN="$(gcloud auth print-access-token)"` (requires `roles/artifactregistry.reader` on `broadchurch/aether-npm`).

---

## Step 1: Ensure `.agents/` Layout

Detect and perform any one-time migration from the legacy `.cursor/` directory, then make sure the `.cursor`, `.claude`, and `.mcp.json` symlinks exist.

```bash
# Case 1: .cursor is already a symlink (previously migrated) — nothing to do here
if [ -L .cursor ]; then
  :
# Case 2: Fresh install — create .agents/ and symlinks
elif [ ! -e .cursor ]; then
  mkdir -p .agents
# Case 3: Legacy layout — migrate .cursor/ → .agents/
elif [ -d .cursor ]; then
  # Collision guards
  if [ -e .agents ] && [ ! -L .agents ]; then
    echo "Error: both .cursor/ and .agents/ exist as real paths. Resolve manually, then re-run /update_instructions." >&2
    exit 1
  fi
  if [ -d .claude ] && [ ! -L .claude ] && [ -n "$(ls -A .claude 2>/dev/null)" ]; then
    echo "Error: .claude/ exists as a real directory with contents. Move or remove it, then re-run /update_instructions." >&2
    exit 1
  fi
  mv .cursor .agents
  echo "Migrated .cursor/ → .agents/"
fi

# Create symlinks if absent. Test -L first so a symlink with a not-yet-created
# target (e.g. .mcp.json -> .agents/mcp.json before init populates it) doesn't
# trigger an `ln: File exists` error. Plain -e follows symlinks.
[ -L .cursor ]   || [ -e .cursor ]   || ln -s .agents .cursor
[ -L .claude ]   || [ -e .claude ]   || ln -s .agents .claude
[ -L .mcp.json ] || [ -e .mcp.json ] || ln -s .agents/mcp.json .mcp.json
```

Report to user:

> Layout ready: `.agents/` (canonical), with `.cursor`, `.claude`, and `.mcp.json` symlinks for tool compatibility.

---

## Step 2: Check Current Version

Read the current installed version:

```bash
cat .agents/.aether-instructions-version 2>/dev/null || echo "Not installed"
```

Report to user:

> Current version: X.Y.Z (or "Not installed")

---

## Step 3: Check Latest Version

Query npm for the latest version:

```bash
npm view @yottagraph-app/aether-instructions version
```

Compare with current:

- If same version: Ask user if they want to reinstall anyway
- If newer version: Proceed with update
- If current is newer: Warn user (they may have a pre-release)

---

## Step 4: Download Package

`@yottagraph-app/aether-instructions` is served from the org's GCP Artifact
Registry (not public npmjs), so the `.npmrc` scope-pin and an `AR_NPM_TOKEN`
must be present. Cloud agents have it injected; locally, export one first:

```bash
export AR_NPM_TOKEN="$(gcloud auth print-access-token)"
```

Create a temporary directory and download the package:

```bash
TEMP_DIR=$(mktemp -d)
npm pack @yottagraph-app/aether-instructions@latest --pack-destination "$TEMP_DIR"
```

Extract the tarball:

```bash
tar -xzf "$TEMP_DIR"/*.tgz -C "$TEMP_DIR"
```

The extracted content is in `$TEMP_DIR/package/`.

---

## Step 5: Delete Previously Installed Files

Read the manifest and delete listed paths. **Skip blank lines** — an empty `rel` would run `rm -rf ".agents/"` and wipe the whole directory. Entries prefixed with `root/` point at files at the repo root (currently `AGENTS.md` and `CLAUDE.md`); only remove **regular files** there, never directories.

```bash
if [ -f .agents/.aether-instructions-manifest ]; then
  while IFS= read -r rel || [ -n "$rel" ]; do
    [ -z "$rel" ] && continue
    case "$rel" in
      root/*)
        target="${rel#root/}"
        case "$target" in ""|*..*) continue ;; esac
        [ -f "$target" ] && rm -f "$target"
        ;;
      *)
        rm -rf ".agents/$rel"
        ;;
    esac
  done < .agents/.aether-instructions-manifest
fi
```

Also remove the deprecated `.agents/rules/` directory (superseded by the `aether` skill in `.agents/skills/aether/`):

```bash
rm -rf .agents/rules
```

---

## Step 6: Copy New Files

Create directories if needed:

```bash
mkdir -p .agents/commands .agents/skills
```

Copy files from the extracted package:

```bash
cp "$TEMP_DIR/package/commands/"* .agents/commands/ 2>/dev/null || true
cp -r "$TEMP_DIR/package/skills/"* .agents/skills/ 2>/dev/null || true
```

Copy the root-level AGENTS.md and CLAUDE.md from the package to the tenant repo root, if the package ships them. `CLAUDE.md` is a one-line `@AGENTS.md` pointer so Claude Code imports the same instructions Cursor reads from `AGENTS.md`:

```bash
[ -f "$TEMP_DIR/package/AGENTS.md" ] && cp "$TEMP_DIR/package/AGENTS.md" ./AGENTS.md
[ -f "$TEMP_DIR/package/CLAUDE.md" ] && cp "$TEMP_DIR/package/CLAUDE.md" ./CLAUDE.md
```

### Data-mode variant overlay

If this project uses **mcp-only** (or another non-default mode), re-apply the same overlay `init-project.js` uses. Read the saved mode:

```bash
MODE=$(tr -d '\n' < .agents/.aether-data-mode 2>/dev/null || echo "api-mcp")
PKG="$TEMP_DIR/package"
if [ "$MODE" != "api-mcp" ] && [ -d "$PKG/variants/$MODE/commands" ]; then
  cp "$PKG/variants/$MODE/commands/"* .agents/commands/ 2>/dev/null || true
fi
if [ "$MODE" != "api-mcp" ] && [ -d "$PKG/variants/$MODE/skills" ]; then
  # Overlay per-file so default skill topics survive
  for src_dir in "$PKG/variants/$MODE/skills/"*/; do
    [ -d "$src_dir" ] || continue
    dir_name=$(basename "$src_dir")
    mkdir -p ".agents/skills/$dir_name"
    cp "$src_dir"* ".agents/skills/$dir_name/" 2>/dev/null || true
  done
fi
if [ "$MODE" = "mcp-only" ]; then
  rm -rf .agents/skills/elemental-api
fi
```

If `.agents/.aether-data-mode` is missing, skip the overlay (defaults to **api-mcp**).

---

## Step 7: Write Manifest and Version Marker

Build a manifest of all installed files (one relative path per line). **Do not** build a string with a leading `\n` — that writes a blank first line and breaks Step 5. Prefer one `echo` per line:

```bash
{
  for f in .agents/commands/*.md; do [ -f "$f" ] && echo "commands/$(basename "$f")"; done
  for d in .agents/skills/*/; do [ -d "$d" ] && echo "skills/$(basename "$d")"; done
  [ -f "$TEMP_DIR/package/AGENTS.md" ] && [ -f ./AGENTS.md ] && echo "root/AGENTS.md"
  [ -f "$TEMP_DIR/package/CLAUDE.md" ] && [ -f ./CLAUDE.md ] && echo "root/CLAUDE.md"
} > .agents/.aether-instructions-manifest
```

If the repo uses **bash** for this loop and a glob might match nothing, run `shopt -s nullglob` first so the loops don't treat `*.md` as a literal filename.

Write the version marker:

```bash
grep -o '"version": *"[^"]*"' "$TEMP_DIR/package/package.json" | grep -o '[0-9][^"]*' > .agents/.aether-instructions-version
```

---

## Step 8: Cleanup

Remove the temporary directory:

```bash
rm -rf "$TEMP_DIR"
```

---

## Step 9: Report Changes

Count what was installed:

```bash
wc -l < .agents/.aether-instructions-manifest
ls .agents/commands/*.md 2>/dev/null | wc -l
ls -d .agents/skills/*/ 2>/dev/null | wc -l
```

Report to user:

> Updated to @yottagraph-app/aether-instructions@X.Y.Z
>
> - Commands: N files
> - Skills: N directories

---

## Step 10: Commit Changes

Commit the updated instruction files and (on first migration) the new symlinks. A root `.gitignore` rule like `skills/` can **ignore** `.agents/skills/`; if `git add .agents/skills/` reports ignored paths, force-add:

```bash
git add .agents/commands/ .agents/.aether-instructions-version .agents/.aether-instructions-manifest
git add -f .agents/skills/
# Symlinks (no-ops if they were already tracked)
[ -L .cursor ]   && git add .cursor
[ -L .claude ]   && git add .claude
[ -L .mcp.json ] && git add .mcp.json
[ -f AGENTS.md ] && git add AGENTS.md
[ -f CLAUDE.md ] && git add CLAUDE.md
# Remove the legacy rules dir from tracking if it was committed in an earlier install
git rm -rf --cached --ignore-unmatch .agents/rules 2>/dev/null || true
# If we just migrated, drop the old .cursor/ path from tracking so git records the symlink instead of the directory
git rm -rf --cached --ignore-unmatch .cursor 2>/dev/null || true
[ -L .cursor ] && git add .cursor
git commit -m "Update instructions to vX.Y.Z"
```

Use the repo's commit convention if applicable (e.g. `[Agent commit] Update instructions to vX.Y.Z`).

> Changes committed. Your instructions are now up to date.

---

## Troubleshooting

### npm pack fails

If `npm pack` fails with a `401`/`403` or registry error:

> `@yottagraph-app/*` resolves from the org's GCP Artifact Registry, not npmjs.
> Make sure `.npmrc` pins `@yottagraph-app:registry` to the Artifact Registry
> repo and that `AR_NPM_TOKEN` is set:
> `export AR_NPM_TOKEN="$(gcloud auth print-access-token)"` (you must have
> `roles/artifactregistry.reader` on `broadchurch/aether-npm`). See
> `broadchurch/docs/NPM_PRIVATE_REGISTRY.md`.

### Permission denied

If you get permission errors:

> Try running with appropriate permissions, or check that `.agents/` is writable.

### Want to customize a command, skill topic, or AGENTS.md?

If you need to modify a package-provided file (including the root `AGENTS.md` or `CLAUDE.md`):

1. Edit it directly — your changes will persist until the next update
2. To preserve changes across updates, copy it to a new name first (e.g. `cp AGENTS.md AGENTS.local.md`)
3. Remove the original's entry from `.agents/.aether-instructions-manifest` so it won't be deleted on update (for `AGENTS.md`, remove the `root/AGENTS.md` line; for `CLAUDE.md`, remove `root/CLAUDE.md`)

`CLAUDE.md` ships as a one-line `@AGENTS.md` pointer — Claude Code imports `AGENTS.md` via that syntax, so in most cases you only need to edit `AGENTS.md`.

### Blank line in manifest deleted `.agents/`

Regenerate the manifest with Step 7 (echo-per-line form). Ensure Step 5 skips empty lines.

### `git add` says `.agents/skills` is ignored

Use `git add -f .agents/skills/` as in Step 10, or narrow `.gitignore` so `skills/` only ignores the project `skills/` folder (e.g. `/skills/` at repo root) instead of every `skills` path.

### Migration aborted (collision)

If Step 1 aborts because `.cursor/` and a real `.agents/` both exist, or `.claude/` has hand-written contents: decide which source is authoritative, back up the other, then re-run.
