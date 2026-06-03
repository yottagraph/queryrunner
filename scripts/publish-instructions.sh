#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$ROOT_DIR/packages/aether-instructions"

# --- Parse arguments ---------------------------------------------------------

BUMP=""
PUBLISH=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)    BUMP="$2"; shift 2 ;;
    --publish) PUBLISH=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--bump patch|minor|major] [--publish] [--dry-run]

Bundles aether-dev source commands and skills into the
@yottagraph-app/aether-instructions npm package (original filenames).

Options:
  --bump <level>   Bump package version (patch, minor, major)
  --publish        Publish to GCP Artifact Registry after bundling
                   (requires AR_NPM_TOKEN, e.g. export AR_NPM_TOKEN="\$(gcloud auth print-access-token)")
  --dry-run        Show what would happen without writing files
  -h, --help       Show this help
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Validate sources --------------------------------------------------------

if [[ ! -d "$ROOT_DIR/commands" ]]; then
  echo "Error: commands/ directory not found in $ROOT_DIR" >&2
  exit 1
fi
if [[ ! -d "$ROOT_DIR/skills" ]]; then
  echo "Error: skills/ directory not found in $ROOT_DIR" >&2
  exit 1
fi

# --- Clean package directories -----------------------------------------------

echo "==> Cleaning package directories"

for subdir in commands skills; do
  target="$PKG_DIR/$subdir"
  if $DRY_RUN; then
    echo "    Would clean $target/"
  else
    rm -rf "$target"
    mkdir -p "$target"
  fi
done

if $DRY_RUN; then
  echo "    Would remove $PKG_DIR/AGENTS.md"
  echo "    Would remove $PKG_DIR/CLAUDE.md"
  echo "    Would remove $PKG_DIR/agents-readme.md"
else
  rm -f "$PKG_DIR/AGENTS.md"
  rm -f "$PKG_DIR/CLAUDE.md"
  rm -f "$PKG_DIR/agents-readme.md"
fi

# --- Copy commands (original names, minus exclusions) ------------------------

echo "==> Bundling commands"
commands_count=0
for f in "$ROOT_DIR"/commands/*.md; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  if $DRY_RUN; then
    echo "    $base"
  else
    cp "$f" "$PKG_DIR/commands/$base"
  fi
  commands_count=$((commands_count + 1))
done
echo "    $commands_count commands"

# --- Copy skills (original names) -------------------------------------------

echo "==> Bundling skills"
skills_count=0
if [[ -d "$ROOT_DIR/skills" ]]; then
  for d in "$ROOT_DIR"/skills/*/; do
    [[ -d "$d" ]] || continue
    base="$(basename "$d")"
    if $DRY_RUN; then
      echo "    $base/"
    else
      cp -r "$d" "$PKG_DIR/skills/$base"
    fi
    skills_count=$((skills_count + 1))
  done
fi
echo "    $skills_count skill directories"

# --- Bundle root docs (AGENTS.md, CLAUDE.md) --------------------------------

echo "==> Bundling root docs"
if [[ -f "$ROOT_DIR/docs/AGENTS.user.md" ]]; then
  if $DRY_RUN; then
    echo "    AGENTS.md (from docs/AGENTS.user.md)"
  else
    cp "$ROOT_DIR/docs/AGENTS.user.md" "$PKG_DIR/AGENTS.md"
  fi
else
  echo "    docs/AGENTS.user.md not found — skipping"
fi

if [[ -f "$ROOT_DIR/docs/CLAUDE.user.md" ]]; then
  if $DRY_RUN; then
    echo "    CLAUDE.md (from docs/CLAUDE.user.md)"
  else
    cp "$ROOT_DIR/docs/CLAUDE.user.md" "$PKG_DIR/CLAUDE.md"
  fi
else
  echo "    docs/CLAUDE.user.md not found — skipping"
fi

if [[ -f "$ROOT_DIR/.agents/README.md" ]]; then
  if $DRY_RUN; then
    echo "    agents-readme.md (from .agents/README.md)"
  else
    cp "$ROOT_DIR/.agents/README.md" "$PKG_DIR/agents-readme.md"
  fi
else
  echo "    .agents/README.md not found — skipping"
fi

# --- Bundle data-mode variants (e.g. mcp-only) -------------------------------

echo "==> Bundling variants/mcp-only"
VARIANT_BASE="$PKG_DIR/variants/mcp-only"
if $DRY_RUN; then
  echo "    Would clean $PKG_DIR/variants/ and copy commands-mcp-only/, skills-mcp-only/"
else
  rm -rf "$PKG_DIR/variants"
  mkdir -p "$VARIANT_BASE/commands" "$VARIANT_BASE/skills"
  if [[ -d "$ROOT_DIR/commands-mcp-only" ]]; then
    for f in "$ROOT_DIR/commands-mcp-only"/*.md; do
      [[ -f "$f" ]] || continue
      cp "$f" "$VARIANT_BASE/commands/"
    done
  fi
  if [[ -d "$ROOT_DIR/skills-mcp-only" ]]; then
    for d in "$ROOT_DIR/skills-mcp-only"/*/; do
      [[ -d "$d" ]] || continue
      base="$(basename "$d")"
      cp -r "$d" "$VARIANT_BASE/skills/$base"
    done
  fi
fi

# --- Bump version ------------------------------------------------------------

if [[ -n "$BUMP" ]]; then
  echo "==> Bumping version ($BUMP)"
  if $DRY_RUN; then
    echo "    Would run: npm version $BUMP (in $PKG_DIR)"
  else
    cd "$PKG_DIR"
    npm version "$BUMP" --no-git-tag-version
    NEW_VERSION="$(node -p "require('./package.json').version")"
    echo "    New version: $NEW_VERSION"
    cd "$ROOT_DIR"
  fi
else
  NEW_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
fi

# --- Publish -----------------------------------------------------------------

if $PUBLISH; then
  echo "==> Publishing to GCP Artifact Registry"
  if $DRY_RUN; then
    echo "    Would run: npm publish packages/aether-instructions (from repo root)"
  else
    if [[ -z "${AR_NPM_TOKEN:-}" ]]; then
      echo "Error: AR_NPM_TOKEN is not set. Run: export AR_NPM_TOKEN=\"\$(gcloud auth print-access-token)\"" >&2
      exit 1
    fi
    # Publish from the repo root so the committed root .npmrc (registry +
    # AR_NPM_TOKEN) applies; publishConfig.registry targets Artifact Registry.
    cd "$ROOT_DIR"
    npm publish packages/aether-instructions
    echo "    Published @yottagraph-app/aether-instructions@${NEW_VERSION}"
  fi
fi

# --- Summary -----------------------------------------------------------------

echo ""
echo "Done! Package contents:"
echo "  Commands: $commands_count files"
echo "  Skills:   $skills_count directories"
echo "  Version:  ${NEW_VERSION:-$(node -p "require('$PKG_DIR/package.json').version")}"

if ! $PUBLISH; then
  echo ""
  echo "To publish: AR_NPM_TOKEN=\"\$(gcloud auth print-access-token)\" $(basename "$0") --publish"
  echo "Or, from the repo root: npm publish packages/aether-instructions"
fi
