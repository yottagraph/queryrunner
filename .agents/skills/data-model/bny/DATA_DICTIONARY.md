# Data Dictionary — BNY Arbitrage Rebate Analysis

## Source Description

Interim Arbitrage Rebate Analysis reports prepared by BLX Group LLC for
municipal bond issuers. Each report computes the arbitrage rebate liability
under IRC Section 148 for a bond issue across a computation period. Reports
include transmittal letters, legal opinions, notes/assumptions, summary
schedules (rebate analysis, sources/uses of funds), and detailed per-fund
cash flow and investment data.

BNY (Bank of New York Mellon) serves as trustee. Orrick, Herrington &
Sutcliffe LLP provides the accompanying legal opinion.

## Entity Types

### bond

The municipal bond issue itself. One entity per unique bond across all reports.

| Property | Type | Description |
|----------|------|-------------|
| `client_matter_number` | string | **Strong ID.** BLX Group client matter number (e.g. `42182-2748`). Invariant across all reports for the same bond. |
| `bonds_name` | string | Full name of the bonds (e.g. "Multifamily Housing Revenue Refunding Bonds (Presidential Plaza at Newport Project-FHA Insured Mortgages) 1991 Series 1") |
| `par_amount` | string | Total par amount of the bond issue (e.g. "$142,235,000") |
| `dated_date` | string | Dated date of the bonds (e.g. "September 15, 1991") |
| `issue_date` | string | Issue date of the bonds (e.g. "October 17, 1991") |
| `bond_yield` | string | Arbitrage yield / allowable yield on investments (e.g. "7.420898%") |
| `computation_period` | string | The computation period for this report (e.g. "October 17, 1991 through October 16, 2024") |
| `rebate_computation_date` | string | End date of the computation period (e.g. "October 16, 2024") |
| `cumulative_rebate_liability` | string | Total cumulative rebate liability (e.g. "$0.00") |
| `rebate_payment_due` | string | Amount due to the US (e.g. "$0.00") |
| `return_on_investments` | string | Weighted return on investments since prior computation date (e.g. "6.447251%") |
| `shortfall_pct` | string | Shortfall percentage: return minus yield (e.g. "-0.973647%") |
| `actual_gross_earnings` | string | Total actual gross earnings across all funds |
| `allowable_gross_earnings` | string | Total allowable gross earnings at bond yield |
| `excess_earnings` | string | Total excess (negative = under yield) |
| `report_date` | string | Date the report was issued (e.g. "December 6, 2024") |

### organization

Companies, agencies, law firms, and financial institutions named in the reports.

| Property | Type | Description |
|----------|------|-------------|
| `org_type` | string | Type: `government_agency`, `law_firm`, `financial_services`, `financial_institution`, `trust_company` |
| `description` | string | Role in the deal (e.g. "Issuer", "Trustee", "Bond Counsel") |

Expected entities:
- New Jersey Housing and Mortgage Finance Agency (Issuer)
- BLX Group LLC (Rebate Analyst)
- Orrick, Herrington & Sutcliffe LLP (Bond Counsel)
- BNY / Bank of New York Mellon (Trustee)
- Willdan Financial Services (Prior Report preparer)
- U.S. Department of the Treasury

### fund_account

Bond proceeds sub-accounts tracked for rebate computation purposes.

| Property | Type | Description |
|----------|------|-------------|
| `fund_status` | string | Current status: `Active` or `Inactive` |
| `computation_date_valuation` | string | Fair market value at computation date |
| `gross_earnings` | string | Total gross earnings for the fund |
| `internal_rate_of_return` | string | IRR on the fund's investments |
| `excess_earnings` | string | Excess earnings (negative = below yield) |

Expected entities:
- Reserve I Account
- Reserve II Account
- Prior Rebate Liability
- Liquidity I Account
- Liquidity II Account

Additional fund accounts mentioned in Notes and Assumptions:
- Revenue Account (bona fide debt service fund, excluded from rebate)
- Escrow Fund
- Debt Service Reserve Account
- Construction Account

### financial_instrument

Securities held within fund accounts (investments of bond proceeds).

| Property | Type | Description |
|----------|------|-------------|
| `par_amount` | string | Par amount of the security |
| `coupon` | string | Coupon rate (e.g. "7.000%" or "Variable") |
| `maturity_date` | string | Maturity date |
| `settlement_date` | string | Settlement date |
| `settlement_price` | string | Settlement price (e.g. "100.000") |
| `yield` | string | Yield on the security |
| `accreted_price` | string | Accreted price |
| `accrued_interest` | string | Accrued interest amount |
| `value` | string | Total value (par + accrued interest) |

Expected entities (scoped per fund via `entity_context_from_title`):
- Morgan IA (7% coupon, institutional investment)
- Federated MM (variable rate money market fund)

### legal_agreement

Governing legal documents referenced in the reports.

| Property | Type | Description |
|----------|------|-------------|
| `agreement_type` | string | Type: `arbitrage_certificate`, `trust_indenture`, `engagement_letter` |
| `description` | string | Description of the agreement's role |

Expected entities:
- Certificate as to Arbitrage (Section 8, Section 21 referenced)
- Prior Report (Willdan Financial Services, December 17, 2008)

### location

Addresses and jurisdictions.

Expected entities:
- Trenton, NJ (Issuer address)
- Dallas, TX (BLX Group address)
- New York, NY (Orrick address)
- State of New Jersey

### person

Signatories, if extractable from signatures on transmittal letters and opinions.
May be sparse — many PDFs have illegible or absent signature blocks.

## Relationships

| Relationship | Domain | Target | Description |
|-------------|--------|--------|-------------|
| `issuer_of` | organization | bond | Issuer issued the bonds |
| `trustee_of` | organization | bond | Trustee of the bond issue |
| `advisor_to` | organization | bond | BLX Group as rebate analyst; Orrick as bond counsel |
| `fund_of` | fund_account | bond | Fund account belongs to the bond issue |
| `holds_investment` | fund_account | financial_instrument | Fund holds a security as an investment |
| `party_to` | organization | legal_agreement | Entity is party to an agreement |
| `located_at` | organization | location | Organization's address |
| `predecessor_of` | legal_agreement | legal_agreement | Prior Report preceded current Report |

## Events

| Event | Severity | Description |
|-------|----------|-------------|
| Rebate computation | medium | Periodic computation of arbitrage rebate liability |
| Bond issuance | high | Original issuance of the bonds (October 17, 1991) |
| Bond refunding | high | Refunding of prior 1985 Series F and G bonds |
| Fund valuation | medium | Valuation of fund accounts at computation date |
| Rebate payment determination | high | Determination that rebate payment is/isn't due |
| Report issuance | low | Issuance of this rebate analysis report |

## Table Extraction

### Schedule A — Summary of Rebate Analysis

Maps to `rebate_analysis` table config. Key column: Fund Description.
Each row becomes a `fund_account` entity with properties for status,
valuation, earnings, IRR, and excess earnings.

### Schedule B — Sources & Uses of Funds

Maps to `sources_of_funds` and `uses_of_funds` table configs. Uses
`document_entity_from_title` mode to attach line items as properties
on the bond entity.

### Security Holdings (Schedules C1, D1, F1, G1)

Maps to `security_tables` config. Key column: Security Type. Each
security becomes a `financial_instrument` entity scoped by fund
account title. Properties: par amount, coupon, maturity, yield, etc.

### Cash Flow Tables (Schedules C2, D2, E1, F2, G2)

New table config needed. These are the largest tables — hundreds of rows
of deposit/withdrawal transactions for each fund account. Columns:
Date, Description, Cash Flow, Muni-Days/Computation Date, FV Factor
at bond yield, FV As Of at bond yield, FV Factor at IRR, FV As Of at IRR.

## Citations

All extracted data should cite the specific schedule and page number
within the source PDF. The PDF filename serves as the document identifier.
