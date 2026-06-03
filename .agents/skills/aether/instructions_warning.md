# Aether Instructions Warning

**You are editing a file managed by the `@yottagraph-app/aether-instructions` package.**

Package-managed files are tracked by `.agents/.aether-instructions-manifest`.
They will be **overwritten** when you run `/update_instructions`.

This includes files under `.agents/commands/`, `.agents/skills/`, **and the
root `AGENTS.md` and `CLAUDE.md`** (tracked as `root/AGENTS.md` and
`root/CLAUDE.md` in the manifest).

`.cursor`, `.claude`, and `.mcp.json` are symlinks into `.agents/`, so any
path you see under those resolves to the same managed file.

## Do Not

- Modify files listed in the manifest directly (changes will be lost on update)

## To Customize

If you need to modify a package-provided command, skill topic, or the root `AGENTS.md` / `CLAUDE.md`:

1. **Copy** the file to a new name
2. Make your changes to the copy
3. Remove the original's entry from `.agents/.aether-instructions-manifest`
   so it won't be replaced on update

Examples:

```bash
# Customize a skill topic
cp .agents/skills/aether/data.md .agents/skills/aether/data_custom.md

# Customize AGENTS.md
cp AGENTS.md AGENTS.local.md
# then remove the `root/AGENTS.md` line from
# .agents/.aether-instructions-manifest

# Customize CLAUDE.md
cp CLAUDE.md CLAUDE.local.md
# then remove the `root/CLAUDE.md` line from the manifest

# Edit your copy — it won't be affected by instruction updates
```

## How It Works

- `.agents/.aether-instructions-manifest` lists every file installed by the
  package (one relative path per line, e.g. `skills/aether/data.md`). Entries
  prefixed with `root/` refer to files at the tenant repo root
  (currently `root/AGENTS.md` and `root/CLAUDE.md`).
- `/update_instructions` deletes manifest entries, extracts fresh files from
  the latest package, and writes a new manifest
- Files not in the manifest are never touched
