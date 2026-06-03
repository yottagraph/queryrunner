---
name: data-model
description: Understand the Lovelace data model - entity types, properties, relationships, and schemas from fetch sources like EDGAR, FRED, FDIC, and more.
---

# Data Model Skill

This skill provides documentation for the Lovelace data model, describing the entity types, properties, and relationships that each fetch source contributes to the knowledge graph.

## When to Use This Skill

Use this skill when you need to:
- Understand what entity types exist (organizations, people, filings, etc.)
- Know what properties are available on entities
- Understand relationships between entity types
- Look up the schema definition for a data source

## Quick Start

1. **Identify the source**: Determine which data source is relevant (EDGAR for SEC filings, FRED for economic data, etc.)
2. **Read the DATA_DICTIONARY.md**: Get human-readable documentation of entities, properties, and relationships
3. **Check schema.yaml**: For machine-readable schema definitions including flavors, properties, and extraction rules

## Available Sources

| Source | Description | Files |
|--------|-------------|-------|
| [edgar](edgar/) | SEC EDGAR filings - 10-K, 10-Q, 8-K, ownership forms, institutional holdings | DATA_DICTIONARY.md, schema.yaml |
| [fdic](fdic/) | FDIC BankFind Suite - insured institutions, branch data, failures | DATA_DICTIONARY.md, schema.yaml |
| [fred](fred/) | Federal Reserve Economic Data - GDP, employment, inflation, rates | DATA_DICTIONARY.md, schema.yaml |
| [gleif](gleif/) | Global Legal Entity Identifier Foundation - LEI records, corporate ownership | DATA_DICTIONARY.md, schema.yaml |
| [newsdata](newsdata/) | News articles and press releases with LLM extraction | schema.yaml |
| [polymarket](polymarket/) | Polymarket prediction markets via Gamma API | DATA_DICTIONARY.md, schema.yaml |
| [sanctions](sanctions/) | OpenSanctions - OFAC, EU, UN, HM Treasury sanctions lists | DATA_DICTIONARY.md, schema.yaml |
| [stocks](stocks/) | US equity OHLCV price data from Alpha Vantage (NYSE, NASDAQ, AMEX) | DATA_DICTIONARY.md, schema.yaml |
| [wikipedia](wikipedia/) | People, locations, and organizations from English Wikipedia | DATA_DICTIONARY.md, schema.yaml |

## File Types

### DATA_DICTIONARY.md

Human-readable documentation containing:
- **Source Overview**: What the source is and how data flows through the pipeline
- **Entity Types**: What flavors (entity types) this source creates, with primary keys and resolver behavior
- **Properties**: Field definitions with examples and derivation notes
- **Relationships**: How entities connect to each other

### schema.yaml

Machine-readable schema definition containing:
- **flavors**: Entity type definitions with mergeability and strong ID properties
- **properties**: Field definitions with types, descriptions, and domain flavors
- **relationships**: Link definitions with domain and target flavors
- **extraction**: Whether the schema is open or closed for each category

## See Also

- [overview.md](overview.md) - Core concepts and how to navigate the documentation
