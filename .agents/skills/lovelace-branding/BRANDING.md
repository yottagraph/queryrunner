# Lovelace Brand R2 Guidelines

This document defines the visual identity for all Lovelace UI products (News UI, Ada Demo, etc.). It is derived from the Brand R2 review and serves as the single source of truth for colors, typography, iconography, and usage patterns.

## Color Palettes

### Core Palette

Jet Black, Pure White, Sonic Silver, and Cyber Green are Lovelace's core brand colors.

| Name         | Hex       | Usage                          |
|--------------|-----------|--------------------------------|
| Jet Black    | `#0A0A0A` | Primary backgrounds            |
| Pure White   | `#FFFFFF` | Primary text on dark surfaces  |
| Sonic Silver | `#757575` | Muted text, secondary elements |
| Cyber Green  | `#3FEA00` | Primary accent, CTAs, success  |

The palette can be extended with neutral greyscale tones ranging from Pure White `#FFF` to True Black `#000`. We use Jet Black `#0A0A0A` as our primary black for most purposes.

### Secondary Colors

Electric Blue and Blaze Orange are secondary colors to extend the branding.

| Name          | Hex       | Usage                               |
|---------------|-----------|-------------------------------------|
| Electric Blue | `#003BFF` | Accent, links, finance/data         |
| Blaze Orange  | `#FF5C00` | Warnings, highlights, secondary CTA |

### Semantic Colors

| Name   | Hex       | Usage    |
|--------|-----------|----------|
| Amber  | `#FF9F0A` | Warnings |
| Red    | `#EF4444` | Errors   |

### Color Ramps

Each color has a ramp from 50 (lightest) to 950 (darkest). The `/500` value is the base brand color. Colors go lighter (lower numbers) or darker (higher numbers) depending on context.

**Neutrals:**

| 50      | 100      | 200      | 300      | 400      | 500      | 600      | 700      | 800      | 900      | 950      |
|---------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| #FFFFFF | #F8F8F8  | #E6E6E6  | #D5D5D6  | #B1B1B1  | #757575  | #6C6C6C  | #464646  | #222222  | #0A0A0A  | #000000  |

**Green:**

| 50      | 100      | 200      | 300      | 400      | 500      | 600      | 700      | 800      | 900      | 950      |
|---------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| #DDFFD1 | #BBFFA3  | #99FF75  | #78FF47  | #57FF19  | #3FEA00  | #30BC00  | #238E00  | #166100  | #0B3300  | #010500  |

**Blue:**

| 50      | 100      | 200      | 300      | 400      | 500      | 600      | 700      | 800      | 900      | 950      |
|---------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| #E6EBFF | #BBC7FF  | #8AA3FF  | #6C80FF  | #2E5DFF  | #003BFF  | #0230D0  | #0326A1  | #031B73  | #021146  | #010819  |

**Orange:**

| 50      | 100      | 200      | 300      | 400      | 500      | 600      | 700      | 800      | 900      | 950      |
|---------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| #FFF0E6 | #FFD4B8  | #FFB78A  | #FF989C  | #FF7B2E  | #FF5C00  | #D04E02  | #A13F03  | #732F03  | #461E02  | #190801  |

### Usage Proportions

The proportional usage of each color to the whole (approximate):
- Jet Black + Pure White: ~70% of surface area (dark backgrounds, white text)
- Cyber Green: ~15% (accents, interactive elements, success states)
- Sonic Silver: ~10% (muted text, borders, secondary elements)
- Electric Blue + Blaze Orange: ~5% (sparingly, for specific semantic purposes)

### Accessibility

All color pairings must meet WCAG AA contrast ratio at a minimum. Use the color ramps to find appropriate pairings:
- White text on Jet Black: passes AAA
- Cyber Green on Jet Black: passes AA
- Electric Blue on Jet Black: passes AA

Reference: https://accessibleweb.com/color-contrast-checker/

## Typography

### Font Families

| Role              | Font                | Fallbacks                              |
|-------------------|---------------------|----------------------------------------|
| Body / Primary    | FK Grotesk          | Inter, system-ui, sans-serif           |
| Headlines         | FK Grotesk SemiMono | Inter, system-ui, sans-serif           |
| Subheaders        | FK Grotesk SemiMono | Inter, system-ui, sans-serif           |
| Buttons/Elements  | FK Grotesk Mono     | JetBrains Mono, Fira Code, monospace   |
| Brand wordmark    | Inter               | system-ui, sans-serif                  |
| Code/Data         | FK Grotesk Mono     | JetBrains Mono, Fira Code, monospace   |

FK Grotesk is a commercial font (licensed). Font files are **not committed to git**. See `public/fonts/README.md` for setup instructions.

### Type Hierarchy

| Level                    | Font              | Weight  | Style      |
|--------------------------|-------------------|---------|------------|
| Headlines (h1)           | FK Grotesk SemiMono | Regular | Normal     |
| Subheaders (h2, h3)      | FK Grotesk SemiMono | Regular | Normal     |
| Body Copy                | FK Grotesk        | Regular | Normal     |
| Body Strong / Highlighted | FK Grotesk       | Strong (700) | Normal  |
| Buttons & UI Elements    | FK Grotesk Mono   | Regular | UPPERCASE, letter-spacing 0.05em |

### CSS Variables

```css
:root {
    --font-primary: 'FK Grotesk', 'Inter', system-ui, -apple-system, sans-serif;
    --font-headline: 'FK Grotesk Mono', 'Inter', system-ui, sans-serif;
    --font-brand: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'FK Grotesk Mono', 'JetBrains Mono', 'Fira Code', monospace;
}
```

## Iconography

We use the **IBM Carbon Design** icon kit -- an open-source, free icon kit with over 2,000 icons available.

Library: https://carbondesignsystem.com/elements/icons/library/

In practice, we currently use Material Design Icons (mdi) via Vuetify. Carbon icons can be adopted incrementally.

## Logo

The primary logo is the Lovelace wordmark with the circular green-dot badge:
- **White version** (for dark backgrounds): `LL-logo-full-wht.svg`
- Located in `public/LL-logo-full-wht.svg`

## Visual Effects (Optional)

These effects can be applied sparingly for branded sections:

- **Grid pattern**: Subtle grid lines at 20px intervals
- **Dot pattern**: Punch-card aesthetic with radial dots at 16px intervals
- **Glow effects**: Colored box-shadows (green, orange, blue) at 0.3 opacity
- **Text glow**: Green text-shadow for emphasis

## CSS Variable Reference

All Brand R2 CSS variables are defined in `app.vue` under `:root`:

```css
:root {
    /* Core */
    --lv-black: #0A0A0A;
    --lv-surface: #141414;
    --lv-surface-light: #1E1E1E;
    --lv-white: #FFFFFF;
    --lv-silver: #757575;

    /* Primary */
    --lv-green: #3FEA00;
    --lv-green-dim: #30BC00;
    --lv-green-light: #57FF19;

    /* Secondary */
    --lv-orange: #FF5C00;
    --lv-orange-dim: #D04E02;
    --lv-blue: #003BFF;
    --lv-blue-dim: #0230D0;
    --lv-blue-light: #2E5DFF;

    /* Semantic */
    --lv-yellow: #FF9F0A;
    --lv-finance-blue: #003BFF;
}
```

## Implementation Notes

- The News UI uses a single dark theme ("brand") defined in `composables/useNewsTheme.ts`
- Theme-aware CSS utility classes are in `assets/theme-styles.css`
- The `useThemeClasses` composable provides pre-built class combinations for components
- Vuetify is configured with `defaultTheme: "dark"` in `nuxt.config.ts`
