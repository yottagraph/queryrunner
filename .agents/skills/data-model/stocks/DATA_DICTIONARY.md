# Data Dictionary: Alpha Vantage Stocks

## Source Overview

Alpha Vantage stock market data via the `TIME_SERIES_DAILY` REST API. Provides daily OHLCV (open, high, low, close, volume) candlestick data for US-listed equities on NYSE, NASDAQ, and AMEX exchanges.

Historical data available via `outputsize=full` (20+ years). Recent data (last 100 trading days) available via `outputsize=compact`. The streamer uses `full` for initial backfill and `compact` for daily incremental updates.

Symbol universe: ~6,900 tickers (after filtering preferred stock symbols) sourced from the NASDAQ screener (static CSV, downloaded 2026-03-13). Symbols containing `^` (preferred shares) are excluded because Alpha Vantage does not support them.

Rate limit: 1,200 requests/minute (premium plan). Downloads run concurrently (10 workers) with the Alpha Vantage client rate limiter gating throughput.

| Pipeline | `Record.Source` |
|----------|----------------|
| Daily OHLCV | `stocks` |

---

## Entity Types

### `financial_instrument`

A publicly traded equity security (common stock, preferred stock, ETF, etc.) listed on a US exchange.

- Primary key: `ticker_symbol` (e.g., `"AAPL"`, `"IBM"`, `"BRK-B"`)
- Entity resolver: named entity, mergeable. Strong ID = `ticker_symbol`.
- Entity name: ticker symbol (e.g., `"AAPL"`).

### `organization`

A company or entity whose equity securities are publicly traded on a US exchange.

- Primary key: none (resolved by name).
- Entity resolver: named entity, mergeable.
- Entity name: full security name from the NASDAQ screener CSV (e.g., `"Apple Inc. Common Stock"`).
- Note: for dual-class shares (e.g., GOOGL and GOOG), separate organization entities are created per share class. Entity resolution may merge these with organizations from other sources (e.g., EDGAR).

---

## Properties

### Financial Instrument Properties

#### Identity

* `ticker_symbol`
  * Definition: Stock ticker symbol as listed on the exchange.
  * Examples: `"AAPL"`, `"IBM"`, `"MSFT"`, `"BRK-B"`
  * Derivation: `symbol` field from the NASDAQ screener CSV; also present in Alpha Vantage response `Meta Data` → `2. Symbol`.

* `company_name`
  * Definition: Full registered security name.
  * Examples: `"Apple Inc. Common Stock"`, `"International Business Machines Corporation Common Stock"`
  * Derivation: `name` field from the NASDAQ screener CSV.

* `exchange`
  * Definition: US stock exchange where the security is listed.
  * Examples: `"NYSE"`, `"NASDAQ"`, `"AMEX"`
  * Derivation: `exchange` field from the NASDAQ screener CSV.

* `sector`
  * Definition: Market sector classification.
  * Examples: `"Technology"`, `"Health Care"`, `"Industrials"`
  * Derivation: `sector` field from the NASDAQ screener CSV. May be empty for some securities (e.g., SPACs, warrants).

* `industry`
  * Definition: Industry sub-classification within the sector.
  * Examples: `"Computer Manufacturing"`, `"Biotechnology: Laboratory Analytical Instruments"`
  * Derivation: `industry` field from the NASDAQ screener CSV. May be empty.

#### Price Data (per daily candle)

Each record represents one daily OHLCV candlestick for a single security. The atom timestamp is the trading day's date (Eastern time, converted to UTC).

* `open_price`
  * Definition: Opening price of the trading day. Unit: USD.
  * Examples: `233.55`, `247.10`
  * Derivation: `1. open` field from Alpha Vantage `Time Series (Daily)` response, parsed as float.

* `high_price`
  * Definition: Highest price reached during the trading day. Unit: USD.
  * Examples: `234.00`, `250.05`
  * Derivation: `2. high` field from Alpha Vantage response, parsed as float.

* `low_price`
  * Definition: Lowest price reached during the trading day. Unit: USD.
  * Examples: `233.00`, `245.64`
  * Derivation: `3. low` field from Alpha Vantage response, parsed as float.

* `close_price`
  * Definition: Closing price of the trading day. Unit: USD.
  * Examples: `233.50`, `247.68`
  * Derivation: `4. close` field from Alpha Vantage response, parsed as float.

* `trading_volume`
  * Definition: Number of shares traded during the day. Unit: shares.
  * Examples: `1858`, `5547724`
  * Derivation: `5. volume` field from Alpha Vantage response, parsed as integer (stored as float per v2 convention).

---

## Entity Relationships

```
organization ──[traded_as]──→ financial_instrument
```

* `traded_as`
  * Definition: Links a company to the stock ticker under which its equity is publicly traded.
  * Examples: `"Apple Inc. Common Stock" traded_as AAPL`, `"NVIDIA Corporation" traded_as NVDA`
  * Derivation: one record per symbol, emitted alongside the price candle records. The organization name comes from the NASDAQ screener CSV `name` field; the financial_instrument is identified by the `ticker_symbol` strong ID.
  * Note: one organization record with a `traded_as` relationship is emitted per download file (not per candle).

---

## Notes

- **Timestamps**: Alpha Vantage returns timestamps in US/Eastern time. All atom timestamps are converted to UTC before storage.
- **Adjusted prices**: The daily endpoint returns raw (as-traded) prices. Split/dividend-adjusted data is available via `TIME_SERIES_DAILY_ADJUSTED` (premium) but is not currently used.
- **Missing data**: Not all symbols have data for all dates. Candles only exist for days with trading activity.
- **Streaming model**: HandleStream runs as a continuous polling loop. First run downloads full history (`outputsize=full`). Subsequent runs download compact data (`outputsize=compact`, last 100 trading days) and atomize only candles newer than the checkpoint. Default poll interval: 24 hours.
- **Preferred stock symbols**: Tickers containing `^` (e.g., `AHT^F`, `F^C`) are filtered out during symbol loading because Alpha Vantage returns empty responses for them.
