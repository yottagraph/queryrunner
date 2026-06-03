# Update Branding

Sync the project's branding implementation with the latest Lovelace branding skill guidelines.

## Overview

The `lovelace-branding` skill (`skills/lovelace-branding/`) is the single source of truth for Lovelace brand identity. This command reviews the project's branding implementation files and updates them to align with the skill.

---

## Step 1: Read the Branding Skill

Read the skill starting from `skills/lovelace-branding/SKILL.md`. It contains a file index that will direct you to the relevant reference files.

---

## Step 2: Review Implementation Files

Read each of the project's branding implementation files and compare against the skill guidelines:

| File                              | What to check                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `assets/brand-globals.css`        | `:root` CSS variables match the skill's color and typography values               |
| `assets/fonts.css`                | `@font-face` declarations match the skill's font setup                            |
| `assets/theme-styles.css`         | Theme utility classes align with the skill's CSS patterns                         |
| `composables/useLovelaceTheme.ts` | `themeColors` object matches the skill's color palette                            |
| `composables/useThemeClasses.ts`  | Theme-aware utilities consistent with skill patterns                              |
| `nuxt.config.ts`                  | Vuetify theme colors match the skill; CSS array includes all branding stylesheets |

For each file, note any discrepancies between the current implementation and the skill guidelines.

---

## Step 3: Update Implementation

For each discrepancy found in Step 2, update the project file to align with the skill:

- **CSS variables**: Update hex values, add missing variables, remove obsolete ones
- **Color palette**: Update `themeColors` in `useLovelaceTheme.ts` to match
- **Typography**: Update font families, weights, and fallbacks as specified by the skill
- **Patterns**: Update theme utility classes to match the skill's CSS patterns
- **Vuetify theme**: Update `lovelaceDark` theme colors in `nuxt.config.ts` if needed

If the skill introduces new concepts not yet implemented in the project (new CSS variable namespaces, new utility classes, new patterns), add them.

If the project has customizations that intentionally diverge from the skill (e.g., project-specific semantic colors), preserve them but note the divergence.

---

## Step 4: Check Assets

Compare logo and asset files in `public/` against the skill's `assets/` directory (`skills/lovelace-branding/assets/`).

- Copy any new or updated SVGs/assets from the skill to `public/`
- If existing assets differ, update them to the skill's versions

---

## Step 5: Verify

1. Confirm `nuxt.config.ts` CSS array still includes all branding stylesheets:
    ```typescript
    css: ['~/assets/fonts.css', '~/assets/brand-globals.css', '~/assets/theme-styles.css'];
    ```
2. Run `npm run build` to verify no compilation errors

---

## Step 6: Commit

Follow the [`git-support.md`](../skills/aether/git-support.md) workflow in the `aether` skill to commit the changes.
