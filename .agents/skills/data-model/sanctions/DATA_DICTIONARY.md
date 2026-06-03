# Data Dictionary: Sanctions

## Purpose

Sanctioned persons and organizations from [OpenSanctions](https://www.opensanctions.org/), which aggregates sanctions lists from US OFAC, UK HM Treasury, EU, UN, Swiss SECO, and others. Input is OpenSanctions JSON (arrays or newline-delimited). Static reference data loaded in bulk. Only entities with `target: true` are ingested.

`Record.Source`: `sanctions-source`

---

## Entity Types

### `person`

A sanctioned individual listed on one or more sanctions lists.

- Primary key: OpenSanctions entity ID (`sanctions_id`)

### `organization`

A sanctioned company, legal entity, or other organization. OpenSanctions schema types `"Company"`, `"Organization"`, and `"LegalEntity"` all map here.

- Primary key: OpenSanctions entity ID (`sanctions_id`)

### `sanction_program`

A government or international sanctions program. Created implicitly as relationship targets; resolved by strong ID (the program name).

- Primary key: program name (e.g. `"OFAC-SDN"`, `"SECO-UKRAINE"`)

### `country`

Referenced by the `country` relationship on organization entities. Not created by this source.

- Primary key: ISO country code

---

## Properties

### Shared Properties (person + organization)

#### Identity

* `sanctions_id`
  * Definition: unique identifier from OpenSanctions.
  * Examples: `"ch-seco-94982"`, `"us-ofac-12345"`
  * Derivation: `id` field from the JSON entity record.

* `name`
  * Definition: a known name for this entity. One atom per entry in the source `name` array.
  * Examples: `"Zhongheng Lin"`, `"Acme Industries LLC"`
  * Derivation: each entry in `properties.name`.

* `alias`
  * Definition: an alternative name or spelling. One atom per source alias.
  * Examples: `"林仲恒 Lin"`, `"V. Putin"`
  * Derivation: each entry in `properties.alias`.

#### Sanctions Classification

* `sanction_program`
  * Definition: link to the sanctions program(s) under which this entity is designated. One atom per program.
  * Examples: `"SECO-UKRAINE"`, `"OFAC-SDN"`, `"GB-RUS"`
  * Derivation: each entry in `properties.programId`. Target `sanction_program` entity resolved by strong ID.

* `sanctions_topic`
  * Definition: classification tag for the type of designation. One atom per topic.
  * Examples: `"sanction"`, `"poi"`, `"debarment"`, `"entity.associate"`
  * Derivation: each entry in `properties.topics`.

#### Context

* `notes`
  * Definition: context about why this entity is sanctioned. Multiple source notes concatenated with ` | `.
  * Derivation: all entries from `properties.notes` concatenated.

* `sanctioned`
  * Definition: boolean flag (`1.0`) indicating a sanctions target. Emitted only when `notes` is absent.
  * Derivation: fallback marker set to `1.0` when the entity has no notes.

---

### Person-Only Properties

* `birth_date`
  * Definition: date of birth. Only the first value is stored.
  * Examples: `"1958-01-06"`, `"1952-10-07"`
  * Derivation: `properties.birthDate[0]`. ISO 8601 date string.

* `nationality`
  * Definition: nationality as a two-letter ISO country code. Falls back to `country` if nationality is empty.
  * Examples: `"cn"`, `"ru"`, `"us"`
  * Derivation: `properties.nationality[0]`, falling back to `properties.country[0]`.

* `position`
  * Definition: job title, political role, or official position. Only the first value is stored.
  * Examples: `"President of Russia"`, `"Owner of Shenzhen Biguang Technology"`
  * Derivation: `properties.position[0]`.

---

### Organization-Only Properties

* `country`
  * Definition: link to the associated country entity. Only the first value is stored.
  * Examples: `"ru"`, `"cn"`, `"ir"`
  * Derivation: `properties.country[0]`. Target entity uses the ISO country code as name.

* `address`
  * Definition: physical address. Only the first value is stored.
  * Examples: `"123 Main Street, Moscow, Russia"`, `"PO Box 456, Tehran"`
  * Derivation: `properties.address[0]`.

* `sector`
  * Definition: business sector or industry classification. Only the first value is stored.
  * Examples: `"Energy"`, `"Banking"`, `"Defense"`
  * Derivation: `properties.sector[0]`.

---

### Sanction Program Properties

None. Program entities carry only a strong ID (the program name) for resolution.

---

## Entity Relationships

```
person       ──[sanction_program]──→ sanction_program
organization ──[sanction_program]──→ sanction_program
organization ──[country]───────────→ country
```

---

## Attributes

None beyond standard atom metadata. Entity resolution snippets are carried on `Subject.NamedEntityResolverInformation.Snippets`.
