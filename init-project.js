#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Parse command line arguments
const rawArgs = process.argv.slice(2);
const args = {
    _: [],
    'non-interactive': rawArgs.includes('--non-interactive'),
    help: rawArgs.includes('--help') || rawArgs.includes('-h'),
    'skip-install': rawArgs.includes('--skip-install'),
    'no-include-examples': rawArgs.includes('--no-include-examples'),
    local: rawArgs.includes('--local'),
};

// Parse key-value pairs
for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--') && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
        const key = arg.slice(2);
        args[key] = rawArgs[i + 1];
        i++; // Skip the value
    } else if (
        arg.startsWith('-') &&
        arg.length === 2 &&
        i + 1 < rawArgs.length &&
        !rawArgs[i + 1].startsWith('-')
    ) {
        const key = arg.slice(1);
        args[key] = rawArgs[i + 1];
        i++; // Skip the value
    }
}

// Map short flags to long names
if (args.n) args.name = args.n;
if (args.i) args.id = args.i;
if (args.s) args.server = args.s;

// Extract an indented block for a top-level YAML section, stopping at the next
// top-level key (a line starting with a non-space, non-# character followed by `:`).
function yamlSection(yaml, sectionName) {
    const sectionRe = new RegExp(`^${sectionName}:\\s*$`, 'm');
    const sectionStart = yaml.search(sectionRe);
    if (sectionStart === -1) return '';
    const afterHeader = yaml.indexOf('\n', sectionStart);
    if (afterHeader === -1) return '';
    const rest = yaml.slice(afterHeader + 1);
    const nextSection = rest.search(/^\S.*:/m);
    return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function yamlSectionUrl(yaml, sectionName) {
    const block = yamlSection(yaml, sectionName);
    const match = block.match(/url:\s*["']?(https?:\/\/[^\s"']+)/);
    return match ? match[1] : '';
}

function yamlSectionValue(yaml, sectionName, key) {
    const block = yamlSection(yaml, sectionName);
    const match = block.match(new RegExp(`${key}:\\s*["']?([^\\s"'#]+)`));
    return match ? match[1] : '';
}

/** Read `aether.data_mode` from broadchurch.yaml (api-mcp | mcp-only). */
function yamlAetherDataMode(yaml) {
    const block = yamlSection(yaml, 'aether');
    if (!block) return '';
    const match = block.match(/data_mode:\s*["']?([a-z0-9_-]+)/i);
    return match ? match[1] : '';
}

/** Read the top-level `hosting:` key from broadchurch.yaml (vercel | gcp). */
function yamlHosting(yaml) {
    const match = yaml.match(/^hosting:\s*["']?([a-z0-9_-]+)/im);
    return match ? match[1].toLowerCase() : '';
}

// The example pages safe to remove when a tenant opts out of examples.
// `pages/chat.vue` is special on BC 2.0 GKE tenants (`hosting: gcp`): it is
// the hosting-aware in-cluster agent UI (ENG-789), i.e. canonical
// infrastructure rather than a demo. Stripping it forces the coding agent to
// rebuild a page that should ship by default (ENG-792), so keep it for
// gcp-hosted tenants. Legacy/vercel tenants still get the clean slate.
function examplePagesToRemove(cwd) {
    const pages = ['entity-lookup.vue', 'chat.vue', 'mcp.vue'];
    const bcPath = path.join(cwd, 'broadchurch.yaml');
    if (fs.existsSync(bcPath)) {
        const yaml = fs.readFileSync(bcPath, 'utf-8');
        if (yamlHosting(yaml) === 'gcp') {
            return pages.filter((page) => page !== 'chat.vue');
        }
    }
    return pages;
}

// Keep package-lock.json's name fields in lockstep with package.json's
// renamed `name`. The template ships a lockfile generated under the name
// `aether`; without this, the first `npm install` in a renamed tenant repo
// rewrites the lockfile's `name` + `packages[""].name`, producing a noisy
// (and confusing) diff on the build agent's very first commit. We do it
// here at init time instead. No-op when the lockfile is absent.
function syncLockfileName(cwd, newName) {
    const lockPath = path.join(cwd, 'package-lock.json');
    if (!fs.existsSync(lockPath)) return;
    try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        let changed = false;
        if (lock.name && lock.name !== newName) {
            lock.name = newName;
            changed = true;
        }
        if (lock.packages && lock.packages[''] && lock.packages[''].name !== newName) {
            lock.packages[''].name = newName;
            changed = true;
        }
        if (changed) {
            fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
            console.log('✅ Synced package-lock.json name');
        }
    } catch (err) {
        console.warn(`⚠️  Could not sync package-lock.json name: ${err.message}`);
    }
}

function normalizeDataMode(raw) {
    if (!raw || typeof raw !== 'string') return 'api-mcp';
    const t = raw.trim().toLowerCase().replace(/_/g, '-');
    if (t === 'mcp-only') return 'mcp-only';
    return 'api-mcp';
}

function resolveDataModeForInit({ cliFlag, interactiveChoice, yamlText }) {
    if (cliFlag) return normalizeDataMode(cliFlag);
    if (interactiveChoice !== undefined && interactiveChoice !== null && interactiveChoice !== '')
        return normalizeDataMode(String(interactiveChoice));
    if (yamlText) {
        const y = yamlAetherDataMode(yamlText);
        if (y) return normalizeDataMode(y);
    }
    return 'api-mcp';
}

function writeAetherDataModeFile(mode) {
    ensureAgentsLayout();
    const agentsDir = path.join(process.cwd(), '.agents');
    fs.writeFileSync(path.join(agentsDir, '.aether-data-mode'), mode + '\n', 'utf-8');
}

// Ensure the tenant has:
//   .agents/          real directory (canonical home for commands, skills, mcp.json,
//                     environment.json, manifest/version markers)
//   .cursor  -> .agents    symlink (Cursor still reads .cursor/...)
//   .claude  -> .agents    symlink (Claude Code reads .claude/...)
//   .mcp.json -> .agents/mcp.json  symlink (Claude Code reads .mcp.json at repo root)
//
// Auto-migrates a legacy real .cursor/ directory into .agents/ on first run.
// Aborts only when we hit a genuine collision we can't resolve safely.
function ensureAgentsLayout() {
    const cwd = process.cwd();
    const cursorPath = path.join(cwd, '.cursor');
    const claudePath = path.join(cwd, '.claude');
    const agentsPath = path.join(cwd, '.agents');
    const mcpJsonPath = path.join(cwd, '.mcp.json');

    // lstat-based: returns the lstat result (or null) without following
    // symlinks. fs.existsSync follows symlinks, which falsely reports
    // "missing" for a symlink whose target doesn't exist yet (e.g. a fresh
    // tenant clone has .mcp.json -> .agents/mcp.json before init populates
    // the target), and then symlinkSync errors with EEXIST.
    const lexistsStat = (p) => {
        try {
            return fs.lstatSync(p);
        } catch {
            return null;
        }
    };
    const cursorLstat = lexistsStat(cursorPath);
    const claudeLstat = lexistsStat(claudePath);

    // Case 3: legacy real .cursor/ — migrate to .agents/
    if (cursorLstat && cursorLstat.isDirectory() && !cursorLstat.isSymbolicLink()) {
        const agentsLstat = lexistsStat(agentsPath);
        if (agentsLstat && !agentsLstat.isSymbolicLink()) {
            console.error(
                'Error: both .cursor/ and .agents/ exist as real paths. Resolve manually, then re-run.'
            );
            process.exit(1);
        }
        if (
            claudeLstat &&
            claudeLstat.isDirectory() &&
            !claudeLstat.isSymbolicLink() &&
            fs.readdirSync(claudePath).length > 0
        ) {
            console.error(
                'Error: .claude/ exists as a real directory with contents. Move or remove it, then re-run.'
            );
            process.exit(1);
        }
        fs.renameSync(cursorPath, agentsPath);
        console.log('✅ Migrated .cursor/ → .agents/');
    } else if (!cursorLstat) {
        // Case 2: fresh install — create .agents/
        fs.mkdirSync(agentsPath, { recursive: true });
    }
    // Case 1 (cursor is already a symlink) falls through — nothing to do.

    // Create symlinks when absent. Use relative targets so the tree is portable.
    if (!lexistsStat(cursorPath)) {
        fs.symlinkSync('.agents', cursorPath);
    }
    if (!lexistsStat(claudePath)) {
        fs.symlinkSync('.agents', claudePath);
    }
    if (!lexistsStat(mcpJsonPath)) {
        fs.symlinkSync(path.join('.agents', 'mcp.json'), mcpJsonPath);
    }
}

// Create readline interface
let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Helper function to ask questions with default values
function ask(question, defaultValue = '') {
    return new Promise((resolve) => {
        const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(prompt, (answer) => {
            resolve(answer || defaultValue);
        });
    });
}

// Helper function to ask yes/no questions
function askYesNo(question, defaultYes = true) {
    return new Promise((resolve) => {
        const defaultText = defaultYes ? '[Y/n]' : '[y/N]';
        rl.question(`${question} ${defaultText}: `, (answer) => {
            const response = answer.toLowerCase() || (defaultYes ? 'y' : 'n');
            resolve(response === 'y' || response === 'yes');
        });
    });
}

// Helper function to replace template placeholders
function replaceTemplatePlaceholders(content, replacements) {
    let result = content;
    for (const [placeholder, value] of Object.entries(replacements)) {
        const regex = new RegExp(`{{${placeholder}}}`, 'g');
        result = result.replace(regex, value);
    }
    return result;
}

// Helper function to get Git info
function getGitInfo() {
    try {
        // Get remote origin URL
        const remoteUrl = execSync('git config --get remote.origin.url', {
            encoding: 'utf-8',
        }).trim();

        // Extract owner and repo name from URL
        const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
        if (match) {
            return {
                owner: match[1],
                repo: match[2],
                isFromTemplate: true,
            };
        }
    } catch (error) {
        // Not a git repo or no remote
    }
    return null;
}

// Helper function to check if this is a fresh template
function isFreshTemplate() {
    try {
        // Check if we have exactly 1 commit (the initial template commit)
        const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
        return commitCount === '1';
    } catch (e) {
        return false;
    }
}

// Read the template version stamp (.aether-template) if present.
// Returns a short string like "aether-dev@abc1234 (2026-03-18)" or null.
function getTemplateVersion() {
    try {
        const stampPath = path.join(process.cwd(), '.aether-template');
        const content = fs.readFileSync(stampPath, 'utf-8');
        const source = content.match(/source:\s*(.+)/)?.[1]?.trim();
        const built = content.match(/built:\s*(.+)/)?.[1]?.trim();
        if (source) {
            const date = built ? ` (${built.split('T')[0]})` : '';
            return `${source}${date}`;
        }
    } catch {
        // No stamp file — running in aether-dev itself or pre-stamp template
    }
    return null;
}

// Helper function to generate unique app ID from name
function generateAppId(projectName) {
    // Convert to lowercase, replace spaces and special chars with hyphens
    let appId = projectName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // Add a timestamp suffix to ensure uniqueness
    const timestamp = Date.now().toString(36).substring(0, 4);
    return `${appId}-${timestamp}`;
}

// Main init function
async function init() {
    const templateVersion = getTemplateVersion();
    console.log('\n🌎 Aether 2.0 Project Initializer');
    if (templateVersion) console.log(`   Template: ${templateVersion}`);
    console.log('===========================\n');

    // Auto-detect GitHub info
    const gitInfo = getGitInfo();
    const isFresh = isFreshTemplate();

    if (gitInfo && isFresh) {
        console.log('🎯 Detected fresh GitHub repository created from template!');
        console.log(`   Repository: ${gitInfo.owner}/${gitInfo.repo}\n`);
    }

    console.log('Welcome! This wizard will help you set up your new Aether application.\n');
    console.log("Aether is a modular UI framework - you'll build your app by creating features!\n");

    // Step 1: Project Info
    console.log('📝 Step 1: Project Information\n');

    // Use repo name as default if available
    const defaultProjectName = gitInfo?.repo || 'my-awesome-app';
    const projectName = await ask('Project name', defaultProjectName);
    const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Generate a unique app ID
    const suggestedAppId = generateAppId(projectName);
    console.log('\n🔑 App ID is used for preferences isolation between Aether apps.');
    console.log('   It must be unique across all your Aether applications.');
    const appId = await ask('App ID (must be unique)', suggestedAppId);
    const cleanAppId = appId.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const title = cleanProjectName
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const appTitle = await ask('App display name', title);
    const description = await ask('Project description', 'A modular application built with Aether');

    // Step 2: Server Configuration
    console.log('\n🌐 Step 2: Query Server Configuration\n');
    console.log(
        'The Query Server provides the API for your application (entities, reports, sentiment, etc.).\n'
    );

    const productionQueryServer = 'https://query.pip.prod.g.lovelace.ai';
    const localServer = 'http://localhost:50053';

    // Ask about query server
    console.log('🔌 Query Server - API for entities, reports, sentiment, etc.');
    const needsQueryServer = await askYesNo('Will your app connect to the query server?', true);
    let queryServerAddress = '';

    if (needsQueryServer) {
        const serverChoice = await ask('Query server - (1) Production, (2) Local', '1');
        if (serverChoice === '1') {
            queryServerAddress = productionQueryServer;
        } else if (serverChoice === '2') {
            queryServerAddress = localServer;
        } else {
            queryServerAddress = await ask('Custom query server address', productionQueryServer);
        }
    }

    console.log('\n📊 Data architecture\n');
    console.log(
        'How should the app access platform data?\n  (1) API+MCP — use the Elemental API from Nuxt.\n  (2) MCP-only — agents sync to Postgres; the app reads the database only.\n'
    );
    const dmChoice = await ask('Data architecture: (1) API+MCP  (2) MCP-only', '1');
    const dataArchitectureChoice = dmChoice.trim() === '2' ? 'mcp-only' : 'api-mcp';

    // Step 3: Features Selection
    console.log('\n✨ Step 3: Initial Features\n');
    console.log('Aether includes example features to help you get started.');
    console.log('You can remove them later or use them as templates.\n');

    const includeExamples = await askYesNo('Include example features?', true);

    // Step 4: Authentication
    console.log('\n🔐 Step 4: Authentication Setup\n');
    const needsAuth = await askYesNo('Will your app require user authentication?', false);

    let auth0Config = {
        domain: '',
        clientId: '',
        clientSecret: '',
        audience: '',
    };

    if (needsAuth) {
        console.log('\nAether uses Auth0 for authentication.');
        console.log("You'll need to set up an Auth0 application.\n");

        const hasAuth0 = await askYesNo('Do you have Auth0 credentials ready?', false);
        if (hasAuth0) {
            auth0Config.clientId = await ask('Auth0 client ID');
            auth0Config.clientSecret = await ask('Auth0 client secret');
            auth0Config.audience = await ask('Auth0 API audience (optional)', '');
        } else {
            console.log('\n💡 No problem! You can add Auth0 credentials later to your .env file.');
        }
    }

    // Step 5: Update files
    console.log('\n🔧 Step 5: Configuring your project...\n');

    // Update package.json
    const packagePath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

    packageJson.name = cleanProjectName;
    packageJson.productName = appTitle;
    packageJson.description = description;

    // Add init script if not present
    if (!packageJson.scripts.init) {
        packageJson.scripts.init = 'node init-project.js';
    }

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Updated package.json');
    syncLockfileName(process.cwd(), cleanProjectName);

    // Update nuxt.config.ts
    const nuxtConfigPath = path.join(process.cwd(), 'nuxt.config.ts');
    let nuxtConfig = fs.readFileSync(nuxtConfigPath, 'utf-8');

    // Update the title if it exists in head configuration
    if (nuxtConfig.includes('title:')) {
        nuxtConfig = nuxtConfig.replace(/title:\s*["'].*?["']/, `title: "${appTitle}"`);
    }

    fs.writeFileSync(nuxtConfigPath, nuxtConfig);
    console.log('✅ Updated nuxt.config.ts');

    // Create/Update README.md
    const readmePath = path.join(process.cwd(), 'README.md');
    const readmeContent = `# ${appTitle}

${description}

## 🚀 Quick Start

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
\`\`\`

## 🏗️ Project Structure

This is an Aether application built on Nuxt 3 + Vuetify. Pages are in \`pages/\`, components in \`components/\`, and composables in \`composables/\`.

### Current Features

${
    includeExamples
        ? `- **Entity Lookup** (\`pages/entity-lookup.vue\`) - Search the Query Server for named entities
- **Agent Chat** (\`pages/chat.vue\`) - Talk to deployed AI agents
- **MCP Explorer** (\`pages/mcp.vue\`) - Browse and test MCP server tools`
        : '- No pages yet - run \`/build_my_app\` in Cursor to get started!'
}

### Adding Pages

Create new pages in \`pages/\` and Nuxt will generate routes automatically.

## 🔧 Configuration

### Environment Variables

Create a \`.env\` file with:

\`\`\`bash
# App Configuration
NUXT_PUBLIC_APP_ID=${cleanAppId}
NUXT_PUBLIC_APP_NAME="${appTitle}"

# Query Server Configuration
# Leave empty if not using the query server
NUXT_PUBLIC_QUERY_SERVER_ADDRESS=${queryServerAddress}

${
    needsAuth
        ? `# When using Auth0, NUXT_PUBLIC_USER_NAME must be empty
NUXT_PUBLIC_USER_NAME=

# Auth0 Configuration
NUXT_PUBLIC_AUTH0_CLIENT_ID=${auth0Config.clientId || 'your-client-id'}
NUXT_AUTH0_CLIENT_SECRET=${auth0Config.clientSecret || 'your-client-secret'}
NUXT_PUBLIC_AUTH0_AUDIENCE=${auth0Config.audience || 'your-api-audience'}
`
        : `# Local username (when not using Auth0)
NUXT_PUBLIC_USER_NAME=${process.env.USER || 'local-user'}
`
}
\`\`\`

## 📚 Documentation

- [Documentation](README.md)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Update DESIGN.md with any architectural decisions
4. Submit a pull request

## 📄 License

[Your License Here]
`;

    fs.writeFileSync(readmePath, readmeContent);
    console.log('✅ Created README.md');

    // Create DESIGN.md from template (skip if already populated by Portal)
    const designPath = path.join(process.cwd(), 'DESIGN.md');
    const existingDesign = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf-8') : '';
    const hasRealContent =
        existingDesign.includes('## Vision') ||
        (existingDesign.length > 100 && !existingDesign.includes('{{'));

    if (hasRealContent) {
        console.log('✅ DESIGN.md already has content (from project brief) — keeping it.');
    } else {
        const currentDate = new Date().toISOString().split('T')[0];
        const designTemplate = fs.readFileSync(
            path.join(__dirname, 'design', 'design_template.md'),
            'utf-8'
        );
        const designContent = replaceTemplatePlaceholders(designTemplate, {
            APP_TITLE: appTitle,
            DATE: currentDate,
            APP_ID: cleanAppId,
            DESCRIPTION: description,
            AUTH: needsAuth ? 'Auth0' : 'None (public app)',
            QUERY_SERVER: needsQueryServer ? queryServerAddress : 'Not configured',
        });

        fs.writeFileSync(designPath, designContent);
        console.log("✅ Created DESIGN.md - Your project's blueprint!");
        console.log('   📝 Update DESIGN.md with your project vision and architecture.');
        console.log('   🤖 AI agents read this first to understand what you want to build.');
    }

    // Step 7: Design your project
    console.log('\n🎨 Step 7: Design Your Project\n');
    console.log('Update DESIGN.md to describe:');
    console.log("   • What you're building and why");
    console.log('   • Who will use your application');
    console.log('   • The key features you need\n');
    console.log('As you start building, create feature docs in design/ to plan work');
    console.log('with your AI agent. Copy design/feature_template.md to get started.\n');

    const shouldOpenDesign = await askYesNo(
        'Would you like to open DESIGN.md in your editor now?',
        true
    );
    if (shouldOpenDesign) {
        let opened = false;
        let cursorAvailable = false;

        // First, check if cursor command is available
        try {
            const checkCommand = process.platform === 'win32' ? 'where cursor' : 'which cursor';
            execSync(checkCommand, { stdio: 'ignore' });
            cursorAvailable = true;
        } catch (e) {
            // cursor command not found
        }

        if (cursorAvailable) {
            // Try to open with Cursor
            try {
                execSync(`cursor "${designPath}"`, { stdio: 'ignore' });
                console.log('✅ Opening DESIGN.md in Cursor...');
                console.log('   Please update it before proceeding!\n');
                opened = true;
            } catch (e) {
                // cursor command failed
            }
        } else {
            // Cursor CLI not installed, provide helpful instructions
            console.log('\n💡 Cursor CLI not found. To enable direct Cursor integration:');
            console.log('   1. Open Cursor');
            console.log('   2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)');
            console.log('   3. Type "Install \'cursor\' command in PATH" and select it');
            console.log('   4. Re-run this init script for direct Cursor integration\n');
        }

        // If Cursor didn't work, try the system default
        if (!opened) {
            try {
                const opener =
                    process.platform === 'darwin'
                        ? 'open'
                        : process.platform === 'win32'
                          ? 'start'
                          : 'xdg-open';
                execSync(`${opener} ${designPath}`, { stdio: 'ignore' });
                console.log('✅ Opening DESIGN.md in your default editor...');
                if (!cursorAvailable) {
                    console.log('   (Follow the steps above to enable Cursor integration)');
                }
                console.log('   Please update it before proceeding!\n');
                opened = true;
            } catch (e) {
                // Both methods failed
            }
        }

        if (opened) {
            // Give them a moment to realize the file is opening
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
            console.log('⚠️  Could not open DESIGN.md automatically.');
            console.log(`   Please open ${designPath} manually in Cursor.`);
        }
    }

    // Create .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = `# Aether Application Configuration
# Generated by init script on ${new Date().toLocaleString()}

# App Identity (REQUIRED - Must be unique per app!)
NUXT_PUBLIC_APP_ID=${cleanAppId}
NUXT_PUBLIC_APP_NAME="${appTitle}"

# Query Server Configuration
# Leave empty if not using the query server
NUXT_PUBLIC_QUERY_SERVER_ADDRESS=${queryServerAddress}
`;

    if (needsAuth) {
        envContent += `
# When using Auth0, NUXT_PUBLIC_USER_NAME must be empty
NUXT_PUBLIC_USER_NAME=

# Auth0 Configuration
${auth0Config.clientId ? `NUXT_PUBLIC_AUTH0_CLIENT_ID=${auth0Config.clientId}` : '# NUXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id'}
${auth0Config.clientSecret ? `NUXT_AUTH0_CLIENT_SECRET=${auth0Config.clientSecret}` : '# NUXT_AUTH0_CLIENT_SECRET=your-client-secret'}
${auth0Config.audience ? `NUXT_PUBLIC_AUTH0_AUDIENCE=${auth0Config.audience}` : '# NUXT_PUBLIC_AUTH0_AUDIENCE=your-api-audience'}
`;
    } else {
        envContent += `
# Local username (when not using Auth0)
NUXT_PUBLIC_USER_NAME=${process.env.USER || 'local-user'}
`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ Created .env file');

    // Create .env.example
    const envExamplePath = path.join(process.cwd(), '.env.example');
    fs.writeFileSync(envExamplePath, envContent.replace(/=.*/g, '='));
    console.log('✅ Created .env.example');

    // Generate .agents/mcp.json for Lovelace MCP servers
    const bcPath = path.join(process.cwd(), 'broadchurch.yaml');
    if (fs.existsSync(bcPath)) {
        const yaml = fs.readFileSync(bcPath, 'utf-8');
        const gwUrl = yamlSectionUrl(yaml, 'gateway');
        const orgId = yamlSectionValue(yaml, 'tenant', 'org_id');
        await generateMcpJson(gwUrl, orgId);
    } else {
        await generateMcpJson();
    }

    const bcPathForMode = path.join(process.cwd(), 'broadchurch.yaml');
    let yamlForMode = '';
    if (fs.existsSync(bcPathForMode)) {
        yamlForMode = fs.readFileSync(bcPathForMode, 'utf-8');
    }
    const resolvedDataMode = resolveDataModeForInit({
        interactiveChoice: dataArchitectureChoice,
        yamlText: yamlForMode,
    });
    writeAetherDataModeFile(resolvedDataMode);
    extractAetherInstructions(resolvedDataMode);
    if (resolvedDataMode === 'mcp-only') {
        scaffoldNeonPostgres();
    }

    // Update .gitignore if needed
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        let gitignore = fs.readFileSync(gitignorePath, 'utf-8');
        if (!gitignore.includes('.env')) {
            gitignore += '\n# Environment files\n.env\n.env.local\n';
            fs.writeFileSync(gitignorePath, gitignore);
            console.log('✅ Updated .gitignore');
        }
    }

    // Remove example pages if not wanted
    if (!includeExamples) {
        console.log('\n🧹 Removing example pages...');
        for (const page of examplePagesToRemove(process.cwd())) {
            const pagePath = path.join(process.cwd(), 'pages', page);
            if (fs.existsSync(pagePath)) {
                fs.rmSync(pagePath);
                console.log(`   Removed pages/${page}`);
            }
        }
    }

    // Step 8: Install dependencies
    console.log('\n📦 Step 8: Install Dependencies\n');

    const shouldInstall = await askYesNo(
        'Would you like to install dependencies now? (This may take a minute)',
        true
    );

    if (shouldInstall) {
        console.log('\n📦 Installing dependencies...\n');
        try {
            execSync('npm install', {
                stdio: 'inherit',
                env: { ...process.env, AETHER_DATA_MODE: resolvedDataMode },
            });
            console.log('\n✅ Dependencies installed successfully!');
        } catch (error) {
            console.error('\n❌ Error installing dependencies:', error.message);
            console.log('You can install them manually by running: npm install');
        }
    }

    // Final message
    console.log('\n' + '='.repeat(70));
    console.log('\n🎉 PROJECT SETUP COMPLETE! 🎉\n');
    console.log('='.repeat(70));

    console.log('\n🚀 READY TO BUILD!\n');

    console.log('⚡ QUICK START:\n');
    console.log('1. Start the development server:');
    console.log('   → npm run dev\n');
    console.log('2. Open your browser to:');
    console.log('   → http://localhost:3000\n');

    if (includeExamples) {
        console.log('3. Explore the built-in pages:');
        console.log('   → Try Entity Lookup for Query Server API integration');
        console.log('   → Open Agent Chat to talk to your deployed agents\n');
    }

    console.log('📝 NEXT STEPS:\n');
    console.log('1. Update DESIGN.md with your project vision and architecture');
    console.log('2. Create a feature doc in design/ to plan your first feature');
    console.log('   (copy design/feature_template.md to get started)');
    console.log('3. Open your AI assistant and start building!\n');

    console.log('📚 DOCUMENTATION:\n');
    console.log('• Quick Start: README.md');
    console.log('• Documentation: README.md\n');

    console.log('💡 YOUR APP ID: ' + cleanAppId);
    console.log('   This uniquely identifies your app for preferences storage.\n');

    console.log('='.repeat(70));
    console.log('\nHappy building with Aether! ✨\n');

    rl.close();
}

// Non-interactive mode implementation
async function runNonInteractiveInit(config) {
    const {
        projectName,
        appId,
        appTitle,
        description = 'A modular application built with Aether',
        queryServer = '',
        includeExamples = true,
        skipInstall = false,
        auth0ClientId = '',
        auth0ClientSecret = '',
        auth0Audience = '',
        dataModeCli,
    } = config;

    const bcPathData = path.join(process.cwd(), 'broadchurch.yaml');
    let yamlForDataMode = '';
    if (fs.existsSync(bcPathData)) {
        yamlForDataMode = fs.readFileSync(bcPathData, 'utf-8');
    }
    const dataMode = resolveDataModeForInit({
        cliFlag: dataModeCli,
        yamlText: yamlForDataMode,
    });

    const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const cleanAppId = appId || generateAppId(projectName);
    const title =
        appTitle ||
        cleanProjectName
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

    // Update package.json
    const packagePath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

    packageJson.name = cleanProjectName;
    packageJson.productName = title;
    packageJson.description = description;

    if (!packageJson.scripts.init) {
        packageJson.scripts.init = 'node init-project.js';
    }

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Updated package.json');
    syncLockfileName(process.cwd(), cleanProjectName);

    // Update nuxt.config.ts
    const nuxtConfigPath = path.join(process.cwd(), 'nuxt.config.ts');
    let nuxtConfig = fs.readFileSync(nuxtConfigPath, 'utf-8');

    if (nuxtConfig.includes('title:')) {
        nuxtConfig = nuxtConfig.replace(/title:\s*["'].*?["']/, `title: "${title}"`);
    }

    fs.writeFileSync(nuxtConfigPath, nuxtConfig);
    console.log('✅ Updated nuxt.config.ts');

    // Create README.md (simplified for non-interactive)
    const readmePath = path.join(process.cwd(), 'README.md');
    const readmeContent = `# ${title}

${description}

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Configuration

See \`.env\` for configuration options.

## Documentation

- [Quick Start Guide](README.md)
`;

    fs.writeFileSync(readmePath, readmeContent);
    console.log('✅ Created README.md');

    // Create DESIGN.md from template (skip if already populated by Portal)
    const designPath = path.join(process.cwd(), 'DESIGN.md');
    const existingDesign = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf-8') : '';
    const hasRealContent =
        existingDesign.includes('## Vision') ||
        (existingDesign.length > 100 && !existingDesign.includes('{{'));

    if (hasRealContent) {
        console.log('✅ DESIGN.md already has content — keeping it.');
    } else {
        const currentDate = new Date().toISOString().split('T')[0];
        const designTemplate = fs.readFileSync(
            path.join(__dirname, 'design', 'design_template.md'),
            'utf-8'
        );
        const designContent = replaceTemplatePlaceholders(designTemplate, {
            APP_TITLE: title,
            DATE: currentDate,
            APP_ID: cleanAppId,
            DESCRIPTION: description,
            AUTH: auth0ClientId ? 'Auth0' : 'Not yet configured',
            QUERY_SERVER: queryServer || 'Not yet configured',
        });

        fs.writeFileSync(designPath, designContent);
        console.log('✅ Created DESIGN.md');
    }

    // Create .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = `# Aether Application Configuration
# Generated by init script on ${new Date().toLocaleString()}

# App Identity (REQUIRED - Must be unique per app!)
NUXT_PUBLIC_APP_ID=${cleanAppId}
NUXT_PUBLIC_APP_NAME="${title}"

# Query Server Configuration
# Leave empty if not using the query server
NUXT_PUBLIC_QUERY_SERVER_ADDRESS=${queryServer}

# User configuration
${auth0ClientId ? '# When using Auth0, NUXT_PUBLIC_USER_NAME must be empty\nNUXT_PUBLIC_USER_NAME=' : `# Local username (when not using Auth0)\nNUXT_PUBLIC_USER_NAME=${process.env.USER || 'local-user'}`}

# Auth0 Configuration
${auth0ClientId ? `NUXT_PUBLIC_AUTH0_CLIENT_ID=${auth0ClientId}` : '# NUXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id'}
${auth0ClientSecret ? `NUXT_AUTH0_CLIENT_SECRET=${auth0ClientSecret}` : '# NUXT_AUTH0_CLIENT_SECRET=your-client-secret'}
${auth0Audience ? `NUXT_PUBLIC_AUTH0_AUDIENCE=${auth0Audience}` : '# NUXT_PUBLIC_AUTH0_AUDIENCE=your-api-audience'}
`;

    // Fetch storage credentials (KV, Neon Postgres) from the portal and append
    const bcPathForEnv = path.join(process.cwd(), 'broadchurch.yaml');
    if (fs.existsSync(bcPathForEnv)) {
        const yamlForEnv = fs.readFileSync(bcPathForEnv, 'utf-8');
        const gwUrlForEnv = yamlSectionUrl(yamlForEnv, 'gateway');
        const orgIdForEnv = yamlSectionValue(yamlForEnv, 'tenant', 'org_id');
        if (gwUrlForEnv && orgIdForEnv) {
            try {
                const envResp = await fetch(`${gwUrlForEnv}/api/projects/${orgIdForEnv}/env`);
                if (envResp.ok) {
                    const { env: portalEnv } = await envResp.json();
                    const storageKeys = [
                        'KV_REST_API_URL',
                        'KV_REST_API_TOKEN',
                        'DATABASE_URL',
                        'DATABASE_URL_UNPOOLED',
                    ];
                    const storageLines = [];
                    for (const line of portalEnv.split('\n')) {
                        const key = line.split('=')[0];
                        if (storageKeys.includes(key)) storageLines.push(line);
                    }
                    if (storageLines.length > 0) {
                        envContent += `\n# Storage (auto-populated from portal)\n${storageLines.join('\n')}\n`;
                        console.log(
                            `✅ Fetched ${storageLines.length} storage credential(s) from portal`
                        );
                    }

                    // Scaffold Neon Postgres if DATABASE_URL was fetched
                    if (storageLines.some((l) => l.startsWith('DATABASE_URL='))) {
                        scaffoldNeonPostgres();
                    }
                }
            } catch (e) {
                console.log('⚠️  Could not fetch storage credentials from portal (non-fatal)');
            }
        }
    }

    // Always add storage placeholders so agents can discover the vars
    if (!envContent.includes('DATABASE_URL')) {
        envContent += `
# Storage — uncommented values are auto-populated; commented ones need manual setup
# KV_REST_API_URL=
# KV_REST_API_TOKEN=
# DATABASE_URL=
# DATABASE_URL_UNPOOLED=
`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ Created .env file');

    // Create .env.example
    const envExamplePath = path.join(process.cwd(), '.env.example');
    fs.writeFileSync(envExamplePath, envContent.replace(/=.*/g, '='));
    console.log('✅ Created .env.example');

    // Generate .agents/mcp.json — use gateway proxy URLs if broadchurch.yaml is available
    const bcPath = path.join(process.cwd(), 'broadchurch.yaml');
    if (fs.existsSync(bcPath)) {
        const yaml = fs.readFileSync(bcPath, 'utf-8');
        const gwUrl = yamlSectionUrl(yaml, 'gateway');
        const orgId = yamlSectionValue(yaml, 'tenant', 'org_id');
        await generateMcpJson(gwUrl, orgId);
    } else {
        await generateMcpJson();
    }

    writeAetherDataModeFile(dataMode);
    extractAetherInstructions(dataMode);
    if (dataMode === 'mcp-only') {
        scaffoldNeonPostgres();
    }

    // Remove example pages if requested
    if (!includeExamples) {
        for (const page of examplePagesToRemove(process.cwd())) {
            const pagePath = path.join(process.cwd(), 'pages', page);
            if (fs.existsSync(pagePath)) {
                fs.rmSync(pagePath);
            }
        }
        console.log('✅ Removed example pages');
    }

    if (!skipInstall) {
        console.log('\n📦 Installing dependencies...\n');
        try {
            execSync('npm install', {
                stdio: 'inherit',
                env: { ...process.env, AETHER_DATA_MODE: dataMode },
            });
            console.log('\n✅ Dependencies installed successfully!');
        } catch (error) {
            console.error('\n❌ Error installing dependencies:', error.message);
            console.log('You can install them manually by running: npm install');
        }
    }
}

// Postgres access is provided by the pre-scaffolded `server/utils/db.ts`
// helper (ships with the template, backed by `pg`). It is dual-transport:
//   - BC 2.0 / GKE: connects to the Cloud SQL Auth Proxy sidecar via IAM
//     (CLOUD_SQL_* env injected by the aether-ui Helm chart).
//   - BC 1.0 / Vercel / local: a plain DATABASE_URL connection string.
// So there is nothing to scaffold or install here anymore — the old
// `neon.ts` + `@neondatabase/serverless` path was the BC 1.0-only
// pattern. Kept as a no-op (with the call sites intact) so init logs
// still note when a DATABASE_URL is present. See skills/aether/storage.md.
function scaffoldNeonPostgres() {
    const dbUtilPath = path.join(process.cwd(), 'server', 'utils', 'db.ts');
    if (fs.existsSync(dbUtilPath)) {
        console.log(
            '✅ Postgres ready via pre-scaffolded server/utils/db.ts (DATABASE_URL detected)'
        );
        return;
    }
    console.log(
        '⚠️  DATABASE_URL detected but server/utils/db.ts is missing — copy it from the template (do NOT create a neon.ts).'
    );
}

// Ensure a root .npmrc exists that pins the @yottagraph-app scope to the org's
// GCP Artifact Registry npm repo. This is the dependency-confusion control:
// @yottagraph-app/* must NEVER resolve from public npmjs. The template ships a
// committed .npmrc, but we self-heal here so a tenant repo that somehow lacks
// one still resolves privately. Auth comes from ${AR_NPM_TOKEN} at install time
// (see broadchurch/docs/NPM_PRIVATE_REGISTRY.md).
const AR_NPM_REGISTRY = 'https://us-central1-npm.pkg.dev/broadchurch/aether-npm/';
const AR_NPM_HOST = '//us-central1-npm.pkg.dev/broadchurch/aether-npm/';
function ensureNpmrc() {
    const npmrcPath = path.join(process.cwd(), '.npmrc');
    let existing = '';
    try {
        existing = fs.readFileSync(npmrcPath, 'utf-8');
    } catch {
        // no .npmrc yet
    }
    if (existing.includes('@yottagraph-app:registry=')) return;
    const block = [
        '# @yottagraph-app/* is served only from the org GCP Artifact Registry,',
        '# never public npmjs. Auth via ${AR_NPM_TOKEN} (GCP IAM). Fails closed if unset.',
        '# See broadchurch/docs/NPM_PRIVATE_REGISTRY.md.',
        `@yottagraph-app:registry=${AR_NPM_REGISTRY}`,
        `${AR_NPM_HOST}:_authToken=\${AR_NPM_TOKEN}`,
        '',
    ].join('\n');
    const next = existing && !existing.endsWith('\n') ? existing + '\n' + block : existing + block;
    fs.writeFileSync(npmrcPath, next);
    console.log('✅ Wrote .npmrc (pins @yottagraph-app to Artifact Registry).');
}

// Extract Aether instructions from the @yottagraph-app/aether-instructions npm package.
// Downloads the package, removes previously installed files (tracked via manifest),
// and extracts fresh ones with their original filenames.
// When dataMode is `mcp-only`, overlays variants/mcp-only onto commands/skills
// and removes skills/elemental-api.
function extractAetherInstructions(dataMode = 'api-mcp') {
    const os = require('os');
    ensureAgentsLayout();
    ensureNpmrc();
    const agentsDir = path.join(process.cwd(), '.agents');
    const manifestPath = path.join(agentsDir, '.aether-instructions-manifest');
    const tempDir = path.join(os.tmpdir(), 'aether-instructions-extract-' + Date.now());

    console.log('📦 Downloading Aether instructions...');

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        // Resolves from the org Artifact Registry via the root .npmrc + AR_NPM_TOKEN
        // (ensureNpmrc above guarantees the scope-pin is present).
        execSync(
            `npm pack @yottagraph-app/aether-instructions@latest --pack-destination "${tempDir}"`,
            {
                stdio: 'pipe',
            }
        );

        const tarball = fs.readdirSync(tempDir).find((f) => f.endsWith('.tgz'));
        if (!tarball) {
            console.log('⚠️  Could not download Aether instructions package.');
            return;
        }

        execSync(`tar -xzf "${path.join(tempDir, tarball)}" -C "${tempDir}"`, { stdio: 'pipe' });
        const pkgDir = path.join(tempDir, 'package');

        const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
        const version = pkgJson.version;

        // Delete files from previous install using manifest (also cleans up
        // legacy aether_* prefixed files from older package versions).
        // Entries prefixed with `root/` map to files at the tenant repo root
        // (e.g. `root/AGENTS.md`, `root/CLAUDE.md`) — only remove regular
        // files there, never directories, to keep the manifest safe even
        // with unexpected entries.
        if (fs.existsSync(manifestPath)) {
            const oldFiles = fs
                .readFileSync(manifestPath, 'utf-8')
                .trim()
                .split('\n')
                .filter(Boolean);
            for (const rel of oldFiles) {
                if (rel.startsWith('root/')) {
                    const sub = rel.slice('root/'.length);
                    if (!sub || sub.includes('..')) continue;
                    const target = path.join(process.cwd(), sub);
                    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
                        fs.rmSync(target, { force: true });
                    }
                    continue;
                }
                const target = path.join(agentsDir, rel);
                if (fs.existsSync(target)) {
                    fs.rmSync(target, { recursive: true, force: true });
                }
            }
        }
        // Also clean up legacy aether_* files (commands) and the deprecated
        // .agents/rules/ directory left over from pre-skill installs.
        const legacyRulesDir = path.join(agentsDir, 'rules');
        if (fs.existsSync(legacyRulesDir)) {
            fs.rmSync(legacyRulesDir, { recursive: true, force: true });
        }
        const legacyCmdDir = path.join(agentsDir, 'commands');
        if (fs.existsSync(legacyCmdDir)) {
            for (const file of fs.readdirSync(legacyCmdDir)) {
                if (file.startsWith('aether_')) {
                    fs.unlinkSync(path.join(legacyCmdDir, file));
                }
            }
        }
        const skillsDir = path.join(agentsDir, 'skills');
        if (fs.existsSync(skillsDir)) {
            for (const dir of fs.readdirSync(skillsDir)) {
                if (dir.startsWith('aether_')) {
                    fs.rmSync(path.join(skillsDir, dir), { recursive: true, force: true });
                }
            }
        }

        let manifest = [];
        let commandsCount = 0;
        let skillsCount = 0;

        for (const subdir of ['commands', 'skills']) {
            const src = path.join(pkgDir, subdir);
            const dest = path.join(agentsDir, subdir);
            if (!fs.existsSync(src)) continue;

            fs.mkdirSync(dest, { recursive: true });

            for (const item of fs.readdirSync(src)) {
                if (item === '.gitkeep') continue;

                const srcPath = path.join(src, item);
                const destPath = path.join(dest, item);

                if (fs.statSync(srcPath).isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true });
                    if (subdir === 'skills') skillsCount++;
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    if (subdir === 'commands') commandsCount++;
                }
                manifest.push(`${subdir}/${item}`);
            }
        }

        // Copy root-level AGENTS.md from the package to the tenant repo root.
        // Tracked in the manifest under `root/AGENTS.md` so future updates
        // refresh it cleanly.
        const pkgAgents = path.join(pkgDir, 'AGENTS.md');
        if (fs.existsSync(pkgAgents)) {
            fs.copyFileSync(pkgAgents, path.join(process.cwd(), 'AGENTS.md'));
            manifest.push('root/AGENTS.md');
        }

        // Copy root-level CLAUDE.md from the package to the tenant repo root.
        // This is a one-line `@AGENTS.md` pointer so Claude Code imports the
        // same instructions Cursor reads from AGENTS.md directly.
        const pkgClaude = path.join(pkgDir, 'CLAUDE.md');
        if (fs.existsSync(pkgClaude)) {
            fs.copyFileSync(pkgClaude, path.join(process.cwd(), 'CLAUDE.md'));
            manifest.push('root/CLAUDE.md');
        }

        // Install the .agents/README.md explainer from the package. This
        // self-documents the directory so an agent doing `ls .agents/` or
        // `cat .agents/README.md` immediately learns where the contents come
        // from instead of poking around for the missing dependency.
        const pkgAgentsReadme = path.join(pkgDir, 'agents-readme.md');
        if (fs.existsSync(pkgAgentsReadme)) {
            fs.copyFileSync(pkgAgentsReadme, path.join(agentsDir, 'README.md'));
            manifest.push('README.md');
        }

        if (dataMode === 'mcp-only') {
            const vroot = path.join(pkgDir, 'variants', 'mcp-only');
            for (const subdir of ['commands', 'skills']) {
                const vsrc = path.join(vroot, subdir);
                if (!fs.existsSync(vsrc)) continue;
                const dest = path.join(agentsDir, subdir);
                fs.mkdirSync(dest, { recursive: true });
                for (const item of fs.readdirSync(vsrc)) {
                    if (item === '.gitkeep') continue;
                    const srcPath = path.join(vsrc, item);
                    const destPath = path.join(dest, item);
                    if (fs.statSync(srcPath).isDirectory()) {
                        // Overlay per-file so the default skill's other topics survive
                        fs.mkdirSync(destPath, { recursive: true });
                        for (const f of fs.readdirSync(srcPath)) {
                            fs.copyFileSync(path.join(srcPath, f), path.join(destPath, f));
                        }
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                    const rel = `${subdir}/${item}`;
                    if (!manifest.includes(rel)) manifest.push(rel);
                }
            }
            const elementalSkill = path.join(agentsDir, 'skills', 'elemental-api');
            if (fs.existsSync(elementalSkill)) {
                fs.rmSync(elementalSkill, { recursive: true, force: true });
            }
            manifest = manifest.filter(
                (line) =>
                    line !== 'skills/elemental-api' && !line.startsWith('skills/elemental-api/')
            );
        }

        fs.writeFileSync(manifestPath, [...new Set(manifest)].join('\n') + '\n');

        fs.writeFileSync(path.join(agentsDir, '.aether-instructions-version'), version);

        fs.rmSync(tempDir, { recursive: true, force: true });

        console.log(`✅ Installed @yottagraph-app/aether-instructions@${version}`);
        console.log(`   ${commandsCount} commands, ${skillsCount} skill directories`);
    } catch (error) {
        console.log('⚠️  Could not install Aether instructions: ' + error.message);
        console.log(
            '   If this is an auth error, set AR_NPM_TOKEN (e.g. export AR_NPM_TOKEN="$(gcloud auth print-access-token)")'
        );
        console.log('   You can install them later by running /update_instructions');
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

// Generate .agents/mcp.json so Cursor and Claude Code agents can use the
// Lovelace MCP servers. Cursor reads .cursor/mcp.json (symlink) and Claude
// Code reads .mcp.json at the repo root (symlink to .agents/mcp.json).
// When gatewayUrl and tenantId are available (from broadchurch.yaml), routes
// traffic through the Portal Gateway proxy — no MCP credentials needed locally.
// Falls back to direct URLs with a dev token placeholder if gateway info is missing.
// Also discovers tenant-deployed MCP servers from the config API when available.
async function generateMcpJson(gatewayUrl, tenantId) {
    ensureAgentsLayout();
    const mcpJsonPath = path.join(process.cwd(), '.agents', 'mcp.json');
    const useGateway = gatewayUrl && tenantId;

    // Gateway credentials are authoritative — always overwrite (the template
    // ships with dev-token URLs that won't work in tenant projects).
    // Without gateway info, preserve any existing config.
    if (fs.existsSync(mcpJsonPath) && !useGateway) {
        console.log('ℹ️  .agents/mcp.json already exists — skipping creation.');
        return;
    }

    const platformServers = ['elemental', 'stocks', 'wiki', 'polymarket'];

    const mcpServers = {};
    for (const name of platformServers) {
        if (useGateway) {
            mcpServers[`lovelace-${name}`] = {
                url: `${gatewayUrl}/api/mcp/${tenantId}/${name}/mcp`,
            };
        } else {
            mcpServers[`lovelace-${name}`] = {
                url: `https://mcp.pip.prod.g.lovelace.ai/${name}/mcp`,
                headers: { Authorization: 'Bearer ${AUTH0_M2M_DEV_TOKEN}' },
            };
        }
    }

    // Vuetify MCP — public hosted server, no auth required.
    // Gives agents access to Vuetify component docs, composable guides, and API refs.
    mcpServers['vuetify-mcp'] = {
        url: 'https://mcp.vuetifyjs.com/mcp',
    };

    // Discover tenant-deployed MCP servers from the config API
    if (useGateway) {
        const platformSet = new Set(platformServers);
        try {
            const res = await fetch(`${gatewayUrl}/api/config/${tenantId}`);
            if (res.ok) {
                const config = await res.json();
                for (const server of config.mcp_servers || []) {
                    if (server.name && !platformSet.has(server.name)) {
                        mcpServers[server.name] = {
                            url: `${gatewayUrl}/api/mcp/${tenantId}/${server.name}/mcp`,
                        };
                    }
                }
            }
        } catch {
            // Config API unreachable — continue with platform servers only
        }
    }

    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true });
    fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers }, null, 2) + '\n');

    if (useGateway) {
        const extra = Object.keys(mcpServers).length - platformServers.length;
        const suffix = extra > 0 ? ` + ${extra} tenant-deployed` : '';
        console.log(
            `✅ Created .agents/mcp.json (${platformServers.length} platform servers${suffix} via portal gateway — no token needed).`
        );
    } else {
        console.log('✅ Created .agents/mcp.json (Lovelace MCP servers — direct URLs).');
        console.log(
            '   ⚠️  MCP servers require AUTH0_M2M_DEV_TOKEN as a shell environment variable.'
        );
        console.log(
            '   If you have broadchurch.yaml, re-run init to use the portal proxy instead (no token needed).'
        );
    }
}

// Quick local-dev setup: creates .env with sensible defaults, no wizard.
// Reads broadchurch.yaml if present for project-specific values.
async function runLocalInit() {
    const templateVersion = getTemplateVersion();
    if (templateVersion) console.log(`Template: ${templateVersion}`);

    const rawName = path.basename(process.cwd());
    const cleanName = rawName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    let appId = cleanName;
    let displayName = cleanName
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    let queryServer = '';
    let gatewayUrl = '';
    let tenantOrgId = '';
    let auth0ClientId = '';
    let qsApiKey = '';

    const bcPath = path.join(process.cwd(), 'broadchurch.yaml');
    let yamlForLocal = '';
    if (fs.existsSync(bcPath)) {
        yamlForLocal = fs.readFileSync(bcPath, 'utf-8');
        const yaml = yamlForLocal;
        appId = yamlSectionValue(yaml, 'tenant', 'project_name') || appId;
        displayName = yamlSectionValue(yaml, 'tenant', 'display_name') || displayName;
        queryServer = yamlSectionUrl(yaml, 'query_server');
        gatewayUrl = yamlSectionUrl(yaml, 'gateway');
        tenantOrgId = yamlSectionValue(yaml, 'tenant', 'org_id');
        auth0ClientId = yamlSectionValue(yaml, 'auth', 'client_id');
        qsApiKey = yamlSectionValue(yaml, 'gateway', 'qs_api_key');
    }

    const localDataMode = resolveDataModeForInit({
        cliFlag: args['data-mode'],
        yamlText: yamlForLocal,
    });

    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        console.log('ℹ️  .env already exists — skipping creation.');
    } else {
        const lines = [
            `# Local development configuration (auto-generated from broadchurch.yaml)`,
            `NUXT_PUBLIC_APP_ID=${appId}`,
            `NUXT_PUBLIC_APP_NAME="${displayName}"`,
            `NUXT_PUBLIC_USER_NAME=dev-user`,
            queryServer
                ? `NUXT_PUBLIC_QUERY_SERVER_ADDRESS=${queryServer}`
                : '# NUXT_PUBLIC_QUERY_SERVER_ADDRESS=',
            gatewayUrl ? `NUXT_PUBLIC_GATEWAY_URL=${gatewayUrl}` : '# NUXT_PUBLIC_GATEWAY_URL=',
            tenantOrgId
                ? `NUXT_PUBLIC_TENANT_ORG_ID=${tenantOrgId}`
                : '# NUXT_PUBLIC_TENANT_ORG_ID=',
            auth0ClientId
                ? `NUXT_PUBLIC_AUTH0_CLIENT_ID=${auth0ClientId}`
                : '# NUXT_PUBLIC_AUTH0_CLIENT_ID=',
            qsApiKey ? `NUXT_PUBLIC_QS_API_KEY=${qsApiKey}` : '# NUXT_PUBLIC_QS_API_KEY=',
            '',
        ];

        // Fetch storage credentials from the portal
        if (gatewayUrl && tenantOrgId) {
            try {
                const envResp = await fetch(`${gatewayUrl}/api/projects/${tenantOrgId}/env`);
                if (envResp.ok) {
                    const { env: portalEnv } = await envResp.json();
                    const storageKeys = [
                        'KV_REST_API_URL',
                        'KV_REST_API_TOKEN',
                        'DATABASE_URL',
                        'DATABASE_URL_UNPOOLED',
                    ];
                    const storageLines = [];
                    for (const line of portalEnv.split('\n')) {
                        const key = line.split('=')[0];
                        if (storageKeys.includes(key)) storageLines.push(line);
                    }
                    if (storageLines.length > 0) {
                        lines.push(`# Storage (auto-populated from portal)`);
                        lines.push(...storageLines, '');
                        console.log(
                            `✅ Fetched ${storageLines.length} storage credential(s) from portal`
                        );
                    }
                    if (storageLines.some((l) => l.startsWith('DATABASE_URL='))) {
                        scaffoldNeonPostgres();
                    }
                }
            } catch {
                console.log('⚠️  Could not fetch storage credentials from portal (non-fatal)');
            }
        }

        // Always add storage placeholders so agents can discover the vars
        if (!lines.some((l) => l.startsWith('DATABASE_URL='))) {
            lines.push(
                `# Storage — fill from Vercel project settings if not auto-populated`,
                `# KV_REST_API_URL=`,
                `# KV_REST_API_TOKEN=`,
                `# DATABASE_URL=`,
                `# DATABASE_URL_UNPOOLED=`,
                ''
            );
        }

        fs.writeFileSync(envPath, lines.join('\n'));
        console.log('✅ Created .env with local-dev defaults (Auth0 bypassed).');
    }

    await generateMcpJson(gatewayUrl, tenantOrgId);

    writeAetherDataModeFile(localDataMode);
    extractAetherInstructions(localDataMode);
    if (localDataMode === 'mcp-only') {
        scaffoldNeonPostgres();
    }

    console.log('\nReady! Run:\n');
    console.log(`  AETHER_DATA_MODE=${localDataMode} npm install`);
    console.log('  npm run dev\n');
}

// Show help if requested
if (args.help) {
    console.log(`
Aether Project Initializer

Usage:
  npm run init                       # Interactive wizard
  npm run init -- --local            # Quick local-dev setup (creates .env, no prompts)
  npm run init -- --non-interactive  # CI mode (used by tenant-init workflow)

Options:
  --local                      Quick setup: create .env with dev defaults and exit
  --non-interactive            Run full init without prompts (for CI)
  --name, -n <string>          Project name (default: directory name)
  --id, -i <string>            Unique app ID for preferences
  --title <string>             App display title
  --description <string>       Project description
  --query-server <string>      Query server address
  --auth0-client-id <string>   Auth0 client ID
  --auth0-client-secret <string> Auth0 client secret
  --auth0-audience <string>    Auth0 API audience
  --no-include-examples        Remove example pages (entity-lookup, chat, mcp)
  --skip-install               Skip npm install step
  --data-mode <mode>          api-mcp (default) or mcp-only — agent instructions variant
  --help, -h                   Show this help message

Examples:
  npm run init -- --local
  npm run init -- --non-interactive --name "My App" --id "my-app-2024"
  npm run init -- --non-interactive --skip-install --no-include-examples
`);
    process.exit(0);
}

// Main entry point
if (args.local) {
    runLocalInit().then(() => process.exit(0));
} else if (args['non-interactive']) {
    const config = {
        projectName: args.name || path.basename(process.cwd()),
        appId: args.id,
        appTitle: args.title,
        description: args.description,
        queryServer: args['query-server'],
        auth0ClientId: args['auth0-client-id'],
        auth0ClientSecret: args['auth0-client-secret'],
        auth0Audience: args['auth0-audience'],
        includeExamples: !args['no-include-examples'],
        skipInstall: args['skip-install'] || false,
        dataModeCli: args['data-mode'],
    };

    const templateVersion = getTemplateVersion();
    console.log('🚀 Running Aether initialization in non-interactive mode...');
    if (templateVersion) console.log(`   Template: ${templateVersion}`);
    console.log(`   Project: ${config.projectName}`);
    console.log(`   App ID: ${config.appId || 'auto-generated'}`);

    runNonInteractiveInit(config)
        .then(() => {
            console.log('\n✅ Project initialized successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error:', error.message);
            process.exit(1);
        });
} else {
    // Interactive wizard
    init().catch((error) => {
        console.error('Error:', error);
        rl.close();
        process.exit(1);
    });
}
