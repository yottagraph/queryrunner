# Data Dictionary: FDIC

## Purpose

This dictionary documents the entity types, properties, and relationships that the FDIC source contributes to the Lovelace knowledge graph.

FDIC ingests data from the Federal Deposit Insurance Corporation's BankFind Suite API (`https://api.fdic.gov/banks/`), which provides public data on all FDIC-insured depository institutions in the United States. The source covers:

- **Institution profiles**: identity, location, charter, and regulatory information for ~4,300 active and ~27,800 total (including inactive) FDIC-insured banks and thrifts
- **Quarterly financial data**: balance sheet and income statement figures from Call Reports (FFIEC 031/041/051), updated quarterly with data back to 1984
- **Bank failures**: all 4,100+ FDIC-insured institution failures since 1934, including resolution details and acquiring institution

Financial figures are reported in thousands of USD as filed in Call Reports. Not all institutions report all fields; smaller banks (FFIEC 051 filers) report a reduced set.

**Source names used on records:**

| Pipeline | `Record.Source` |
|----------|----------------|
| Institution profiles + financials | `fdic` |
| Bank failures | `fdic_failure` |

---

## Entity Types

### `organization`

An FDIC-insured depository institution (commercial bank, savings bank, savings association, or industrial bank).

- Primary key: `fdic_certificate_number` (FDIC Certificate Number, unique identifier assigned to each insured institution)
- Entity resolver: named entity. Strong ID = `fdic_certificate_number`. Disambiguation context includes institution name, city, state, and holding company name. Prior names serve as aliases.
- Sources: `fdic`, `fdic_failure`

---

## Properties

### Organization Properties

#### Identity and Registration (source: `fdic`)

Data source: FDIC BankFind Suite Institutions API (`https://api.fdic.gov/banks/institutions`).

* `fdic_certificate_number`
  * The FDIC Certificate Number uniquely identifying this insured institution. Also serves as the entity's strong ID for resolution.
  * Examples: `"628"` (JPMorgan Chase Bank, N.A.), `"3850"` (First Community Bank)
  * Derivation: `CERT` field from the Institutions API response.

* `fed_rssd_id`
  * Federal Reserve RSSD ID, a unique identifier assigned by the Federal Reserve to every financial institution, branch, and office.
  * Examples: `"852218"`, `"242"`
  * Derivation: `FED_RSSD` field from the Institutions API response.

* `physical_address`
  * Headquarters street address formatted as a single string.
  * Examples: `"1111 Polaris Pkwy, Columbus, OH 43240"`, `"101 Main St, Xenia, IL 62899"`
  * Derivation: `ADDRESS`, `CITY`, `STALP`, `ZIP` fields concatenated from the Institutions API response.

* `charter_class`
  * FDIC institution charter class code describing the type of charter and regulatory supervision.
  * Examples: `"N"` (national bank, OCC-supervised), `"SM"` (state-chartered, Fed member), `"NM"` (state-chartered, non-Fed-member), `"SB"` (savings bank), `"SA"` (savings association)
  * Derivation: `BKCLASS` field from the Institutions API response.

* `regulatory_agency`
  * The primary federal regulatory agency supervising this institution.
  * Examples: `"OCC"` (Office of the Comptroller of the Currency), `"FED"` (Federal Reserve), `"FDIC"` (Federal Deposit Insurance Corporation)
  * Derivation: `REGAGNT` field from the Institutions API response.

* `established_date`
  * Date the institution was established, formatted as YYYY-MM-DD.
  * Examples: `"1824-01-01"`, `"1934-01-01"`
  * Derivation: `ESTYMD` field from the Institutions API response, reformatted from MM/DD/YYYY.

* `fdic_insurance_date`
  * Date the institution obtained FDIC insurance, formatted as YYYY-MM-DD.
  * Examples: `"1934-01-01"`, `"2005-06-15"`
  * Derivation: `INSDATE` field from the Institutions API response, reformatted from MM/DD/YYYY.

* `active_flag`
  * Whether the institution is currently active (open and operating).
  * Values: `1.0` = active, `0.0` = inactive
  * Derivation: `ACTIVE` field from the Institutions API response, stored as float.

* `holding_company_name`
  * Name of the top-tier bank holding company, if any.
  * Examples: `"JPMORGAN CHASE&CO"`, `"FIRST COMMUNITY BANCSHARES"`
  * Derivation: `NAMEHCR` field from the Institutions API response. Omitted when the institution is not part of a holding company.

* `website`
  * The institution's primary website URL.
  * Examples: `"www.jpmorganchase.com"`, `"www.fcbanking.com"`
  * Derivation: `WEBADDR` field from the Institutions API response. Omitted when blank.

* `fdic_geographic_region`
  * FDIC supervisory region name.
  * Examples: `"Chicago"`, `"Atlanta"`, `"Dallas"`
  * Derivation: `FDICREGN` field from the Institutions API response.

* `institution_category`
  * FDIC specialization group description classifying the institution by size and type.
  * Examples: `"International Specialization"`, `"ALL OTHER UNDER 1 BILLION"`, `"ALL OTHER 1 TO 10 BILLION"`
  * Derivation: `SPECGRPN` field from the Institutions API response.

* `office_count`
  * Total number of offices (branches) operated by the institution, including domestic and foreign.
  * Examples: `5320.0`, `1.0`, `25.0`
  * Derivation: `OFFICES` field from the Institutions API response, stored as float.

* `former_name`
  * A previous legal name of the institution. One property value per prior name entry.
  * Examples: `"Chemical Bank"`, `"The Chase Manhattan Bank"`
  * Derivation: `PRIORNAME1` through `PRIORNAME6` fields from the Institutions API response. Each non-empty prior name produces a separate atom. Prior names also serve as aliases for entity resolution.

#### Financial Data (source: `fdic`)

Data source: FDIC BankFind Suite Financials API (`https://api.fdic.gov/banks/financials`). All dollar amounts are in thousands of USD as reported in Call Reports. Updated quarterly; the `REPDTE` field indicates the report period end date.

* `total_assets`
  * Total assets of the institution as reported in Call Reports.
  * Unit: thousands of USD
  * Examples: `3752662000.0` (JPMorgan Chase, Q4 2025), `56044.0` (First Community Bank)
  * Derivation: `ASSET` field from the Financials API response, stored as float.

* `total_deposits`
  * Total deposits held by the institution.
  * Unit: thousands of USD
  * Examples: `2697842000.0`, `47678.0`
  * Derivation: `DEP` field from the Financials API response, stored as float.

* `total_liabilities`
  * Total liabilities.
  * Unit: thousands of USD
  * Derivation: `LIAB` field from the Financials API response, stored as float.

* `shareholders_equity`
  * Total equity capital.
  * Unit: thousands of USD
  * Derivation: `EQ` field from the Financials API response, stored as float.

* `net_income`
  * Net income (loss) for the reporting period. Negative for losses.
  * Unit: thousands of USD
  * Derivation: `NETINC` field from the Financials API response, stored as float.

* `net_loans_and_leases`
  * Net loans and leases after deducting allowance for loan losses.
  * Unit: thousands of USD
  * Derivation: `LNLSNET` field from the Financials API response, stored as float.

* `insured_deposits`
  * Estimated amount of insured deposits (covered by FDIC insurance, up to $250K per depositor).
  * Unit: thousands of USD
  * Derivation: `DEPINS` field from the Financials API response, stored as float.

* `uninsured_deposits`
  * Estimated amount of deposits exceeding FDIC insurance coverage limits.
  * Unit: thousands of USD
  * Derivation: `DEPUNINS` field from the Financials API response, stored as float.

* `return_on_assets`
  * Return on assets (annualized net income as a percentage of average total assets).
  * Examples: `1.34`, `1.42`
  * Derivation: `ROA` field from the Financials API response, stored as float. Expressed as a percentage.

* `return_on_equity`
  * Return on equity (annualized net income as a percentage of average total equity).
  * Examples: `15.32`, `16.87`
  * Derivation: `ROE` field from the Financials API response, stored as float. Expressed as a percentage.

* `net_interest_margin`
  * Net interest margin (net interest income as a percentage of average earning assets).
  * Examples: `2.96`, `3.91`
  * Derivation: `NIMY` field from the Financials API response, stored as float. Expressed as a percentage.

* `number_of_employees`
  * Total number of full-time equivalent employees.
  * Examples: `226674.0`, `12.0`
  * Derivation: `NUMEMP` field from the Financials API response, stored as float.

* `interest_income`
  * Total interest income for the reporting period.
  * Unit: thousands of USD
  * Derivation: `INTINC` field from the Financials API response, stored as float.

* `interest_expense`
  * Total interest expense for the reporting period.
  * Unit: thousands of USD
  * Derivation: `EINTEXP` field from the Financials API response, stored as float.

#### Failure Information (source: `fdic_failure`)

Data source: FDIC BankFind Suite Failures API (`https://api.fdic.gov/banks/failures`). These properties are set on organization entities for institutions that have failed.

* `failure_date`
  * Date the institution was closed by its chartering authority.
  * Examples: `"2026-01-30"`, `"2025-06-27"`
  * Derivation: `FAILDATE` field from the Failures API response, reformatted from M/D/YYYY to YYYY-MM-DD.

* `failure_resolution_type`
  * Type of resolution action taken by the FDIC.
  * Examples: `"P&A"` (Purchase and Assumption), `"PI"` (Purchase and Assumption — Insured Deposits), `"PA"` (Purchase and Assumption — All Deposits), `"PO"` (Payout)
  * Derivation: `RESTYPE1` field from the Failures API response.

* `failure_estimated_loss`
  * Estimated loss to the Deposit Insurance Fund (DIF) from the failure.
  * Unit: thousands of USD
  * Examples: `23460.0`, `30284.0`
  * Derivation: `COST` field from the Failures API response. Null when the estimate is not yet available.
  * Note: may be updated over time as the FDIC finalizes loss estimates.

* `failure_total_deposits`
  * Total deposits at the time of failure.
  * Unit: thousands of USD
  * Derivation: `QBFDEP` field from the Failures API response, stored as float.

* `failure_total_assets`
  * Total assets at the time of failure.
  * Unit: thousands of USD
  * Derivation: `QBFASSET` field from the Failures API response, stored as float.

* `acquired_by`
  * Link from the failed institution to the acquiring institution (the bank that purchased assets/assumed deposits).
  * Target flavor: `organization`
  * Examples: First Independence Bank acquired Metropolitan Capital B&T
  * Derivation: `BIDNAME` field from the Failures API response. Omitted when no acquirer (payout resolution). The acquiring institution is created as a separate organization entity identified by name.

---

## Entity Relationships

```
organization ──[acquired_by]──→ organization   (failed bank → acquirer, from fdic_failure)
```

---

## Attributes

FDIC records do not use source-specific attributes beyond the standard citation text on atoms.

- **Institution atoms**: citation text follows the pattern `"FDIC BankFind: {field_description} for {institution_name} (CERT: {cert})"`.
- **Financial atoms**: citation text follows the pattern `"FDIC Call Report ({report_date}): {field_description} for {institution_name} (CERT: {cert})"`.
- **Failure atoms**: citation text follows the pattern `"FDIC Failure: {institution_name} failed {failure_date}"`.
