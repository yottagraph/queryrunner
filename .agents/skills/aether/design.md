# Design

Read `DESIGN.md` before starting any work. It is the source of truth for project vision, architecture, and current implementation status.

Update `DESIGN.md` when you add, remove, or change the design or implementation status of a feature.

`DESIGN.md` serves as a record of the current state of the project. Do not include checklists, working plans, or documentation of changes or previous implementation details.

The sections of the design doc are flexible and you should add or remove sections to fit the needs of the project.

# Starter App is a Placeholder

The default UI that ships with this template is **placeholder content**.
When building from a project brief or user request, feel free to:

- **Replace** `pages/index.vue` with the app's real home page
- **Remove** any pages that don't fit the app
- **Restructure** the navigation and layout entirely
- **Check** the branding is up to date with the `lovelace-branding` skill, and update as needed
- **Keep** the infrastructure: `composables/`, `server/api/prefs/`, `server/api/kv/`, `agents/`

Do NOT treat the existing UI as something to preserve. Build what the
user described, using the template's infrastructure and patterns but not
its placeholder content. The only exception is if the user explicitly
asks to keep specific parts.

# Project Brief

If `DESIGN.md` has a `## Vision` section, it contains the project creator's original description of what they want to build — written during project setup in the Broadchurch Portal. This can range from a single sentence to a full PRD with user stories, wireframes, and technical constraints.

When a user opens the project for the first time and hasn't started building yet (the `## Status` section says "Run `/build_my_app`"), suggest running that command. If they ask "what should I build?" or similar, read the Vision section of DESIGN.md first.

## Long-form briefs

Users may paste full PRD or spec documents as their project brief. When the Vision section is long (500+ words), focus on extracting the MVP scope before building. Look for priority indicators, phased rollout plans, or "must-have" vs "nice-to-have" distinctions. If none exist, identify the smallest coherent feature set that demonstrates the core value. Create `design/requirements.md` to capture your extracted requirements as a working checklist.

## Design references

`DESIGN.md` may include a `## Design References` section with Figma URLs and/or image references. Design mockup images live in `design/references/`. When these exist:

- Examine the images to understand intended layout, navigation patterns, and visual style
- Map visual elements to Vuetify components (if a `vuetify-figma` skill exists, use it)
- Treat design references as the "what it should look like" complement to the Vision's "what it should do"
- Figma URLs are informational — work from the uploaded screenshots, not the live Figma file

# Feature docs

Feature docs are used as working documents to help a user and agent collaborate on feature implementation. A feature can be whatever size you need -- an entire page, a shared composable, or a single component.

When a user starts working on implementing a change, if they are using a feature doc, read the relevant feature doc before starting work. Then update the feature doc with every change you make. Be sure to create checklists as you plan work, and check off the checklists as the work is completed. Document design choices and open questions.

If the user is implementing a change that has no feature doc, encourage them to work with you to create one before starting work. A new feature doc should be created by copying `design/feature_template.md` to a new file in `design`, giving it an appropriate name, and editing it from there.

**Exception for initial app builds:** When building a new app from scratch via `/build_my_app`, skip per-page feature docs. They add overhead during greenfield builds where the entire app is being created at once. Start using feature docs once the initial app is built and you're iterating on individual features.

It is a good practice to close out one feature doc and start a new one as the focus of the work shifts. It is acceptable to be working with multiple feature docs at once, if the user is working on multiple unconnected or loosely connected features. The sections of the feature doc are flexible and you should add or remove sections to fit the needs of the project.
