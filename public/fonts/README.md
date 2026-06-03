# Fonts

This directory contains custom fonts served as static files.

## FK Grotesk

FK Grotesk is a commercial font. The font files are **not committed to git**.

### Setup

1. Obtain the FK Grotesk font files from your license
2. Place the `.otf` files in this directory. Required files:

**FK Grotesk (Proportional):**

- `FKGrotesk-Thin.otf`, `FKGrotesk-ThinItalic.otf`
- `FKGrotesk-Light.otf`, `FKGrotesk-LightItalic.otf`
- `FKGrotesk-Regular.otf`, `FKGrotesk-Italic.otf`
- `FKGrotesk-Medium.otf`, `FKGrotesk-MediumItalic.otf`
- `FKGrotesk-Bold.otf`, `FKGrotesk-BoldItalic.otf`
- `FKGrotesk-Black.otf`, `FKGrotesk-BlackItalic.otf`

**FK Grotesk Mono:**

- `FKGroteskMono-Thin.otf`, `FKGroteskMono-ThinItalic.otf`
- `FKGroteskMono-Light.otf`, `FKGroteskMono-LightItalic.otf`
- `FKGroteskMono-Regular.otf`, `FKGroteskMono-Italic.otf`
- `FKGroteskMono-Medium.otf`, `FKGroteskMono-MediumItalic.otf`
- `FKGroteskMono-Bold.otf`, `FKGroteskMono-BoldItalic.otf`
- `FKGroteskMono-Black.otf`, `FKGroteskMono-BlackItalic.otf`

3. The CSS in `assets/fonts.css` references them via `/fonts/`

### Minimum Required Weights

If you don't have the full set, at minimum you need:

- `FKGrotesk-Regular.otf` (body text)
- `FKGrotesk-Bold.otf` (strong text)
- `FKGroteskMono-Regular.otf` (headlines, buttons, code)

### Usage

```css
font-family: 'FK Grotesk', sans-serif; /* Body text */
font-family: 'FK Grotesk Mono', monospace; /* Headlines, buttons, code */
```

### Fallback

When FK Grotesk is not installed, the CSS falls back to Inter (system font).

### Deployment

For Cloud Run deployment, fonts must be included in the Docker build.
Since fonts are git-ignored, you'll need to:

1. Copy fonts to this directory before building
2. Or mount them as a secret/volume in Cloud Run
3. Or use a CI/CD step to fetch them from secure storage
