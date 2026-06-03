# Entity Dashboard - Design Document

## Project Overview

A search-and-explore tool for the Lovelace Knowledge Graph. Users search for any entity (company, person, organization) and see a detailed dashboard of properties, relationships, recent events, and news.

**Created:** 2026-03-17
**App ID:** entity-dashboard

## Vision

I want to build an entity exploration tool. The user types a name (like "Apple" or "Elon Musk"), gets matched to the right entity, and then sees a rich dashboard with everything we know about that entity -- properties, related entities, recent events, and news mentions.

Key features:

- Entity search with fuzzy matching
- Property display (industry, country, identifiers, etc.)
- Relationship graph (related companies, people, orgs)
- Recent events timeline
- News article feed with sentiment indicators

## Configuration

| Setting        | Value                                |
| -------------- | ------------------------------------ |
| Authentication | Auth0                                |
| Query Server   | https://query.pip.prod.g.lovelace.ai |

## Pages

### `/` - Search

Route: `/`
Description: Landing page with a search bar. Uses `POST /entities/search` to resolve entity names. Displays a list of matches the user can click.

Implementation status: Not started

### `/entity/[neid]` - Entity Detail

Route: `/entity/[neid]`
Description: Dashboard for a single entity. Tabs or sections for: Overview (properties), Relationships, Events, News. All data from the Query Server via `useElementalClient()`.

Implementation status: Not started

Details:

- Properties via `getPropertyValues()` -- discover available PIDs with `getSchema()` first
- Relationships via the relationships endpoint
- Events via the events endpoint
- News via the articles endpoint
- Use in-page tabs (v-tabs + v-window) for sections

## Status

Not started -- run `/build_my_app`.
