# UI Patterns

## Vuetify Layout System

- Use `fill-height` class on containers that need full height
- Use Vuetify components (`v-card`, `v-btn`, `v-data-table`) over custom implementations
- Use Vuetify spacing utilities (`pa-4`, `ma-2`) and grid system (`v-row`, `v-col`)

## Page Layout Template

For pages with a header and scrollable content, use flexbox:

- `d-flex flex-column` on the column container
- `flex-shrink-0` on fixed elements (header, toolbar)
- `flex-grow-1 overflow-y-auto` on scrollable content
- Never use `calc(100vh - Xpx)` -- let flexbox handle sizing
- Never nest multiple scroll containers

Full page template covering all four data states (loading, error, empty, content):

```vue
<template>
    <div class="d-flex flex-column fill-height">
        <div class="flex-shrink-0 pa-4">
            <PageHeader title="Page Title" icon="mdi-view-dashboard" />
        </div>
        <div class="flex-grow-1 overflow-y-auto pa-4">
            <v-progress-circular v-if="loading" indeterminate class="ma-auto d-block" />
            <v-alert v-else-if="error" type="error" variant="tonal" closable>
                {{ error }}
            </v-alert>
            <v-empty-state
                v-else-if="!items.length"
                headline="No data yet"
                icon="mdi-database-off"
            />
            <div v-else>
                <!-- Content here -->
            </div>
        </div>
    </div>
</template>
```

## Dialogs

- Cards inside `v-dialog` automatically get `variant="flat"` (solid background) via the nested Vuetify default in `nuxt.config.ts`. No manual override needed.
- Use `v-card` directly inside `v-dialog` — it will have a solid surface background despite the global `outlined` default.
- See [cookbook.md](cookbook.md) in this skill for a full dialog pattern.

## Loading States

Use `v-progress-circular` for inline loading and `v-skeleton-loader` for layout-preserving placeholders:

```vue
<v-progress-circular v-if="loading" indeterminate />
<div v-else>
    <!-- Content -->
</div>
```

## Data Tables

```vue
<v-data-table :headers="headers" :items="items" :loading="loading" density="comfortable" hover>
    <template v-slot:item.actions="{ item }">
        <v-btn icon size="small" @click="selectItem(item)">
            <v-icon>mdi-eye</v-icon>
        </v-btn>
    </template>
</v-data-table>
```
