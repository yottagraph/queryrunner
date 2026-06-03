<template>
    <svg
        v-if="points.length > 1"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        class="pass-spark"
        role="img"
        aria-label="Pass rate trend"
    >
        <polyline
            :points="polylinePoints"
            fill="none"
            stroke="var(--lv-green, #00ff9c)"
            stroke-width="1.5"
        />
        <circle
            v-for="(p, i) in coords"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            r="2"
            :fill="
                points[i] >= 1
                    ? 'var(--lv-green, #00ff9c)'
                    : points[i] === 0
                      ? '#ff5970'
                      : '#ffce4d'
            "
        />
    </svg>
    <div v-else class="pass-spark-empty">
        <v-icon size="small">mdi-chart-line-variant</v-icon>
        <span>Need ≥ 2 runs to plot a trend.</span>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue';

    interface Props {
        /** Pass rate per run, [0, 1]. */
        points: number[];
        width?: number;
        height?: number;
    }

    const props = withDefaults(defineProps<Props>(), {
        width: 220,
        height: 40,
    });

    const coords = computed(() => {
        const n = props.points.length;
        if (n === 0) return [];
        const stepX = n > 1 ? props.width / (n - 1) : 0;
        return props.points.map((rate, i) => ({
            x: i * stepX,
            y: props.height - rate * (props.height - 4) - 2,
        }));
    });

    const polylinePoints = computed(() =>
        coords.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    );
</script>

<style scoped>
    .pass-spark {
        display: block;
    }

    .pass-spark-empty {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--lv-silver, #94a3b8);
        font-size: 0.85rem;
    }
</style>
