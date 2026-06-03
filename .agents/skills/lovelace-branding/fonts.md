# Lovelace Font Setup

FK Grotesk is the primary font family for Lovelace branding. This document covers setup, fallbacks, and deployment considerations.

## Required Font Files

FK Grotesk is a commercial font. Font files are **not committed to git**.

### Minimum Required

At minimum, you need these three files:

- `FKGrotesk-Regular.otf` — Body text
- `FKGrotesk-Bold.otf` — Strong text
- `FKGroteskMono-Regular.otf` — Headlines, buttons, code

### Full Set (Optional)

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

## @font-face Declarations

```css
@font-face {
    font-family: 'FK Grotesk';
    src: url('/fonts/FKGrotesk-Regular.otf') format('opentype');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
}

@font-face {
    font-family: 'FK Grotesk';
    src: url('/fonts/FKGrotesk-Bold.otf') format('opentype');
    font-weight: 700;
    font-style: normal;
    font-display: swap;
}

@font-face {
    font-family: 'FK Grotesk Mono';
    src: url('/fonts/FKGroteskMono-Regular.otf') format('opentype');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
}
```

## CSS Variable Setup

```css
:root {
    --font-primary: 'FK Grotesk', 'Inter', system-ui, -apple-system, sans-serif;
    --font-headline: 'FK Grotesk Mono', 'Inter', system-ui, sans-serif;
    --font-brand: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'FK Grotesk Mono', 'JetBrains Mono', 'Fira Code', monospace;
}
```

## Fallback Strategy

When FK Grotesk is not available, the CSS falls back gracefully:

| Role | Primary | Fallback |
|------|---------|----------|
| Body text | FK Grotesk | Inter, system-ui |
| Headlines | FK Grotesk Mono | Inter, system-ui |
| Code/Buttons | FK Grotesk Mono | JetBrains Mono, Fira Code |
| Brand wordmark | Inter | system-ui |

**Inter** is a widely available system font on modern operating systems and provides a similar aesthetic to FK Grotesk.

**JetBrains Mono** is a free, open-source monospace font that works well as a fallback for FK Grotesk Mono.

## Usage Examples

```css
/* Body text */
body {
    font-family: var(--font-primary);
}

/* Headlines */
h1, h2, h3 {
    font-family: var(--font-headline);
}

/* Buttons */
button {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

/* Code blocks */
code, pre {
    font-family: var(--font-mono);
}
```

## Deployment Considerations

### Static Hosting

Place font files in your `public/fonts/` directory. They'll be served as static assets.

### Docker

Include fonts in your Docker build. Since fonts are git-ignored, add them before building:

```dockerfile
COPY fonts/ /app/public/fonts/
```

### Cloud Run / Kubernetes

Options:
1. Copy fonts to the image before building
2. Mount fonts as a secret or ConfigMap volume
3. Fetch fonts from secure storage in a CI/CD step

### CI/CD

Add a step to fetch fonts from secure storage (e.g., GCS bucket, 1Password) before building:

```yaml
- name: Fetch fonts
  run: gsutil cp gs://your-bucket/fonts/*.otf public/fonts/
```

## Licensing

FK Grotesk requires a commercial license. Contact the font foundry for licensing terms. Do not commit font files to public repositories.
