# Data Dictionary: EDGAR

## Source Overview

SEC EDGAR (Electronic Data Gathering, Analysis, and Retrieval) filings via two pipelines:
- **Company facts / XBRL**: structured financial data from `companyfacts.zip` and `submissions.zip` bulk APIs
- **Form parsing**: regulatory forms (10-K, 10-Q, 20-F, 8-K, Form 3/4, SC 13D/G, 13F-HR, DEF 14A) parsed from HTML, XML, and SGML documents

Financial figures from XBRL may be computed fallbacks when a company does not file the authoritative tag. Not all companies report all fields.

| Pipeline | `Record.Source` |
|----------|----------------|
| Company facts / XBRL / submissions | `edgar` |
| 10-K annual report | `edgar_10k` |
| 10-Q quarterly report | `edgar_10q` |
| 20-F foreign issuer annual report | `edgar_20f` |
| 8-K current report | `edgar_8k` |
| Form 3 initial ownership | `edgar_3` |
| Form 4 ownership changes | `edgar_4` |
| SC 13D beneficial ownership (active) | `edgar_sc_13d` |
| SC 13G beneficial ownership (passive) | `edgar_sc_13g` |
| Co-registrant / subsidiary | `edgar_coregistrant` |
| 13F-HR institutional holdings | `edgar_13fhr` |
| DEF 14A proxy statement | `edgar_def_14a` |

---

## Entity Types

### `organization`

A public company, institutional investor, or corporate filer registered with the SEC.

- Primary key: `company_cik` (10-digit zero-padded CIK)
- Entity resolver: named entity. Strong ID = `company_cik`. Disambiguation via company name, city, state, SIC description, EIN. Ticker and former names as aliases.
- Financial metrics from XBRL are dual-homed on both the filing document and the organization, with a `filing_period` attribute (`FY`, `Q1`, `Q2`, `Q3`) to distinguish annual from quarterly values.

### SEC Filing Types (namespace: `sec`)

Each SEC form type is a separate flavor, namespaced under `sec`. All share the same strong ID (`accession_number`) and are not mergeable.

| Flavor | Display Name | Description |
|--------|-------------|-------------|
| `sec::10_k` | 10-K | Annual report |
| `sec::10_q` | 10-Q | Quarterly report |
| `sec::20_f` | 20-F | Foreign private issuer annual report |
| `sec::8_k` | 8-K | Current report (material events) |
| `sec::form_3` | Form 3 | Initial statement of beneficial ownership |
| `sec::form_4` | Form 4 | Statement of changes in beneficial ownership |
| `sec::sc_13d` | SC 13D | Beneficial ownership report (activist) |
| `sec::sc_13g` | SC 13G | Beneficial ownership report (passive) |
| `sec::13f_hr` | 13F-HR | Institutional investment manager holdings |
| `sec::def_14a` | DEF 14A | Definitive proxy statement |

### Sub-Records (8-K Events, Form 4 Transactions, Form 3 Holdings)

Sub-records are **separate graph entities**, not nested properties on the parent filing. Each sub-record has its own NEID and can be queried independently. They use the same flavor as their parent filing (e.g., `sec::8_k` for 8-K events, `sec::form_4` for Form 4 transactions).

**Entity naming pattern:**
- 8-K events: `{accession_number}_evt_{n}` (e.g., `0000320193-24-000067_evt_1`)
- Form 4 transactions: `{accession_number}_trx_{n}` (e.g., `0000320193-24-000067_trx_1`)
- Form 3 holdings: `{accession_number}_holding_{n}`

**Relationships on sub-records:**
- `filed` — points to the parent filing's accession number
- `issued_by` — points to the company

**Critical querying note:** Properties like `form_8k_event`, `form_8k_item_code`, `transaction_type`, `shares_transacted`, and other sub-record-specific properties do NOT appear on the parent filing entity or the organization entity. You must traverse the graph to the sub-record entities to access them.

**Traversal path:**
```
organization --[filed]--> 8-K filing --[linked, distance 1]--> event sub-records
```

**Example: Finding 8-K event sub-records for a company:**
1. Get filing NEIDs from the organization's `filed` property
2. Filter to 8-K filings by checking `form_type == "8-K"`
3. For each 8-K filing, use a `linked` expression (distance 1, direction both) to find connected entities
4. Exclude the organization and the filing itself from results — the remaining entities are the event sub-records
5. Query those sub-record NEIDs for `form_8k_event` and `form_8k_item_code`

### `person`

A corporate insider (officer, director, or significant owner) from Form 3 or Form 4.

- Primary key: `person_cik` when available; otherwise named entity resolution.
- Entity resolver: named entity, mergeable. Strong ID = `person_cik` when present.

### `financial_instrument`

A tradeable security identified by CUSIP, from 13F-HR filings.

- Primary key: `cusip_number`
- Entity resolver: named entity. Strong ID = `cusip_number`.

---

## Properties

### Organization Properties

#### Identity and Registration (source: `edgar`)

Data source: `https://data.sec.gov/submissions/CIK{cik}.json`

* `company_cik`
  * Definition: SEC Central Index Key, 10-digit zero-padded.
  * Examples: `"0000320193"` (Apple), `"0000789019"` (Microsoft)
  * Derivation: `cik` field from submissions API, zero-padded.

* `ticker`
  * Definition: Primary stock ticker symbol. Only set for listed companies.
  * Examples: `"AAPL"`, `"MSFT"`, `"BRK-A"`
  * Derivation: first entry from `tickers` array.

* `exchange`
  * Definition: Securities exchange listing.
  * Examples: `"Nasdaq"`, `"NYSE"`, `"OTC"`
  * Derivation: first entry from `exchanges` array.

* `sic_code`
  * Definition: Four-digit Standard Industrial Classification code.
  * Examples: `"3571"`, `"6022"`
  * Derivation: `sic` field.

* `sic_description`
  * Definition: Human-readable SIC code description.
  * Examples: `"Electronic Computers"`, `"State Commercial Banks"`
  * Derivation: `sicDescription` field.

* `state_of_incorporation`
  * Definition: Two-letter US state or country code of incorporation.
  * Examples: `"CA"`, `"DE"`, `"NY"`
  * Derivation: `stateOfIncorporation` field.

* `fiscal_year_end`
  * Definition: Fiscal year end as MMDD string.
  * Examples: `"0930"`, `"1231"`
  * Derivation: `fiscalYearEnd` field.

* `ein`
  * Definition: IRS Employer Identification Number (9 digits). Known bogus EINs filtered.
  * Example: `"942404110"`
  * Derivation: `ein` field, validated against bogus list.

* `business_phone`
  * Definition: Primary business phone number.
  * Example: `"4089961010"`
  * Derivation: `addresses.business.phone` field.

* `filer_category`
  * Definition: SEC filer size category.
  * Examples: `"Large accelerated filer"`, `"Non-accelerated filer"`
  * Derivation: `category` field.

* `physical_address`
  * Definition: Business address as formatted string.
  * Example: `"One Apple Park Way, Cupertino, CA 95014"`
  * Derivation: `addresses.business` fields concatenated.

* `mailing_address`
  * Definition: Mailing address as formatted string. May differ from physical address.
  * Derivation: `addresses.mailing` fields concatenated.

* `former_name`
  * Definition: Previous legal name. One value per entry in former names list.
  * Example: `"Apple Computer, Inc."`
  * Derivation: `formerNames` array. Also used as aliases for entity resolution.

#### Financial Data (source: `edgar_10k`, `edgar_10q`, `edgar_20f`)

Data source: iXBRL inline financial statements. All values USD unless noted.
The six core financial properties appear on both the **organization** and its **document** (filing) entity so that revenue/income/balance-sheet values are queryable on the company directly.

* `total_revenue` — Total revenues. Unit: USD. On: organization + document
* `net_income` — Net income or loss. Unit: USD. On: organization + document
* `total_assets` — Sum of all balance sheet assets. Unit: USD. On: organization + document
* `total_liabilities` — Sum of all liabilities. May be computed fallback. Unit: USD. On: organization + document
* `shareholders_equity` — Total stockholders' equity. Unit: USD. On: organization + document
* `shares_outstanding` — Common shares outstanding. Unit: shares. On: organization + document
* `eps_basic` — Basic earnings per share (10-K only). Unit: USD. On: document only
* `eps_diluted` — Diluted earnings per share (10-K only). Unit: USD. On: document only
* `entity_shell_company` — Whether the entity is a shell company. Values: `"true"`, `"false"`. On: organization only
* `reporting_currency` — ISO 4217 currency code (20-F only). Examples: `"JPY"`, `"EUR"`. On: document only
* `country_of_incorporation` — Country of incorporation (20-F only). Examples: `"Japan"`, `"Israel"`. On: document only

#### 8-K Corporate Events (source: `edgar_8k`)

Data source: 8-K current report filings.

> **Important:** These properties are on **event sub-record entities**, not on the parent 8-K filing or the organization. See the [Sub-Records section](#sub-records-8-k-events-form-4-transactions-form-3-holdings) above for how to find them.

**Core event properties:**
* `form_8k_event` — Snake_case event identifier. Examples: `"material_agreement"`, `"officer_director_change"`
* `form_8k_item_code` — Raw SEC item number. Examples: `"1.01"`, `"5.02"`
* `event_severity` — Event importance classification. Values: `"critical"`, `"high"`, `"medium"`, `"low"`
* `category` — Sub-classification of Item 8.01 Other Events. Examples: `"cybersecurity_incident"`

**Sub-record identity and relationships:**
* `accession_number` — Synthetic sub-record identifier. Example: `"0000320193-24-000067_evt_1"`
* `filed` — Relationship: event sub-record → parent 8-K filing
* `issued_by` — Relationship: event sub-record → company

**Item 8.01 keyword flags** (set to `"true"` when matched):
* `8k_cybersecurity_keyword` — Cybersecurity-related disclosure detected
* `8k_litigation_keyword` — Litigation-related disclosure detected
* `8k_regulatory_keyword` — Regulatory-related disclosure detected
* `8k_operational_keyword` — Operational issue disclosure detected

**ABS event flags** (Items 6.01–6.05, set to `"true"` when applicable):
* `abs_servicing_event` — Item 6.01: ABS servicing event
* `abs_servicer_change` — Item 6.02: ABS servicer change
* `abs_credit_enhancement_change` — Item 6.03: ABS credit enhancement change
* `abs_failure_event` — Item 6.04: ABS failure to make distribution
* `abs_securities_act` — Item 6.05: ABS Securities Act updating disclosure

#### Beneficial Ownership (source: `edgar_sc_13d`, `edgar_sc_13g`)

Data source: SC 13D/G XML filings. Properties on the filer organization.

* `owns_stake_in` — Relationship: filer → issuer whose shares are held
* `group_shares_declared` — Total shares owned by the filing group. Unit: shares
* `group_ownership_percent` — Percentage of share class owned by the group
* `is_group_filing` — Float: `1.0` = group filing, `0.0` = single filer
* `shares_declared` — Shares by individual group member. Unit: shares
* `ownership_percent` — Percentage by individual member or SC 13G filer
* `investment_purpose` — Stated purpose from Item 4. Examples: `"Investment"`, `"Strategic investment"`
* `is_passive_investor` — Always `1.0` on SC 13G records
* `aggregate_amount_beneficially_owned` — Total shares beneficially owned. Unit: shares
* `sole_voting_power` / `shared_voting_power` — Sole/shared voting authority. Unit: shares
* `sole_dispositive_power` / `shared_dispositive_power` — Sole/shared dispositive power. Unit: shares
* `type_of_reporting_person` — SEC entity code. Examples: `"CO"`, `"IN"`, `"IA"`
* `citizenship_or_state_of_organization` — Jurisdiction. Examples: `"Delaware"`, `"Cayman Islands"`
* `source_of_funds` — Acquisition fund source. Examples: `"WC"`, `"OO"`, `"BK"`
* `cusip_number` — CUSIP of the subject securities. Example: `"037833100"`

#### Subsidiary Relationships (source: `edgar_coregistrant`, `edgar_10k`)

Data source: co-registrant entries and EX-21 exhibit subsidiary tables.

* `has_subsidiary` — Relationship: parent → subsidiary
* `is_part_of` — Relationship: subsidiary → parent
* `citizenship_or_state_of_organization` — Subsidiary jurisdiction (EX-21 only)

### Document Properties

#### Filing Metadata (all pipelines)

* `accession_number` — SEC accession number. Example: `"0000320193-24-000123"`
* `form_type` — Normalized form type. Examples: `"10-K"`, `"SC 13D"`, `"4"`
* `filing_date` — Submission date (YYYY-MM-DD)
* `issued_by` — Relationship: filing → company the filing pertains to. For annual/quarterly/current reports, this is the filer. For ownership forms (Form 3/4, SC 13D/G), this is the issuer company whose securities are the subject of the filing.
  * Derivation (ownership forms): XML `<issuerCik>` / `<issuerName>` elements, with fallback to SEC submissions API index metadata for Forms 3/4/5 or the SGML header `<SUBJECT-COMPANY>` section for SC 13D/G. Omitted when no reliable issuer data is available.
* `refers_to` — Relationship: filing → company the document is about. Same derivation as `issued_by` for ownership forms.

#### XBRL Financial Facts (source: `edgar`)

Data source: `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`. ~75 XBRL properties tracked across US-GAAP, DEI, and IFRS taxonomies. Atom timestamp = XBRL period end date, not filing date. Computed fallbacks carry `"Computed from ..."` citation.

Key US-GAAP properties: `us_gaap:assets`, `us_gaap:liabilities`, `us_gaap:stockholders_equity`, `us_gaap:revenues`, `us_gaap:net_income_loss`, `us_gaap:operating_income_loss`, `us_gaap:operating_cash_flow`, `us_gaap:investing_cash_flow`, `us_gaap:financing_cash_flow`, `us_gaap:gross_profit`, `us_gaap:long_term_debt`, `us_gaap:common_shares_outstanding`, `us_gaap:goodwill`, `us_gaap:pp_and_e_net`, `us_gaap:operating_expenses`, `us_gaap:sg_and_a`, `us_gaap:research_and_development`, `us_gaap:income_tax_expense`, `us_gaap:eps_basic_xbrl`, `us_gaap:eps_diluted_xbrl`, `us_gaap:weighted_avg_shares_basic`, `us_gaap:weighted_avg_shares_diluted`, `us_gaap:share_repurchases`, `us_gaap:dividends_common`, `us_gaap:debt_repayments`, `us_gaap:acquisition_payments`, `us_gaap:comprehensive_income`, `us_gaap:asset_impairment`, `us_gaap:goodwill_impairment`, `us_gaap:number_of_segments`.

DEI properties: `dei:public_float`, `dei:common_shares_outstanding`, `dei:number_of_employees`.

IFRS properties (foreign private issuers): `ifrs:assets`, `ifrs:cash_and_cash_equivalents`, `ifrs:equity`, `ifrs:profit_loss`, `ifrs:operating_cash_flow`, `ifrs:current_assets`, `ifrs:current_liabilities`, `ifrs:liabilities`, `ifrs:revenue`.

Full mapping in `XBRLConceptMappings`.

#### SC 13D on Document (source: `edgar_sc_13d`)

* `filer` — Relationship: document → beneficial owner
* `group_member` — Relationship: document → group members (excluding primary filer)
* `group_shares_declared`, `group_ownership_percent`, `is_group_filing` — Filing-level ownership facts

### Person Properties

#### Insider Identity (source: `edgar_3`, `edgar_4`)

Data source: Form 3/4 XML.

* `person_cik` — SEC CIK for the reporting person (10-digit zero-padded). From `<rptOwnerCik>`.
* `job_title` — Officer title. Examples: `"Chief Executive Officer"`, `"Director"`. From `<officerTitle>`.
* `is_officer` — Relationship: person → organization (when `<isOfficer>1`)
* `is_director` — Relationship: person → organization (when `<isDirector>1`)
* `is_ten_percent_owner` — Relationship: person → organization (when `<isTenPercentOwner>1`)
* `works_at` — Relationship: person → issuer company
* `filing_reference` — Relationship: person → source Form 3/4 document

#### Form 4 Transactions (source: `edgar_4`)

> **Important:** These properties are on **transaction sub-record entities**, not on the parent Form 4 filing. See the [Sub-Records section](#sub-records-8-k-events-form-4-transactions-form-3-holdings) above for how to find them.

**Sub-record identity and relationships:**
* `accession_number` — Synthetic sub-record identifier. Example: `"0000320193-24-000067_trx_1"`
* `filed` — Relationship: transaction sub-record → parent Form 4 filing
* `issued_by` — Relationship: transaction sub-record → issuer company

**Transaction properties:**
* `transaction_type` — Human-readable code description. Examples: `"Open market or private purchase"`, `"Grant, award, or other acquisition"`
* `transaction_date` — Transaction date (YYYY-MM-DD)
* `acquired_disposed_code` — `"A"` (acquired) or `"D"` (disposed)
* `security_type` — Security class. Examples: `"Common Stock"`, `"Stock Option (Right to Buy)"`
* `shares_transacted` — Shares transferred. Unit: shares
* `price_per_share` — Transaction price. Unit: USD
* `shares_owned_after` — Post-transaction shares. Unit: shares
* `exercise_price` — Derivative exercise price (USD, derivatives only)
* `direct_or_indirect_ownership` — `"Direct"` or `"Indirect"`
* `is_10b5_1_plan` — `"true"` when under a Rule 10b5-1 plan

#### DEF 14A Proxy (source: `edgar_def_14a`)

* `board_committee` — Committee membership. Examples: `"Audit"`, `"Compensation"`
* `is_independent` — Independence classification. Values: `"true"`, `"false"`
* `director_since` — Year. Example: `"2018"`
* `total_compensation` — Summary Compensation Table total. Unit: USD
* `board_size` — Number of directors (also on document)
* `compares_to` — Relationship: document → peer companies
* `auditor` — Accounting firm name. Example: `"Ernst & Young LLP"`
* `audit_fees` — Auditor fees. Unit: USD

### Financial Instrument Properties

#### 13F-HR Holdings (source: `edgar_13fhr`)

Data source: 13F-HR XML information table.

* `cusip_number` — CUSIP identifier. Example: `"037833100"`
* `security_type` — Security class. Examples: `"COM"`, `"SHS"`, `"COM CL A"`
* `position_value` — Market value (USD)
* `shares_held` — Shares or principal amount held
* `instrument_type` — `"SH"` (shares) or `"PRN"` (principal amount)
* `put_call` — `"PUT"`, `"CALL"`, or empty for equity
* `voting_authority_sole` / `voting_authority_shared` / `voting_authority_none` — Voting authority breakdown. Unit: shares
* `investment_discretion` — `"SOLE"`, `"DFND"`, or `"OTR"` (on organization)
* `holds_position` — Relationship: investment manager → financial instrument

---

## Entity Relationships

> **Sub-record traversal:** Sub-records (8-K events, Form 4 transactions, Form 3 holdings) are separate document entities. To find them, traverse from the parent filing using a `linked` expression (distance 1). The sub-record's `filed` property points back to the parent filing, and `issued_by` points to the company.

```
organization         ──[filed]────────────────────→ document
organization         ──[filing_reference]─────────→ document
organization         ──[owns_stake_in]────────────→ organization    (SC 13D/G)
organization         ──[has_subsidiary]───────────→ organization    (co-registrant, EX-21)
organization         ──[is_part_of]───────────────→ organization    (subsidiary → parent)
organization         ──[holds_position]───────────→ financial_instrument (13F-HR)
document             ──[issued_by]────────────────→ organization
document             ──[refers_to]────────────────→ organization
document             ──[filer]────────────────────→ organization    (SC 13D/G)
document             ──[group_member]─────────────→ organization    (SC 13D)
document             ──[compares_to]──────────────→ organization    (DEF 14A)
document (sub-record)──[filed]────────────────────→ document        (8-K event → parent 8-K filing)
document (sub-record)──[issued_by]────────────────→ organization    (8-K event / Form 4 txn → company)
person               ──[is_officer]───────────────→ organization
person               ──[is_director]──────────────→ organization
person               ──[is_ten_percent_owner]─────→ organization
person               ──[works_at]─────────────────→ organization
person               ──[filing_reference]─────────→ document
financial_instrument ──[filing_reference]─────────→ document
```
