<template>
    <div class="home-page">
        <div class="home-content">
            <div class="hero-section">
                <img src="/LL-logo-full-wht.svg" alt="Lovelace" class="hero-logo" />
                <h1 class="hero-title">{{ appName || 'Welcome to Aether' }}</h1>
                <p class="hero-subtitle">Your AI-powered workspace is ready.</p>
            </div>

            <div class="getting-started">
                <h2 class="section-title">Getting Started</h2>
                <div class="steps-grid">
                    <div class="step-item">
                        <span class="step-number">1</span>
                        <div>
                            <div class="step-title">Describe what you want</div>
                            <div class="step-desc">
                                Edit <code>DESIGN.md</code> with your project vision. The AI agent
                                reads this first to understand what to build.
                            </div>
                        </div>
                    </div>
                    <div class="step-item">
                        <span class="step-number">2</span>
                        <div>
                            <div class="step-title">Build it</div>
                            <div class="step-desc">
                                Run <code>/build_my_app</code> in Cursor. The agent will design and
                                implement your app based on the brief.
                            </div>
                        </div>
                    </div>
                    <div class="step-item">
                        <span class="step-number">3</span>
                        <div>
                            <div class="step-title">Deploy</div>
                            <div class="step-desc">
                                Push to main to auto-deploy on Vercel. Use
                                <code>/deploy_agent</code> or <code>/deploy_mcp</code> for backend
                                services.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    const { appName } = useAppInfo();
</script>

<style scoped>
    .home-page {
        height: 100%;
        overflow-y: auto;
        display: flex;
        justify-content: center;
        padding: 48px 24px;
    }

    .home-content {
        max-width: 720px;
        width: 100%;
    }

    .hero-section {
        text-align: center;
        margin-bottom: 48px;
    }

    .hero-logo {
        height: 2rem;
        width: auto;
        margin-bottom: 24px;
        opacity: 0.6;
    }

    .hero-title {
        font-family: var(--font-headline);
        font-weight: 400;
        font-size: 2rem;
        letter-spacing: 0.02em;
        margin-bottom: 8px;
    }

    .hero-subtitle {
        color: var(--lv-silver);
        font-size: 1.1rem;
    }

    .getting-started {
        margin-bottom: 48px;
    }

    .section-title {
        font-family: var(--font-headline);
        font-weight: 400;
        font-size: 1.1rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--lv-silver);
        margin-bottom: 20px;
    }

    .steps-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .step-item {
        display: flex;
        gap: 16px;
        align-items: flex-start;
    }

    .step-number {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--lv-surface);
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-mono);
        font-size: 0.8rem;
        color: var(--lv-green);
        margin-top: 2px;
    }

    .step-title {
        font-weight: 500;
        margin-bottom: 2px;
    }

    .step-desc {
        color: var(--lv-silver);
        font-size: 0.875rem;
        line-height: 1.4;
    }

    .step-desc code {
        font-size: 0.85em;
        padding: 1px 5px;
    }
</style>
