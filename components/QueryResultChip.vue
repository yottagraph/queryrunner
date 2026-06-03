<template>
    <v-chip :color="color" :prepend-icon="icon" size="small" variant="tonal" :title="title">
        {{ label }}
    </v-chip>
</template>

<script setup lang="ts">
    import { computed } from 'vue';

    interface Props {
        pass?: boolean | null;
        error?: string | null;
        durationMs?: number | null;
    }

    const props = defineProps<Props>();

    const color = computed(() => {
        if (props.error) return 'warning';
        if (props.pass === true) return 'success';
        if (props.pass === false) return 'error';
        return 'default';
    });

    const icon = computed(() => {
        if (props.error) return 'mdi-alert-circle-outline';
        if (props.pass === true) return 'mdi-check-circle-outline';
        if (props.pass === false) return 'mdi-close-circle-outline';
        return 'mdi-help-circle-outline';
    });

    const label = computed(() => {
        if (props.error) return 'error';
        if (props.pass === true) return 'pass';
        if (props.pass === false) return 'fail';
        return 'not run';
    });

    const title = computed(() => {
        if (props.error) return props.error;
        if (typeof props.durationMs === 'number') return `${props.durationMs} ms`;
        return '';
    });
</script>
