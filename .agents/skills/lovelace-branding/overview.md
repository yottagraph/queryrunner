# Lovelace Branding Quick Reference

Quick-start guide for implementing Lovelace visual identity.

## Key Principles

- **Dark-first**: Jet Black (#0A0A0A) backgrounds, white text
- **Green accents**: Cyber Green (#3FEA00) for interactive elements, CTAs, success states
- **WCAG AA accessibility**: All color pairings meet minimum contrast requirements
- **Monospace for emphasis**: FK Grotesk Mono for headlines, buttons, code
- **Minimal decoration**: Clean surfaces, subtle borders, purposeful color

## Quick Start

Minimal CSS variable setup to get started:

```css
:root {
    /* Core colors */
    --lv-black: #0A0A0A;
    --lv-white: #FFFFFF;
    --lv-green: #3FEA00;
    --lv-silver: #757575;

    /* Surfaces */
    --lv-surface: #141414;
    --lv-surface-light: #1E1E1E;

    /* Typography */
    --font-primary: 'FK Grotesk', 'Inter', system-ui, sans-serif;
    --font-headline: 'FK Grotesk Mono', 'Inter', system-ui, sans-serif;
    --font-mono: 'FK Grotesk Mono', 'JetBrains Mono', monospace;
}
```

## Core Colors

| Name | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Jet Black | `#0A0A0A` | `--lv-black` | Primary backgrounds |
| Pure White | `#FFFFFF` | `--lv-white` | Primary text on dark surfaces |
| Sonic Silver | `#757575` | `--lv-silver` | Muted text, secondary elements |
| Cyber Green | `#3FEA00` | `--lv-green` | Primary accent, CTAs, success |

## Secondary Colors

| Name | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Electric Blue | `#003BFF` | `--lv-blue` | Accent, links, finance/data |
| Blaze Orange | `#FF5C00` | `--lv-orange` | Warnings, highlights, secondary CTA |
| Amber | `#FF9F0A` | `--lv-yellow` | Warnings |
| Red | `#EF4444` | — | Errors |

## Surface Colors

| Name | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Surface | `#141414` | `--lv-surface` | Card backgrounds, elevated surfaces |
| Surface Light | `#1E1E1E` | `--lv-surface-light` | Hover states, lighter panels |
| Panel | `#111111` | — | Table headers, dark panels |
| Border | `#2A2A2A` | — | Subtle borders |

## Color Usage Proportions

- **70%** — Jet Black + Pure White (dark backgrounds, white text)
- **15%** — Cyber Green (accents, interactive elements, success states)
- **10%** — Sonic Silver (muted text, borders, secondary elements)
- **5%** — Electric Blue + Blaze Orange (sparingly, for specific semantic purposes)

## Typography

### Font Families

| Role | Font | CSS Variable |
|------|------|--------------|
| Body / Primary | FK Grotesk | `--font-primary` |
| Headlines | FK Grotesk Mono | `--font-headline` |
| Buttons / Code | FK Grotesk Mono | `--font-mono` |
| Brand wordmark | Inter | `--font-brand` |

### Type Hierarchy

| Level | Font | Weight | Style |
|-------|------|--------|-------|
| Headlines (h1) | FK Grotesk Mono | Regular | Normal |
| Subheaders (h2, h3) | FK Grotesk Mono | Regular | Normal |
| Body Copy | FK Grotesk | Regular | Normal |
| Body Strong | FK Grotesk | Bold (700) | Normal |
| Buttons & UI | FK Grotesk Mono | Regular | UPPERCASE, letter-spacing 0.05em |

## Full CSS Variables

Complete `:root` block for all brand variables:

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

    /* Typography */
    --font-primary: 'FK Grotesk', 'Inter', system-ui, -apple-system, sans-serif;
    --font-headline: 'FK Grotesk Mono', 'Inter', system-ui, sans-serif;
    --font-brand: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'FK Grotesk Mono', 'JetBrains Mono', 'Fira Code', monospace;
}
```

## Accessibility

All color pairings must meet WCAG AA contrast ratio at minimum:

- White text on Jet Black: **passes AAA**
- Cyber Green on Jet Black: **passes AA**
- Electric Blue on Jet Black: **passes AA**

Use the color ramps (see BRANDING.md) to find appropriate pairings for other combinations.
