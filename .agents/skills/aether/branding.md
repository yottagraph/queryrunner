# Lovelace Branding

The `lovelace-branding` skill (`skills/lovelace-branding/`) is the single source of truth for all brand specifics -- colors, typography, patterns, assets, and usage guidelines. Read the skill before making branding decisions. Start with `SKILL.md` for the file index.

## Theme

Single dark theme. No light mode, no theme switching.

## Implementation Files

These files are project-owned. Consult the branding skill for the values and patterns they should implement.

| File                              | Role                                               |
| --------------------------------- | -------------------------------------------------- |
| `assets/brand-globals.css`        | `:root` CSS variables and global typography/layout |
| `assets/fonts.css`                | `@font-face` declarations                          |
| `assets/theme-styles.css`         | Theme-aware CSS utility classes                    |
| `composables/useLovelaceTheme.ts` | Theme color palette and Vuetify theme activation   |
| `composables/useThemeClasses.ts`  | Theme-aware class combination utilities            |

## Integration

- Use `useLovelaceTheme()` or `useThemeClasses()` in components for theme colors and class utilities.
- The `lovelaceDark` Vuetify theme is defined in `nuxt.config.ts` under `vuetify.vuetifyOptions.theme`. It provides brand colors to all Vuetify components automatically. Component defaults are set under `vuetify.vuetifyOptions.defaults`.
- CSS variables (`--lv-*`) and theme classes (`.theme-*`) are available globally via the stylesheets listed above.
- `useLovelaceTheme` calls `theme.change('lovelaceDark')` to activate the Vuetify theme. This must match the theme name in `nuxt.config.ts`.

## Updating

Run `/update_branding` to sync these files with the latest branding skill guidelines. The command reads the skill, compares each implementation file against the guidelines, and updates as needed.
