import { computed } from 'vue';
import { useLovelaceTheme } from './useLovelaceTheme';

/**
 * Composable that provides theme-aware CSS classes and utilities.
 * Simplified for Brand R2 single-theme mode.
 */
export const useThemeClasses = () => {
    const { currentThemeColors } = useLovelaceTheme();

    // Static theme class -- always "theme-brand"
    const themeClass = computed(() => 'theme-brand');

    // Pre-built class combinations for common patterns
    const cardClasses = computed(() => ['theme-card', 'theme-brand']);

    const cardHeaderClasses = computed(() => ['card-header-gradient', 'theme-brand']);

    const metricCardClasses = computed(() => ['theme-metric-card', 'theme-brand']);

    // Theme-aware text classes
    const textClasses = {
        primary: 'theme-text-primary',
        secondary: 'theme-text-secondary',
        muted: 'theme-text-muted',
    };

    // Theme-aware background classes
    const bgClasses = {
        surface: 'theme-bg-surface',
        card: 'theme-bg-card',
        panel: 'theme-bg-panel',
    };

    // Data table classes
    const dataTableClasses = computed(() => ['theme-data-table', 'theme-brand']);

    // List classes
    const listClasses = computed(() => ['theme-list', 'theme-brand']);

    // Helper function to generate theme-specific inline styles if needed
    const getInlineThemeStyles = () => {
        return {
            '--theme-primary': currentThemeColors.value.primary,
            '--theme-accent': currentThemeColors.value.accent,
            '--theme-background': currentThemeColors.value.background,
            '--theme-surface': currentThemeColors.value.surface,
            '--theme-card-background': currentThemeColors.value.cardBackground,
            '--theme-text': currentThemeColors.value.textPrimary,
            '--theme-text-secondary': currentThemeColors.value.textSecondary,
            '--theme-border': currentThemeColors.value.border,
            '--theme-header-gradient-start': currentThemeColors.value.headerGradientStart,
            '--theme-header-gradient-end': currentThemeColors.value.headerGradientEnd,
        };
    };

    return {
        // Base theme class
        themeClass,

        // Pre-built class combinations
        cardClasses,
        cardHeaderClasses,
        metricCardClasses,
        dataTableClasses,
        listClasses,

        // Individual utility classes
        textClasses,
        bgClasses,

        // Inline styles helper
        getInlineThemeStyles,

        // Direct access to theme colors
        themeColors: currentThemeColors,
    };
};
