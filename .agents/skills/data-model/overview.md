# Data Model Overview

The Lovelace knowledge graph is populated by multiple fetch sources. This document explains how to navigate the per-source documentation.

## Source Index

Use this table to find which source to consult for different types of information:

| Looking for... | Check these sources |
|----------------|---------------------|
| Public company data, SEC filings | edgar |
| Bank and financial institution data | fdic |
| Macroeconomic indicators, rates | fred |
| Legal Entity Identifiers (LEI), corporate ownership | gleif |
| News articles and press releases | newsdata |
| Prediction markets | polymarket |
| Sanctions lists, compliance data | sanctions |
| Stock prices, OHLCV market data | stocks |
| People, places, organizations (general knowledge) | wikipedia |

## Documentation Structure

Each source directory contains:

| File | Purpose |
|------|---------|
| `DATA_DICTIONARY.md` | Human-readable documentation of entity types, properties, relationships, and data pipelines |
| `schema.yaml` | Machine-readable schema definition |

Not all sources have both files. Check `SKILL.md` for which files each source provides.

## Common Concepts

All sources share these concepts:

- **Flavors**: Entity types (e.g., `organization`, `person`). Some are namespaced like `sec::10_k`.
- **Properties**: Fields on entities with types, descriptions, and domain flavors.
- **Relationships**: Links between entities (e.g., `issued_by`, `works_at`).
- **Strong IDs**: Properties that uniquely identify entities across sources (e.g., `company_cik`, `lei`).

## How Sources Interact

Entities from different sources can merge when they share a **strong ID**. For example, an organization from EDGAR and the same organization from sanctions will merge if they share an `lei` value.

Each source's DATA_DICTIONARY.md documents:
- Which entity types it creates
- What strong IDs it uses for resolution
- How its entities relate to other sources

## Schema Structure

Each `schema.yaml` follows this structure:

```yaml
name: "source_name"
description: "What this source provides"

extraction:
  flavors: closed    # or open - whether new flavors can be added
  properties: closed
  relationships: closed

flavors:
  - name: "entity_type"
    mergeability: not_mergeable  # or mergeable
    strong_id_properties: ["prop_name"]

properties:
  - name: "property_name"
    type: string
    domain_flavors: ["entity_type"]

relationships:
  - name: "relationship_name"
    domain_flavors: ["source_type"]
    target_flavors: ["target_type"]
```
