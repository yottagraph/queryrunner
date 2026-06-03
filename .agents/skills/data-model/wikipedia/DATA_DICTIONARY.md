# Data Dictionary: Wikipedia

## Source Overview

Wikipedia is a multilingual open encyclopedia. This source extracts biographical, geographic, and organizational entities from English Wikipedia (`en.wikipedia.org`), producing a `wikipedia_summary` property containing the article's introductory paragraph.

Entity classification is performed using the Wikidata truthy dump — each Wikipedia article links to a Wikidata item via a QID (e.g., Q42 = Douglas Adams), and the Wikidata P31 (instance of) property provides structured type information. Summaries are fetched via the MediaWiki API's `extracts` module, which returns clean plaintext intro sections.

No LLM calls are used in this pipeline. All extraction is deterministic.

| Pipeline | `Record.Source` |
|----------|----------------|
| All entities | `wikipedia` |

**Update cadence:** Initial load processes a Wikidata truthy dump plus SQL dumps for classification (~1-2 hours offline), then fetches summaries via the MediaWiki API (~2 days for ~3-4M entities). Incremental updates poll the Wikipedia RecentChanges API on a configurable interval (e.g., daily) and re-fetch summaries for changed articles.

---

## Entity Types

### `person`

A human being with an English Wikipedia article, classified via Wikidata P31 = Q5 (human).

- Primary key: `wikidata_qid`
- Entity resolver: named entity, mergeable. Strong ID = `wikidata_qid`.

### `location`

A geographic entity (city, country, sovereign state, town, village, settlement, etc.) with an English Wikipedia article, classified via Wikidata P31 matching location-related types (Q515, Q6256, Q3624078, Q532, Q3957, Q486972, etc.).

- Primary key: `wikidata_qid`
- Entity resolver: named entity, mergeable. Strong ID = `wikidata_qid`.

### `organization`

A company, business, institution, or organizational entity with an English Wikipedia article, classified via Wikidata P31 matching organization-related types (Q43229, Q4830453, Q783794, Q6881511, Q891723, etc.).

- Primary key: `wikidata_qid`
- Entity resolver: named entity, mergeable. Strong ID = `wikidata_qid`.

---

## Properties

### Shared Properties (all entity types)

#### Identity

* `wikidata_qid`
  * Definition: Wikidata item identifier. Globally unique, stable, never reused.
  * Examples: `"Q42"` (Douglas Adams), `"Q62"` (San Francisco), `"Q312"` (Apple Inc.)
  * Derivation: From Wikidata truthy dump (initial load) or MediaWiki API `pageprops.wikibase_item` (incremental updates).

* `wikibase_shortdesc`
  * Definition: Short human-readable description from Wikidata, typically one line summarizing what the entity is.
  * Examples: `"English author, humorist, and screenwriter"` (Q42), `"City and county in California, United States"` (Q62), `"American multinational technology company"` (Q312)
  * Derivation: From `page_props.sql.gz` dump field `wikibase-shortdesc` (initial load) or MediaWiki API `pageprops` with `ppprop=wikibase-shortdesc` (incremental updates).

#### Content

* `wikipedia_summary`
  * Definition: The first paragraph of the entity's English Wikipedia article intro, in plain text.
  * Examples:
    * (Douglas Adams) `"Douglas Noël Adams (11 March 1952 – 11 May 2001) was an English author, humorist, and screenwriter, best known as the creator of The Hitchhiker's Guide to the Galaxy. Originally a 1978 BBC radio comedy, The Hitchhiker's Guide to the Galaxy evolved into a \"trilogy\" of six books..."`
    * (San Francisco) `"San Francisco, officially the City and County of San Francisco, is the fourth-most populous city in California and the 17th-most populous in the United States..."`
  * Derivation: From the full intro text (MediaWiki API or XML dump extraction), split at the first paragraph break.

* `wikipedia_extended_summary`
  * Definition: The remaining paragraphs of the entity's English Wikipedia article intro beyond the first paragraph, in plain text. Empty for articles with only a single introductory paragraph.
  * Examples:
    * (Albert Einstein, paragraph 2) `"Born in the German Empire, Einstein moved to Switzerland in 1895, forsaking his German citizenship the following year..."`
  * Derivation: Paragraphs 2+ of the intro text, after splitting off the first paragraph for `wikipedia_summary`.

### Snippet

The snippet combines the Wikidata short description with the first sentence(s) of the article in the format: `"{wikibase_shortdesc} | {first sentence(s)}"`. Sentences are accumulated until the total snippet reaches ~300 characters. This format gives immediate topical context from the short description plus grounding detail from the article itself.

Example (Apple Inc.): `"American multinational technology company | Apple Inc. is an American multinational technology company headquartered in Cupertino, California, in Silicon Valley, best known for its consumer electronics, software and online services."`

---

## Entity Relationships

Relationships are extracted from Wikidata P-properties in the truthy dump. Each
relationship connects a subject entity to a target entity, both of which must be
classified (person, location, or organization). All extraction is deterministic.

### Person → Location

| Relationship | P-property | Example |
|---|---|---|
| `born_in` | P19 (place of birth) | Albert Einstein → born_in → Ulm |
| `died_in` | P20 (place of death) | Albert Einstein → died_in → Princeton |
| `citizen_of` | P27 (country of citizenship) | Albert Einstein → citizen_of → Germany |
| `resides_in` | P551 (residence) | Albert Einstein → resides_in → Princeton |

### Person → Organization

| Relationship | P-property | Example |
|---|---|---|
| `educated_at` | P69 (educated at) | Albert Einstein → educated_at → ETH Zurich |
| `employed_by` | P108 (employer) | Albert Einstein → employed_by → Institute for Advanced Study |
| `member_of` | P102, P54, P463 | Barack Obama → member_of → Democratic Party |

### Person → Person

| Relationship | P-property | Example |
|---|---|---|
| `has_father` | P22 (father) | — |
| `has_mother` | P25 (mother) | — |
| `spouse_of` | P26 (spouse) | — |
| `parent_of` | P40 (child) | — |

### Organization → Location

| Relationship | P-property | Example |
|---|---|---|
| `headquartered_in` | P159 (headquarters location) | Apple Inc. → headquartered_in → Cupertino |
| `in_country` | P17 (country) | Apple Inc. → in_country → United States |
| `located_in` | P131, P276 (admin territory, location) | Berlin → located_in → Germany |

### Organization → Organization

| Relationship | P-property | Example |
|---|---|---|
| `subsidiary_of` | P749 (parent organization) | Instagram → subsidiary_of → Meta |
| `parent_org_of` | P355 (subsidiary) | Meta → parent_org_of → Instagram |
| `owned_by` | P127 (owned by) | — |

### Organization → Person

| Relationship | P-property | Example |
|---|---|---|
| `founded_by` | P112 (founded by) | Apple Inc. → founded_by → Steve Jobs |
| `has_ceo` | P169 (CEO) | Apple Inc. → has_ceo → Tim Cook |

### Location → Location

| Relationship | P-property | Example |
|---|---|---|
| `in_country` | P17 (country) | Berlin → in_country → Germany |
| `located_in` | P131 (admin territory) | Berlin → located_in → Brandenburg |
| `has_capital` | P36 (capital) | Germany → has_capital → Berlin |
| `contains` | P150 (contains admin territory) | Germany → contains → Bavaria |
| `borders` | P47 (shares border with) | Germany → borders → France |

---

## Classification Reference

### Person (P31 target types)

| QID | Label |
|-----|-------|
| Q5 | human |

### Location (P31 target types)

| QID | Label |
|-----|-------|
| Q515 | city |
| Q6256 | country |
| Q3624078 | sovereign state |
| Q35657 | state of the United States |
| Q532 | village |
| Q3957 | town |
| Q486972 | human settlement |
| Q1549591 | big city |
| Q1093829 | city of the United States |

### Organization (P31 target types)

| QID | Label |
|-----|-------|
| Q43229 | organization |
| Q4830453 | business |
| Q783794 | company |
| Q6881511 | enterprise |
| Q891723 | public company |
| Q161726 | multinational corporation |
| Q163740 | nonprofit organization |
| Q484652 | international organization |
| Q3918 | university |
| Q327333 | government agency |
