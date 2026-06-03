<template>
    <v-toolbar
        density="compact"
        rounded="t"
        :style="{
            background: `linear-gradient(135deg, ${currentThemeColors.headerGradientStart}, ${currentThemeColors.headerGradientEnd})`,
            color: '#ffffff',
        }"
        class="px-3"
    >
        <v-icon v-if="icon" class="mr-2" color="white">{{ icon }}</v-icon>
        <v-toolbar-title :style="{ color: '#ffffff' }">{{ title }}</v-toolbar-title>

        <v-spacer />

        <slot name="actions">
            <!-- Default slot for action buttons -->
        </slot>
    </v-toolbar>
</template>

<script setup lang="ts">
    import { useLovelaceTheme } from '~/composables/useLovelaceTheme';

    interface Props {
        title: string;
        icon?: string;
    }

    defineProps<Props>();

    const { currentThemeColors } = useLovelaceTheme();
</script>

<style scoped>
    /* Ensure all text and icons in the toolbar are white */
    :deep(.v-toolbar__content) {
        color: white;
    }

    :deep(.v-btn) {
        color: white;
    }

    :deep(.v-icon) {
        color: white;
    }
</style>
