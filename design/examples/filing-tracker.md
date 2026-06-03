# Filing Tracker - Design Document

## Project Overview

Monitor SEC filings for a list of companies. Users configure which companies to track, and the app displays a chronological feed of recent filings with type, date, and description.

**Created:** 2026-03-17
**App ID:** filing-tracker

## Vision

I want to track SEC filings (10-K, 10-Q, 8-K, etc.) for a set of companies. I should be able to add companies to a tracking list, see a feed of their recent filings sorted by date, and click through to filing details.

Key features:

- Company tracking list (persist via KV)
- Filing feed showing form type, date, and description
- Filter by filing type (10-K, 10-Q, 8-K, etc.)
- Click to expand filing details

## Configuration

| Setting        | Value                                |
| -------------- | ------------------------------------ |
| Authentication | Auth0                                |
| Query Server   | https://query.pip.prod.g.lovelace.ai |

## Pages

### `/` - Filing Feed

Route: `/`
Description: Main page with two panels. Left: tracked companies (editable list). Right: chronological filing feed for all tracked companies, filterable by filing type.

Implementation status: Not started

Details:

- Company list stored via `useAppFeaturePrefs('filing-tracker', { companies: [] as string[] })` — persists across sessions and follows the user within this app
- Filings discovered via `getSchema()` to find filing-related flavors and PIDs
- Filing data via `getPropertyValues()` for each tracked company
- Discovery-first: don't hardcode PID names -- use schema to find filing_date, form_type, etc.
- Note: `getPropertyValues()` takes JSON-stringified arrays for eids and pids

## Cross-Cutting Concepts

### Filing entity discovery

Filing entities are linked to company entities via `data_nindex` properties. The workflow:

1. Get the company's NEID (from the tracking list)
2. Use `findEntities()` to find filings related to that company
3. Use `getPropertyValues()` to get filing details (date, type, description)

Use `getSchema()` to discover the exact flavor IDs and PID names for filings rather than hardcoding them.

## Status

Not started -- run `/build_my_app`.
