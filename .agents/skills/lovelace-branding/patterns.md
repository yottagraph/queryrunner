# Lovelace CSS Patterns

Framework-agnostic CSS patterns for implementing Lovelace brand styling. These patterns are extracted from the News UI theme styles and can be adapted for React, Vue, Tailwind, or plain CSS.

## Card Styling

### Basic Card

```css
.card {
    background-color: var(--lv-surface);
    border: 1px solid #2A2A2A;
    color: var(--lv-white);
}
```

### Card Header with Gradient

```css
.card-header {
    background: linear-gradient(135deg, var(--lv-surface), var(--lv-surface-light));
    border-bottom: 1px solid var(--lv-green-dim);
    color: var(--lv-white);
    padding: 12px 16px;
    height: 56px;
}
```

### Metric Card

```css
.metric-card {
    background-color: var(--lv-surface);
    border: 1px solid #2A2A2A;
    color: var(--lv-white);
}

.metric-label {
    color: #A0AEC0;
    font-size: 0.875rem;
}

.metric-value {
    color: var(--lv-white);
    font-weight: 600;
}
```

## Button Patterns

### Active/Selected Button

```css
.btn-active {
    background-color: var(--lv-green);
    color: var(--lv-black);
    border-color: var(--lv-green);
    font-weight: 600;
    box-shadow: 0 0 12px rgba(63, 234, 0, 0.3);
}
```

### Inactive Button

```css
.btn-inactive {
    background-color: transparent;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid #2A2A2A;
}

.btn-inactive:hover {
    background-color: rgba(255, 255, 255, 0.1);
}
```

### Button Group Sizing

```css
.btn-group .btn {
    transition: all 0.2s ease;
    border-radius: 4px;
    padding: 0 16px;
    min-height: 36px;
    letter-spacing: normal;
    text-transform: none;
    font-weight: 500;
}
```

## Data Table Patterns

```css
.data-table {
    background-color: var(--lv-surface);
}

.data-table th {
    background-color: #111111;
    color: var(--lv-white);
}

.data-table td {
    color: var(--lv-white);
    border-bottom: 1px solid #2A2A2A;
}
```

## List Patterns

### Interactive List

```css
.list {
    background-color: transparent;
}

.list-item {
    color: var(--lv-white);
    background-color: transparent;
}

.list-item:hover {
    background-color: var(--lv-surface-light);
}
```

### List Item States

```css
.list-item-title {
    color: var(--lv-white);
}

.list-item-subtitle {
    color: #A0AEC0;
}

.list-item-disabled .list-item-title {
    color: #A0AEC0;
    opacity: 0.6;
}
```

## Text Utility Classes

```css
.text-primary {
    color: var(--lv-white);
}

.text-secondary {
    color: #A0AEC0;
}

.text-muted {
    color: var(--lv-silver);
}
```

## Background Colors

```css
.bg-surface {
    background-color: var(--lv-surface);
}

.bg-card {
    background-color: var(--lv-surface-light);
}

.bg-panel {
    background-color: #111111;
}
```

## Input Styling

```css
.input:focus {
    background-color: rgba(255, 255, 255, 0.08);
}

.input {
    color: white;
}
```

## Visual Effects

### Glow Effects

```css
.glow-green {
    box-shadow: 0 0 12px rgba(63, 234, 0, 0.3);
}

.glow-orange {
    box-shadow: 0 0 12px rgba(255, 92, 0, 0.3);
}

.glow-blue {
    box-shadow: 0 0 12px rgba(0, 59, 255, 0.3);
}
```

### Text Glow

```css
.text-glow {
    text-shadow: 0 0 8px rgba(63, 234, 0, 0.5);
}
```

### Border Accent

```css
.border-accent {
    border-color: var(--lv-green-dim);
}
```

## CSS Variable Naming Conventions

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--lv-*` | Brand colors (static) | `--lv-green`, `--lv-surface` |
| `--theme-*` | Theme-aware aliases | `--theme-primary`, `--theme-text` |
| `--dynamic-*` | JS-set runtime values | `--dynamic-primary`, `--dynamic-surface` |
| `--font-*` | Typography | `--font-primary`, `--font-mono` |

## Framework Adaptation Notes

### React

Use CSS modules or styled-components. Import the CSS variables in your global styles.

### Vue

Use scoped styles with `<style scoped>`. The variables work naturally with Vue's reactivity.

### Tailwind

Extend your `tailwind.config.js` with the brand colors:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        'lv-black': '#0A0A0A',
        'lv-green': '#3FEA00',
        'lv-surface': '#141414',
        // ...
      }
    }
  }
}
```

### Plain CSS

Include the CSS variables in your `:root` and use them directly.
