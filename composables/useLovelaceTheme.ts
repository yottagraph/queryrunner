import { computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';

export const themeColors = {
    brand: {
        primary: '#3FEA00', // Cyber Green
        secondary: '#FF5C00', // Blaze Orange
        accent: '#003BFF', // Electric Blue
        background: '#0A0A0A', // Jet Black
        surface: '#141414',
        cardBackground: '#1E1E1E',
        panelBackground: '#111111',
        textPrimary: '#FFFFFF',
        textSecondary: '#A0AEC0',
        textMuted: '#757575', // Sonic Silver
        hover: '#1E1E1E',
        border: '#2A2A2A',
        success: '#3FEA00', // Cyber Green
        warning: '#FF9F0A', // Amber
        error: '#EF4444',
        headerGradientStart: '#0A0A0A',
        headerGradientEnd: '#141414',
    },
};

export const useLovelaceTheme = () => {
    const theme = useTheme();

    const currentThemeColors = computed(() => themeColors.brand);

    const applyThemeCssVariables = () => {
        if (typeof window === 'undefined') return;
        const colors = themeColors.brand;
        const root = document.documentElement;

        root.style.setProperty('--dynamic-primary', colors.primary);
        root.style.setProperty('--dynamic-secondary', colors.secondary);
        root.style.setProperty('--dynamic-accent', colors.accent);
        root.style.setProperty('--dynamic-background', colors.background);
        root.style.setProperty('--dynamic-surface', colors.surface);
        root.style.setProperty('--dynamic-card-background', colors.cardBackground);
        root.style.setProperty('--dynamic-panel-background', colors.panelBackground);
        root.style.setProperty('--dynamic-text-primary', colors.textPrimary);
        root.style.setProperty('--dynamic-text-secondary', colors.textSecondary);
        root.style.setProperty('--dynamic-text-muted', colors.textMuted);
        root.style.setProperty('--dynamic-hover', colors.hover);
        root.style.setProperty('--dynamic-border', colors.border);
        root.style.setProperty('--dynamic-success', colors.success);
        root.style.setProperty('--dynamic-warning', colors.warning);
        root.style.setProperty('--dynamic-error', colors.error);
        root.style.setProperty('--dynamic-header-gradient-start', colors.headerGradientStart);
        root.style.setProperty('--dynamic-header-gradient-end', colors.headerGradientEnd);
    };

    onMounted(() => {
        applyThemeCssVariables();
        theme.change('lovelaceDark');
    });

    if (typeof window !== 'undefined') {
        applyThemeCssVariables();
        theme.change('lovelaceDark');
    }

    return {
        currentThemeColors,
    };
};
