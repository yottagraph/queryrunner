<template>
    <v-app-bar
        app
        density="default"
        :style="{
            background: `linear-gradient(135deg, ${currentThemeColors.headerGradientStart}, ${currentThemeColors.headerGradientEnd})`,
            color: '#ffffff',
        }"
    >
        <div class="d-flex align-center app-header-title">
            <img src="/LL-logo-full-wht.svg" alt="Lovelace" class="header-logo" />
            <span class="app-title-text">{{ appName }}</span>
            <span class="app-version-text">{{ buildString }}</span>
        </div>

        <!-- Spacer to center the title -->
        <v-spacer></v-spacer>

        <!-- Settings Gear -->
        <v-tooltip :text="`Settings (${modKey}G)`">
            <template v-slot:activator="{ props: tooltipProps }">
                <v-btn
                    icon
                    v-bind="tooltipProps"
                    data-testid="settings-button"
                    @click="state.showSettingsDialog = true"
                    class="ml-1"
                    color="white"
                >
                    <v-icon icon="mdi-cog" color="white"></v-icon>
                </v-btn>
            </template>
        </v-tooltip>

        <!-- User Avatar Menu -->
        <v-menu>
            <template v-slot:activator="{ props: menu }">
                <v-tooltip :text="userName">
                    <template v-slot:activator="{ props: tooltip }">
                        <v-btn
                            icon
                            v-bind="mergeProps(menu, tooltip)"
                            data-testid="user-menu-button"
                            class="ml-1"
                            color="white"
                        >
                            <v-avatar size="32" color="primary">
                                <img
                                    v-if="avatarUrl && !avatarHasError"
                                    :alt="userName"
                                    :src="avatarUrl"
                                    style="width: 100%; height: 100%; object-fit: cover"
                                    crossorigin="anonymous"
                                    referrerpolicy="no-referrer"
                                    @error="handleImageError"
                                    @load="handleImageLoad"
                                />
                                <span v-else class="text-h6" style="color: white">{{
                                    userInitials
                                }}</span>
                            </v-avatar>
                        </v-btn>
                    </template>
                </v-tooltip>
            </template>
            <v-list>
                <v-list-item data-testid="logout-button" @click="handleLogout">
                    <v-list-item-title>Log Out</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
    </v-app-bar>
</template>

<script setup lang="ts">
    import { mergeProps, watch } from 'vue';

    import { useLovelaceTheme } from '~/composables/useLovelaceTheme';
    import { useUserState } from '~/composables/useUserState';
    import { useProxiedAvatar } from '~/composables/useProxiedAvatar';

    import { state } from '~/utils/appState';

    const { currentThemeColors } = useLovelaceTheme();
    const { clearUser, userPicture, userName } = useUserState();
    const { appName } = useAppInfo();
    const router = useRouter();

    // Use proxied avatar URL to avoid 429 errors from Google
    const { proxiedUrl: avatarUrl } = useProxiedAvatar(userPicture);

    // Build string for version display
    const buildString = ref(useRuntimeConfig().public.versionString);

    // Track avatar loading errors
    const avatarHasError = ref(false);

    // Handle logout - navigate to logout route to trigger middleware
    const handleLogout = () => {
        router.push('/logout');
    };

    const isMacPlatform = computed(() => {
        return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    });

    const modKey = computed(() => (isMacPlatform.value ? '⇧⌘' : 'Alt+Shift+'));

    // Compute user initials for fallback avatar
    const userInitials = computed(() => {
        if (!userName.value) return '?';
        const names = userName.value.split(' ');
        if (names.length >= 2) {
            return names[0][0] + names[names.length - 1][0];
        }
        return userName.value.substring(0, 2).toUpperCase();
    });

    // Handle image loading errors
    const handleImageError = (event: Event) => {
        console.error('Avatar image failed to load:', {
            originalUrl: userPicture.value,
            proxiedUrl: avatarUrl.value,
            error: event,
            type: event.type,
        });
        avatarHasError.value = true;
    };

    // Handle successful image load
    const handleImageLoad = () => {
        console.log('Avatar image loaded successfully');
        avatarHasError.value = false;
    };

    // Reset error state when avatar URL changes
    watch(avatarUrl, (newUrl) => {
        console.log('Avatar URL changed:', newUrl);
        avatarHasError.value = false;
    });
</script>

<style scoped>
    .app-header-title {
        display: flex;
        align-items: center;
    }

    .header-logo {
        height: 1.5rem;
        width: auto;
        margin-left: 16px;
        margin-right: 12px;
    }

    .app-title-text {
        font-family: var(--font-headline);
        font-weight: 400;
        letter-spacing: 0.05em;
        font-size: 1.25rem;
        line-height: 1.2;
    }

    .app-version-text {
        font-family: var(--font-mono);
        font-weight: 400;
        font-size: 0.7rem;
        opacity: 0.5;
        margin-left: 8px;
        position: relative;
        top: 2px;
    }
</style>
