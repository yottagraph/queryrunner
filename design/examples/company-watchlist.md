# Company Watchlist - Design Document

## Project Overview

A focused app for tracking a set of companies over time. Users build a watchlist of companies they care about and see a real-time feed of news, sentiment changes, and key events.

**Created:** 2026-03-17
**App ID:** company-watchlist

## Vision

I want to build an app where I can maintain a list of companies I'm interested in, and see a feed of recent news and sentiment about those companies. Think of it as a personalized news dashboard for company monitoring.

Key features:

- Add/remove companies from a watchlist (persist across sessions)
- See recent news articles mentioning watched companies
- See sentiment trends for each company
- Click on a company to see its full entity profile

## Configuration

| Setting        | Value                                |
| -------------- | ------------------------------------ |
| Authentication | Auth0                                |
| Query Server   | https://query.pip.prod.g.lovelace.ai |

## Pages

### `/` - Watchlist Dashboard (single page)

Route: `/`
Description: The main (and only) page. Left panel has the editable watchlist; right panel shows the news feed filtered to watched companies. No separate pages needed -- this is a single-view app.

Implementation status: Not started

Details:

- Watchlist stored via `useAppFeaturePrefs('watchlist', { neids: [] as string[] })` — persists across sessions and follows the user within this app
- News fetched via `useElementalClient()` for each watched entity
- Sentiment via `appears_in` property attributes (entity-level sentiment from news articles)
- Entity lookup via `POST /entities/search` when adding companies by name

## Status

Not started -- run `/build_my_app`.
