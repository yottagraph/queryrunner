# Data Dictionary: FRED

## Purpose

This dictionary documents the entity types, properties, and attributes that the FRED source contributes to the Lovelace knowledge graph. It serves as the contract between the FRED source and everything that consumes it: ingest, the query server, UI, and downstream sources.

FRED (Federal Reserve Economic Data) is a database maintained by the Federal Reserve Bank of St. Louis containing over 800,000 economic time series from hundreds of sources. The Lovelace FRED source ingests a curated set of ~144 macroeconomically significant series spanning GDP, employment, inflation, interest rates, housing, money supply, financial markets, and commodity prices.

**Pipeline:** Download → Extract → Atomize. For each series, the pipeline fetches metadata (`/series`), observations (`/series/observations`), release information (`/series/release`), and categories (`/series/categories`) from the FRED API. One record is produced per series, containing metadata atoms followed by one observation atom per data point.

**Cadence:** Series are re-downloaded on each run. Only series whose observations have changed since the last run are re-atomized and re-published. Runs are periodic (typically daily to weekly).

**Observation sparsity:** FRED uses `"."` as a missing-value sentinel. Missing observations are silently dropped — only numeric values are emitted.

**Record chunking:** Series with many observations (e.g. daily data spanning decades) may be split into multiple records of up to `MaxAtomsPerRecord` atoms each.

**Source name:** `fred-source`

---

## Entity Types

### `location`

A named geographic area — a country or economic zone — for which FRED publishes macroeconomic indicators.

- Findex: 11
- Primary key: ISO 3166 alpha-2 country code (e.g. `US`, `DE`, `JP`) used as strong ID for resolution. For economic zones (Euro Area), the zone identifier (e.g. `EA`) is used.
- Entity resolver: named entity, NOT mergeable. Strong ID is the ISO code or zone identifier. Disambiguation snippet includes series title, frequency, units, and seasonal adjustment.
- Source: `fred-source`
- Entities produced: United States (`US`), Germany (`DE`), Japan (`JP`), United Kingdom (`GB`), Euro Area (`EA`)

### `organization`

A central bank or similar institutional entity for which FRED publishes policy rates or balance sheet data.

- Findex: 12
- Primary key: entity name (e.g. "Federal Reserve", "European Central Bank"). No strong ID — resolved by name with MERGEABLE mergeability.
- Entity resolver: named entity, MERGEABLE. Disambiguation snippet includes series title and frequency.
- Source: `fred-source`
- Entities produced: Federal Reserve, European Central Bank, Bank of England, Bank of Japan

### `financial_instrument`

A traded security, index, or reference rate for which FRED publishes price or yield data.

- Findex: 17
- Primary key: entity name (e.g. "10-Year U.S. Treasury", "S&P 500"). No strong ID — resolved by name with MERGEABLE mergeability.
- Entity resolver: named entity, MERGEABLE. Disambiguation snippet includes series title, frequency, and units.
- Source: `fred-source`
- Entities produced: U.S. Treasuries (1Y, 2Y, 10Y, 30Y, 3M bill), SOFR, SONIA, NASDAQ Composite, CBOE VIX, FX pairs (JPY/USD, KRW/USD, USD/EUR, USD/GBP, CAD/USD, CNY/USD), U.S. Dollar Index, U.S. Dollar Advanced Economy Index

### `product`

A physical commodity for which FRED publishes price data.

- Findex: 18
- Primary key: entity name (e.g. "Brent Crude Oil", "WTI Crude Oil"). No strong ID — resolved by name with MERGEABLE mergeability.
- Entity resolver: named entity, MERGEABLE. Disambiguation snippet includes series title, frequency, and units.
- Source: `fred-source`
- Entities produced: Brent Crude Oil, WTI Crude Oil, Regular Gasoline, Henry Hub Natural Gas

---

## Properties

### Metadata Properties (all entity types)

These atoms appear once per series record, timestamped at the first observation date.

* `name`
  * Definition: Human-readable title of the FRED series.
  * Source flavor: location, organization, financial_instrument, product
  * Examples: `"Gross Domestic Product"`, `"Federal Funds Effective Rate"`, `"S&P 500"`
  * Derivation: `title` field from the FRED `/series` API response.

* `fred_series_id`
  * Definition: FRED's unique alphanumeric identifier for the series.
  * Source flavor: location, organization, financial_instrument, product
  * Examples: `"GDP"`, `"UNRATE"`, `"DGS10"`
  * Derivation: `id` field from the FRED `/series` API response.

* `notes`
  * Definition: Methodological notes from the data publisher, cleaned of HTML markup.
  * Source flavor: location, organization, financial_instrument, product
  * Examples: `"BEA Account Code: A091RC For more information about this series, please see http://www.bea.gov/national/."`, `"The federal funds rate is the interest rate at which depository institutions trade federal funds..."`
  * Derivation: `notes` field from FRED `/series` API response, with HTML tags stripped and whitespace normalized. Omitted when empty.

* `publisher`
  * Definition: Name of the organization that publishes or maintains the data series.
  * Source flavor: location, organization, financial_instrument, product
  * Examples: `"U.S. Bureau of Labor Statistics"`, `"Board of Governors of the Federal Reserve System"`, `"U.S. Bureau of Economic Analysis"`
  * Derivation: Inferred from the domain of the release URL (e.g. `bls.gov` → BLS, `bea.gov` → BEA). Falls back to `"Federal Reserve Bank of St. Louis"` when no release URL is available.

* `release_link`
  * Definition: URL to the publisher's page for the statistical release containing this series.
  * Source flavor: location, organization, financial_instrument, product
  * Examples: `"https://www.bls.gov/ces/"`, `"https://www.federalreserve.gov/releases/h15/"`
  * Derivation: `link` field from the FRED `/series/release` API response. Omitted when no release is available.

* `unit`
  * Definition: Unit of measurement for observed values in this series.
  * Source flavor: fred_series
  * Examples: `"Bil. of $"`, `"Percent"`, `"Index 1982-1984=100"`, `"Thousands"`, `"Millions of Dollars"`
  * Derivation: `units_short` field from the FRED `/series` API response; falls back to `units` when `units_short` is empty. Omitted when both are empty (rare).

* `frequency`
  * Definition: Measurement frequency of the time series.
  * Source flavor: fred_series
  * Examples: `"D"`, `"W"`, `"M"`, `"Q"`, `"A"`
  * Derivation: `frequency_short` field from the FRED `/series` API response; falls back to `frequency` when `frequency_short` is empty. Omitted when both are empty (rare).

---

### Observation Properties

Each observation in a series becomes one atom timestamped at the observation date. The property name is semantically meaningful, shared across multiple series when the concept is the same. The series identity is preserved through the `fred_series_id` metadata atom and the entity the record is attached to.

#### GDP & Growth (location)

* `gdp` — Nominal GDP, seasonally adjusted annual rate (Billions of Dollars). Series: GDP.
* `gdp_real` — Real GDP in chained 2017 dollars, seasonally adjusted annual rate. Series: GDPC1 (US), CLVMNACSCAB1GQDE (DE), JPNRGDPEXP (JP), CLVMEURSCAB1GQEA19 (EA).
* `gnp_real` — Real GNP in chained 2017 dollars, annual. Series: GNPCA.
* `gdp_per_capita_real` — Real GDP per capita, seasonally adjusted annual rate (Chained 2017 Dollars). Series: A939RX0Q048SBEA.
* `gdp_real_growth_rate` — Percent change in real GDP from preceding period, SAAR. Series: A191RL1Q225SBEA.
* `gdp_growth_rate` — Percent change in nominal GDP from preceding period, SAAR. Series: A191RP1Q027SBEA.
* `private_fixed_investment_nonresidential` — Real private nonresidential fixed investment (Billions of Chained 2017 Dollars, quarterly). Series: PNFI.
* `private_fixed_investment_residential` — Real private residential fixed investment (Billions of Chained 2017 Dollars, quarterly). Series: PRFI.
* `inventory_change_gdp_share` — Change in private inventories as a share of GDP (Percent, quarterly). Series: A014RE1Q156NBEA.
* `government_consumption_real` — Real government consumption expenditures and gross investment (Billions of Chained 2017 Dollars, quarterly). Series: GCEC96.
* `nonfarm_business_output` — Real output of the nonfarm business sector (Index 2017=100, quarterly). Series: OUTNFB.
* `federal_expenditures_growth_rate` — Percent change in real federal government expenditures and gross investment (Percent Change, quarterly). Series: A823RL1Q225SBEA.

#### Government & Debt (location)

* `federal_debt` — Total public debt of the federal government (Millions of Dollars). Series: GFDEBTN.
* `federal_surplus_deficit` — Federal government surplus or deficit; negative = deficit (Millions of Dollars, annual). Series: FYFSD.
* `federal_receipts` — Federal government current receipts, SAAR (Billions of Dollars, monthly). Series: FGRECPT.
* `federal_debt_foreign_held` — Federal debt held by foreign and international investors (Billions of Dollars, quarterly). Series: FDHBFIN.
* `federal_interest_payments` — Federal government current expenditures on interest payments, SAAR (Billions of Dollars, quarterly). Series: A091RC1Q027SBEA.
* `government_expenditures` — Government total expenditures, SAAR (Billions of Dollars). Series: W068RCQ027SBEA.

#### Employment (location)

* `unemployment_rate` — Unemployment rate, seasonally adjusted (Percent, monthly). Series: UNRATE.
* `unemployment_rate_u6` — U-6 total labor underutilization including discouraged workers (Percent, monthly). Series: U6RATE.
* `unemployment_rate_job_losers` — Unemployment rate for job losers (U-2, Percent, monthly). Series: U2RATE.
* `unemployment_rate_black` — Unemployment rate, Black or African American, seasonally adjusted (Percent, monthly). Series: LNS14000006.
* `part_time_employment_economic` — Persons employed part-time for economic reasons (Thousands, monthly). Series: LNS12032194.
* `nonfarm_payrolls` — All employees on nonfarm payrolls, seasonally adjusted (Thousands of Persons, monthly). Series: PAYEMS.
* `employment_level` — Civilian employment level, seasonally adjusted (Thousands of Persons, monthly). Series: CE16OV.
* `labor_force_participation_rate` — Civilian labor force participation rate, seasonally adjusted (Percent, monthly). Series: CIVPART.
* `initial_jobless_claims` — Initial claims for unemployment insurance, seasonally adjusted (Number, weekly). Series: ICSA.
* `continued_jobless_claims` — Continued claims (insured unemployment), seasonally adjusted (Number, weekly). Series: CCSA.
* `job_openings` — Total nonfarm job openings (JOLTS), seasonally adjusted (Thousands, monthly). Series: JTSJOL.
* `quits_rate` — Total nonfarm quits rate (JOLTS), seasonally adjusted (Rate, monthly). Series: JTSQUR.
* `job_quits` — Total nonfarm job quits level from JOLTS (Thousands, monthly). Series: JTSQUL.
* `avg_weekly_hours` — Average weekly hours, all employees total private, seasonally adjusted (Hours, monthly). Series: AWHAETP.
* `avg_hourly_earnings` — Average hourly earnings, production and nonsupervisory employees (Dollars per Hour, monthly). Series: AHETPI.
* `avg_hourly_earnings_all` — Average hourly earnings, all employees total private (Dollars per Hour, monthly). Series: CES0500000003.
* `median_weekly_real_earnings` — Median usual weekly real earnings, full-time wage and salary workers (1982-84 CPI Adjusted Dollars, quarterly). Series: LES1252881600Q.

#### Inflation & Prices (location)

* `cpi` — CPI for all urban consumers, all items, seasonally adjusted (Index 1982-1984=100, monthly). Series: CPIAUCSL.
* `cpi_core` — CPI all items less food and energy, seasonally adjusted (Index 1982-1984=100, monthly). Series: CPILFESL.
* `cpi_medical` — CPI for medical care, seasonally adjusted (Index 1982-1984=100, monthly). Series: CPIMEDSL.
* `cpi_growth_rate` — CPI all items growth rate from previous period (Percent, monthly). Series: CPALTT01USM657N.
* `cpi_median` — Median CPI percent change at annual rate, seasonally adjusted (Percent, monthly). Series: MEDCPIM158SFRBCLE.
* `cpi_trimmed_mean_16` — 16% trimmed-mean CPI (Percent, monthly). Series: TRMMEANCPIM158SFRBCLE.
* `cpi_sticky` — Sticky-price CPI from Atlanta Fed (Percent, monthly). Series: STICKCPIM679SFRBATL.
* `cpi_owners_equivalent_rent` — CPI owner's equivalent rent (Index, monthly). Series: CUSR0000SEHC.
* `pce_price_index` — PCE chain-type price index, seasonally adjusted (Index 2017=100, monthly). Series: PCEPI.
* `pce_core_price_index` — Core PCE chain-type price index excluding food and energy (Index 2017=100, monthly). Series: PCEPILFE.
* `pce_trimmed_mean` — Dallas Fed trimmed-mean PCE inflation rate, 12-month (Percent, monthly). Series: PCETRIM12M159SFRBDAL.
* `ppi` — PPI by commodity, all commodities (Index 1982=100, monthly). Series: PPIACO.
* `ppi_final_demand` — PPI by commodity, final demand, seasonally adjusted (Index Nov 2009=100, monthly). Series: PPIFIS.
* `ppi_natural_gas` — PPI for natural gas (WPU0531) (Index, monthly). Series: WPU0531.
* `inflation_rate` — Inflation rate based on consumer prices (Percent, annual). Series: FPCPITOTLZGUSA (US), GBRCPHPTT01IXEBM (GB).

#### Consumer & Personal Finance (location)

* `personal_consumption_expenditures` — PCE, SAAR (Billions of Dollars, monthly). Series: PCE.
* `disposable_personal_income_real` — Real disposable personal income, SAAR (Billions of Chained 2017 Dollars, monthly). Series: DSPIC96.
* `personal_saving_rate` — Personal saving as % of disposable personal income (Percent, monthly). Series: PSAVERT.
* `personal_saving` — Personal saving, SAAR (Billions of Dollars, monthly). Series: PMSAVE.
* `retail_sales` — Advance retail sales, retail trade and food services (Millions of Dollars, monthly). Series: RSAFS.
* `consumer_sentiment` — University of Michigan consumer sentiment index (Index 1966:Q1=100, monthly). Series: UMCSENT.
* `vehicle_sales` — Total vehicle sales, SAAR (Millions of Units, monthly). Series: TOTALSA.
* `median_household_income` — Real median household income (CPI-U-RS adjusted Dollars, annual). Series: MEHOINUSA672N.

#### Interest Rates — Spreads & Derived (location)

* `yield_spread_10y_2y` — 10Y minus 2Y Treasury constant maturity spread (Percent, daily). Series: T10Y2Y.
* `breakeven_inflation_10y` — 10-year breakeven inflation rate (Percent, daily). Series: T10YIE.
* `ted_spread` — TED spread (Percent, daily). Discontinued. Series: (removed from active list).
* `mortgage_delinquency_rate` — Delinquency rate on single-family residential mortgages (Percent, quarterly). Series: DRSFRMACBS.
* `bank_lending_standards` — Net % of banks tightening C&I loan standards for large firms (Percent, quarterly). Series: DRTSCILM.
* `bank_lending_standards_small` — Net % of banks tightening C&I loan standards for small firms (Percent, quarterly). Series: DRTSCLNM. **Note: FRED reports this series as discontinued/nonexistent as of 2026-03.**
* `bank_lending_standards_cre` — Net % of banks tightening CRE lending standards (Percent, quarterly). Series: DRTSRCL. **Note: FRED reports this series as discontinued/nonexistent as of 2026-03.**
* `credit_card_delinquency_rate` — Delinquency rate on credit card loans, all commercial banks (Percent, quarterly). Series: DRCCLACBS.
* `cre_delinquency_rate` — Delinquency rate on CRE loans excluding farmland (Percent, quarterly). Series: DRCRELEXFACBS.

#### Money & Banking — Country Level (location)

* `money_supply_m1` — M1 money stock, seasonally adjusted (Billions of Dollars, monthly). Series: M1SL.
* `money_supply_m2` — M2 money stock, seasonally adjusted (Billions of Dollars, monthly). Series: M2SL.
* `commercial_loans` — Commercial and industrial loans at all commercial banks (Billions of Dollars, monthly). Series: BUSLOANS.
* `broker_dealer_assets` — Security brokers and dealers total financial assets (Millions of Dollars, quarterly). Series: BOGZ1FL664090005Q.

#### Housing (location)

* `housing_starts` — New privately-owned housing units started, SAAR (Thousands of Units, monthly). Series: HOUST.
* `building_permits` — New privately-owned housing units authorized, SAAR (Thousands of Units, monthly). Series: PERMIT.
* `housing_months_supply` — Monthly supply of new houses, seasonally adjusted (Months' Supply, monthly). Series: MSACSR.
* `home_price_median` — Median sales price of houses sold (Dollars, quarterly). Series: MSPUS.
* `home_price_index_fhfa` — FHFA all-transactions house price index (Index 1980:Q1=100, quarterly). Series: USSTHPI.
* `mortgage_rate_30y` — 30-year fixed rate mortgage average (Percent, weekly). Series: MORTGAGE30US.
* `rental_vacancy_rate` — Rental housing vacancy rate (Percent, quarterly). Series: RRVRUSQ156N.
* `homeowner_vacancy_rate` — Homeowner housing vacancy rate (Percent, quarterly). Series: RHVRUSQ156N.
* `homeownership_rate` — Homeownership rate (Percent, quarterly). Series: RHORUSQ156N.
* `cre_price_index` — Commercial real estate price index (Index, quarterly). Series: COMREPUSQ159N.

#### Industrial & Business (location)

* `industrial_production` — Industrial production total index, seasonally adjusted (Index 2017=100, monthly). Series: INDPRO.
* `manufacturing_production` — Industrial production in manufacturing (NAICS), seasonally adjusted (Index 2017=100, monthly). Series: IPMAN.
* `industrial_production_business_equipment` — IP index for business equipment (Index 2017=100, monthly). Series: IPBUSEQ.
* `industrial_production_fuels` — IP index for fuels (Index 2017=100, monthly). Series: IPFUELS.
* `capacity_utilization` — Total industry capacity utilization rate (Percent, monthly). Series: TCU.
* `durable_goods_orders` — Manufacturers' new orders for durable goods (Millions of Dollars, monthly). Series: DGORDER.
* `capital_goods_orders` — Manufacturers' new orders for nondefense capital goods excluding aircraft (Millions of Dollars, monthly). Series: NEWORDER.
* `manufacturing_inventory_sales_ratio` — Manufacturers' total inventories to sales ratio (Ratio, monthly). Series: MNFCTRIRSA.
* `retail_inventory_sales_ratio` — Retailers' total inventories to sales ratio (Ratio, monthly). Series: RETAILIRSA.
* `national_activity_index` — Chicago Fed National Activity Index (Index, monthly). Series: CFNAI.
* `leading_index` — Leading index for the United States (Percent, monthly). Series: USSLIND.
* `manufacturing_trade_sales_real` — Real manufacturing and trade industries sales (Millions of Chained 2017 Dollars, monthly). Series: (not yet in active list).
* `durable_goods_new_orders_real` — Real manufacturers' new orders for durable goods (Millions of Chained 2017 Dollars, monthly). Series: (not yet in active list).
* `ism_manufacturing_pmi` — ISM Manufacturing PMI composite (Index, monthly). Series: (not yet in active list).

#### Sentiment, Leading & Macro (location)

* `inflation_expectations` — University of Michigan inflation expectation (Percent, monthly). Series: MICH.
* `business_confidence` — OECD composite leading indicators, business confidence (Normalised, Normal=100, monthly). Series: BSCICP03USM665S.
* `recession_probability` — Smoothed U.S. recession probabilities (Percent, monthly). Series: RECPROUSM156N.
* `recession_indicator` — NBER-based recession indicator; 1 = recession, 0 = expansion (monthly). Series: USREC.
* `financial_stress_index` — St. Louis Fed Financial Stress Index v4 STLFSI4 (Index, weekly). Series: STLFSI4.
* `trade_balance` — Trade balance for goods and services, balance of payments basis (Millions of Dollars, monthly). Series: BOPGSTB.
* `corporate_profits` — Corporate profits after tax, SAAR (Billions of Dollars, quarterly). Series: CP.
* `auto_loans` — Consumer motor vehicle loans owned by finance companies (Millions of Dollars, monthly). Series: DTCOLNVHFNM.
* `population` — U.S. total population including armed forces overseas (Thousands, monthly). Series: POPTHM.
* `financial_conditions_index` — Chicago Fed National Financial Conditions Index (Index, weekly). Series: NFCI.
* `financial_conditions_risk` — NFCI risk subindex (Index, weekly). Series: NFCIRISK.
* `financial_conditions_leverage` — NFCI leverage subindex (Index, weekly). Series: NFCILEVERAGE.

#### Trade Components (location)

* `exports_capital_goods` — Exports of capital goods excluding automotive (Billions of Dollars, quarterly). Series: B850RC1Q027SBEA.
* `imports_automotive` — Imports of automotive vehicles and parts (Billions of Dollars, quarterly). Series: B651RC1Q027SBEA.
* `imports_consumer_goods` — Imports of consumer goods excluding automotive (Billions of Dollars, quarterly). Series: A652RC1Q027SBEA.

#### Housing & Real Estate — Additional (location)

* `rental_vacancy_rate` — Rental housing vacancy rate (Percent, quarterly). Series: RRVRUSQ156N.
* `homeowner_vacancy_rate` — Homeowner housing vacancy rate (Percent, quarterly). Series: RHVRUSQ156N.
* `homeownership_rate` — Homeownership rate (Percent, quarterly). Series: RHORUSQ156N.
* `cre_price_index` — Commercial real estate price index (Index, quarterly). Series: COMREPUSQ159N.

#### Federal Reserve Properties (organization — "Federal Reserve")

* `fed_funds_rate` — Federal funds effective rate (Percent, daily/monthly). Series: DFF, FEDFUNDS.
* `monetary_base` — Total monetary base (Billions of Dollars, monthly). Series: BOGMBASE.
* `bank_reserves_total` — Total reserves of depository institutions (Billions of Dollars, monthly). Series: TOTRESNS.
* `excess_reserves` — Excess reserves of depository institutions (Millions of Dollars, weekly). Discontinued. Series: EXCSRESNW.
* `reserve_balances` — Total reserve balances maintained with Federal Reserve Banks (Billions of Dollars, weekly). Series: WALCL (mapped to `total_assets`).

**Note:** `WALCL` (Fed's total assets / balance sheet) is mapped to the `total_assets` property since it represents the Fed's total assets, reusing an existing EDGAR property with matching semantics.

#### International Central Bank Properties (organization)

* `policy_rate` — Official benchmark policy rate set by a central bank (Percent). Series: ECBDFR (ECB), BOERUKA (Bank of England), IRSTCI01JPM156N (Bank of Japan).

#### Financial Markets (financial_instrument)

* `yield` — Market yield or interest rate for a fixed-income instrument (Percent). Series: DGS1, DGS2, DGS10, DGS30, DTB3, TB3MS, SOFR, IUDSOIA.
* `price` — Market price, index level, or exchange rate (varies by instrument). Series: NASDAQCOM, VIXCLS, DTWEXBGS, TWEXAFEGSMTH, DEXUSEU, DEXUSUK, DEXJPUS, DEXKOUS, EXCAUS, DEXCHUS.

#### Commodity Prices (product)

* `price` — Spot price for the commodity (USD per barrel, USD per gallon, USD per MMBtu). Series: DCOILBRENTEU, DCOILWTICO, GASREGW, MHHNGSP.

---

## Attributes

None. Unit and frequency are metadata properties on the `fred_series` entity (see Metadata Properties above), not per-observation attributes.

---

## Entity Relationships Summary

The FRED source produces no `data_nindex` relationship properties. All atoms are scalar values or category strings attached directly to the subject entity.

```
location            ── [fed_funds_rate, gdp, unemployment_rate, cpi, ...] (scalar observation properties)
organization        ── [fed_funds_rate, policy_rate, monetary_base, ...]
financial_instrument ── [yield, price]
product             ── [price]
```
