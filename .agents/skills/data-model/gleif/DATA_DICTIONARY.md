# Data Dictionary: GLEIF

## Source Overview

GLEIF (Global Legal Entity Identifier Foundation) publishes the Legal Entity
Identifier (LEI) system — a global reference data standard for legal entities
participating in financial transactions. The data is updated three times daily
via the Golden Copy and is freely accessible through a public REST API.

The GLEIF dataset provides two levels of data:
- **Level 1**: Entity reference data ("who is who") — ~3.25M legal entities
- **Level 2**: Relationship data ("who owns whom") — direct and ultimate
  parent relationships

| Pipeline | `Record.Source` |
|----------|----------------|
| LEI entity reference + relationships | `gleif-source` |

---

## Entity Types

### `organization`

A legal entity registered in the global LEI system. Includes corporations,
funds, branches, sole proprietorships, and other legal entity types
worldwide.

- Primary key: `lei` (20-character alphanumeric Legal Entity Identifier)
- Entity resolver: named entity, mergeable. Strong ID = `lei`.
  Disambiguation via legal name, jurisdiction, headquarters address.
  Other names and transliterated names as aliases.

---

## Properties

### Organization Properties

#### Identity and Registration

Data source: GLEIF API `GET /api/v1/lei-records` — `attributes.entity.*`
and `attributes.registration.*` fields.

* `lei`
  * Definition: Legal Entity Identifier — a 20-character alphanumeric code
    uniquely identifying a legal entity in the global financial system.
  * Examples: `"5493001KJTIIGC8Y1R12"`, `"549300RMUDWPHCUQNE66"`
  * Derivation: `attributes.lei` field, verbatim.

* `jurisdiction`
  * Definition: ISO 3166-1 or ISO 3166-2 jurisdiction code where the
    entity is legally registered.
  * Examples: `"US-DE"`, `"LU"`, `"GB"`, `"JP"`
  * Derivation: `entity.jurisdiction` field, verbatim.

* `legal_entity_category`
  * Definition: Classification of the legal entity type.
  * Examples: `"GENERAL"`, `"FUND"`, `"BRANCH"`, `"SOLE_PROPRIETOR"`
  * Derivation: `entity.category` field, verbatim.

* `legal_entity_status`
  * Definition: Current status of the legal entity itself.
  * Examples: `"ACTIVE"`, `"INACTIVE"`, `"MERGED"`, `"RETIRED"`,
    `"ANNULLED"`, `"CANCELLED"`, `"TRANSFERRED"`, `"DUPLICATE"`
  * Derivation: `entity.status` field, verbatim.

* `legal_form_code`
  * Definition: Entity Legal Form (ELF) code from the ISO 20275 standard.
  * Examples: `"6IIM"`, `"U8KA"`, `"T91T"`
  * Derivation: `entity.legalForm.id` field. Falls back to
    `entity.legalForm.other` when the standard code is absent.

* `registered_as`
  * Definition: Registration number of the entity at its registration
    authority.
  * Examples: `"26036723"`, `"B262009"`, `"4348344"`
  * Derivation: `entity.registeredAs` field, verbatim.

* `registration_authority_id`
  * Definition: Identifier of the business registry where the entity is
    registered.
  * Examples: `"RA000604"`, `"RA000432"`
  * Derivation: `entity.registeredAt.id` field.

* `entity_creation_date`
  * Definition: Date when the legal entity was created (incorporated).
  * Examples: `"2007-06-05"`, `"2021-12-08"`
  * Derivation: `entity.creationDate` field, truncated to date.

#### Addresses

* `legal_address`
  * Definition: Full legal (registered) address as a formatted string.
  * Examples: `"349 Decatur Street, Atlanta, US-GA, US 30312"`,
    `"21, Rue d'Epernay, Luxembourg, LU-LU, LU L-1490"`
  * Derivation: Concatenation of `entity.legalAddress` fields: address
    lines, city, region, country, postal code.

* `headquarters_address`
  * Definition: Full headquarters address as a formatted string.
  * Examples: `"731 Lexington Avenue, New York, US-NY, US 10022"`
  * Derivation: Concatenation of `entity.headquartersAddress` fields.

* `legal_address_country`
  * Definition: ISO 3166-1 alpha-2 country code from the legal address.
  * Examples: `"US"`, `"LU"`, `"GB"`, `"DE"`
  * Derivation: `entity.legalAddress.country` field, verbatim.

* `headquarters_country`
  * Definition: ISO 3166-1 alpha-2 country code from the headquarters
    address.
  * Examples: `"US"`, `"LU"`, `"GB"`, `"DE"`
  * Derivation: `entity.headquartersAddress.country` field, verbatim.

#### LEI Registration

* `registration_status`
  * Definition: Current status of the LEI registration itself (distinct
    from entity status).
  * Examples: `"ISSUED"`, `"LAPSED"`, `"RETIRED"`, `"PENDING_ARCHIVAL"`,
    `"ANNULLED"`, `"CANCELLED"`, `"TRANSFERRED"`, `"DUPLICATE"`
  * Derivation: `registration.status` field, verbatim.

* `initial_registration_date`
  * Definition: Date when the LEI was first issued.
  * Examples: `"2012-12-06"`, `"2026-03-16"`
  * Derivation: `registration.initialRegistrationDate` field, truncated
    to date.

* `next_renewal_date`
  * Definition: Date by which the LEI registration must be renewed.
  * Examples: `"2027-01-25"`, `"2027-03-16"`
  * Derivation: `registration.nextRenewalDate` field, truncated to date.

* `corroboration_level`
  * Definition: Level of corroboration of the entity's reference data.
  * Examples: `"FULLY_CORROBORATED"`, `"PARTIALLY_CORROBORATED"`,
    `"ENTITY_SUPPLIED_ONLY"`
  * Derivation: `registration.corroborationLevel` field, verbatim.

#### Mapped Identifiers

* `bic_code`
  * Definition: SWIFT/BIC code mapped to this LEI. Sparse — only
    available for financial institutions.
  * Examples: `"DEUTDEFF"`, `"BNPAFRPP"`
  * Derivation: `attributes.bic` field when non-null.
  * Note: Not available for most entities.

* `ocid`
  * Definition: OpenCorporates company identifier mapped to this LEI.
  * Examples: `"us_de/4348344"`, `"gb/12345678"`
  * Derivation: `attributes.ocid` field when non-null.
  * Note: Available for a subset of entities.

* `isin`
  * Definition: International Securities Identification Number (ISO 6166) for
    a financial instrument issued by this entity. Multi-valued — an entity may
    have many ISINs.
  * Examples: `"US0378331005"`, `"GB0002634946"`, `"DE0007236101"`
  * Derivation: GLEIF-ANNA daily ISIN-to-LEI mapping CSV at
    `https://mapping.gleif.org/api/v2/isin-lei`. One atom per ISIN.
  * Note: Coverage depends on which NNAs participate in the GLEIF-ANNA mapping
    initiative (currently ~8.4M mappings across ~116 NNAs).

#### Successor

* `successor_lei`
  * Definition: LEI of the successor entity, set when this entity has
    been merged into or transferred to another entity.
  * Examples: `"549300RMUDWPHCUQNE66"`
  * Derivation: `entity.successorEntity.lei` when non-null. For entities
    with multiple successors, uses `entity.successorEntities[0].lei`.
  * Note: Only populated for entities with status MERGED or TRANSFERRED.

---

## Entity Relationships

### Ownership (Level 2 data)

Derived from the GLEIF API `include=direct-parent,ultimate-parent`
relationship data on LEI records.

* `direct_parent`
  * Definition: The entity is directly consolidated by (directly owned
    or controlled by) the target parent entity.
  * Examples: "Bloomberg L.P. has direct parent Bloomberg Inc."
  * Derivation: `relationships.direct-parent.data.id` when the
    relationship type is `"lei-records"` (not `"reporting-exceptions"`).
  * Note: Not all entities report parent relationships. Reporting
    exceptions are logged but do not produce relationship atoms.

* `ultimate_parent`
  * Definition: The entity is ultimately consolidated by (ultimately
    owned or controlled by) the target parent entity at the top of
    the corporate hierarchy.
  * Examples: "Bloomberg Finance L.P. has ultimate parent Bloomberg Inc."
  * Derivation: `relationships.ultimate-parent.data.id` when the
    relationship type is `"lei-records"`.
  * Note: When direct parent equals ultimate parent, both relationships
    are still emitted.

Inverse lookups (parent → subsidiaries) are handled by the DB/agent layer
via inverse queries on `direct_parent` and `ultimate_parent`.

```
organization ──[direct_parent]──────→ organization   (Level 2, child → parent)
organization ──[ultimate_parent]────→ organization   (Level 2, child → ultimate parent)
```
