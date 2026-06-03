# Data Dictionary: Polymarket

## Purpose

Polymarket is a prediction market platform where users trade on the outcomes of real-world events. The Lovelace Polymarket pipeline polls the [Gamma API](https://gamma-api.polymarket.com) for active and recently closed events, extracts real-world entities from event text via LLM, and atomizes both the LLM extraction results and structured market data (prices, volumes, outcomes) into Records.

Events are polled on a configurable interval (default: every 15 minutes). Each poll fetches all active events (paginated by volume, up to 10,000) and the top 1,000 recently closed events. LLM extraction is skipped for events whose title and description have not changed since the previous poll cycle. Series data is fetched from the `/series` endpoint for events that belong to a recurring series.

The pipeline has two data paths:
- **LLM extraction**: event title, description, market questions, category, and tags are composed into a document and sent to an LLM to extract real-world entities (people, organizations, locations, etc.), relationships, events, and sentiment.
- **Structured atomization**: event metadata, market statistics, and series data are atomized directly from the Gamma API JSON response without LLM involvement.

`Record.Source`: `polymarket`

---

## Entity Types

### `prediction_event`

A Polymarket prediction event containing one or more tradeable markets. Events are the top-level container for related prediction questions.

- Primary key: `polymarket_id` (Gamma API event ID)
- Entity resolver: not mergeable. Strong ID = Gamma API event ID.

### `prediction_market`

A single tradeable prediction market (question) within a Polymarket event. Each market has its own order book, outcomes, and pricing.

- Primary key: `polymarket_id` (Gamma API market ID)
- Entity resolver: not mergeable. Strong ID = Gamma API market ID.

### `prediction_series`

A series of related Polymarket prediction events that recur over time (e.g., weekly Bitcoin price markets).

- Primary key: `polymarket_id` (Gamma API series ID)
- Entity resolver: not mergeable. Strong ID = Gamma API series ID.

### `person`

A real, named person such as a politician, executive, athlete, or public figure mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets from the event text.

### `organization`

A company, institution, government body, sports team, sports league, political party, or other named organization mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `location`

A specific named geographic location (country, state, city, region) mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `financial_instrument`

A specific tradeable asset (cryptocurrency, stock, ETF, commodity future) mentioned in a prediction event. Betting lines, spreads, and over/under totals are not financial instruments.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `product`

A specific named product, technology, software, AI model, movie, TV show, or other creative or commercial work mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `competition`

A named recurring competition, championship, tournament, or award ceremony mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `conflict`

A named geopolitical or military conflict, war, or crisis mentioned in a prediction event.

- Primary key: entity name as extracted by the LLM
- Entity resolver: named entity, mergeable. No strong ID; resolved by name and context snippets.

### `event`

An extracted event category representing a predicted real-world occurrence (e.g., "Election outcome", "IPO", "Geopolitical event"). Uses the shared `event` flavor from the common schema.

- Primary key: event name as extracted by the LLM
- Entity resolver: not mergeable.

---

## Properties

### Prediction Event Properties

#### Identity (source: structured Gamma API data)

* `polymarket_id`
  * Definition: the unique Polymarket identifier for this event.
  * Examples: `"903"`, `"21485"`
  * Derivation: `id` field from the Gamma API `/events` response. Also serves as the entity's strong ID for resolution.

* `title`
  * Definition: the title of the prediction event.
  * Examples: `"Presidential Election Winner 2024"`, `"Bitcoin above $100k by end of year?"`
  * Derivation: `title` field from the Gamma API `/events` response.

* `event_description`
  * Definition: the full description text of the prediction event.
  * Derivation: `description` field from the Gamma API `/events` response.

* `category`
  * Definition: the Polymarket-assigned category for the event.
  * Examples: `"Politics"`, `"Crypto"`, `"Sports"`, `"Pop Culture"`, `"Science"`
  * Derivation: `category` field from the Gamma API `/events` response.

* `event_status`
  * Definition: the current lifecycle status of the event.
  * Examples: `"active"`, `"closed"`, `"archived"`
  * Derivation: computed from the `active`, `closed`, and `archived` boolean fields in the API response. Priority: archived > closed > active.

* `slug`
  * Definition: URL slug for the event on Polymarket.
  * Examples: `"presidential-election-winner-2024"`, `"will-bitcoin-hit-100k"`
  * Derivation: `slug` field from the Gamma API `/events` response.

* `url`
  * Definition: full URL to the event page on Polymarket.
  * Examples: `"https://polymarket.com/event/presidential-election-winner-2024"`
  * Derivation: constructed as `https://polymarket.com/event/{slug}`.

* `has_tag`
  * Definition: a categorization tag associated with the event. One atom per tag.
  * Examples: `"Elections"`, `"Bitcoin"`, `"NBA"`, `"AI"`
  * Derivation: each entry in the `tags` array from the Gamma API response (using the `label` field). LLM-extracted event categories are also added as tags.

#### Market Statistics (source: structured Gamma API data)

* `event_volume`
  * Definition: total all-time trading volume for the event across all its markets.
  * Examples: `50000000.0`, `1234567.0`
  * Derivation: `volume` field from the Gamma API `/events` response. Unit: USD.

* `event_volume_24h`
  * Definition: trading volume in the last 24 hours for the event.
  * Derivation: `volume24hr` field from the Gamma API `/events` response. Unit: USD.

* `event_liquidity`
  * Definition: current total liquidity available across the event's markets.
  * Derivation: `liquidity` field from the Gamma API `/events` response. Unit: USD.

* `event_open_interest`
  * Definition: total open interest (outstanding positions) across the event's markets.
  * Derivation: `openInterest` field from the Gamma API `/events` response. Unit: USD.

#### Sentiment (source: LLM extraction)

* `sentiment`
  * Definition: overall financial sentiment of the prediction market topic on a scale from -1.0 (strongly negative) to +1.0 (strongly positive).
  * Examples: `0.5` (slightly positive), `-1.0` (strongly negative), `0.0` (neutral)
  * Derivation: LLM classification from the composed event text (title, description, market questions, category, tags).
  * Note: carries a `reasoning` attribute with the LLM's justification. Only set when the LLM has not previously extracted this event (or when the title/description has changed).

---

### Prediction Market Properties

#### Identity (source: structured Gamma API data)

* `polymarket_id`
  * Definition: the unique Polymarket identifier for this market.
  * Derivation: `id` field from each entry in the `markets` array of the Gamma API `/events` response. Also serves as the entity's strong ID.

* `question`
  * Definition: the market question being predicted.
  * Examples: `"Will Donald Trump win the 2024 Presidential Election?"`, `"Bitcoin above $100,000 on March 31?"`
  * Derivation: `question` field from the market object in the API response.

* `outcomes`
  * Definition: the possible outcomes for the market, as a comma-separated string.
  * Examples: `"Yes, No"`, `"Trump, Biden, Other"`
  * Derivation: `outcomes` field from the market object (JSON-encoded string from the API).

* `outcome_prices`
  * Definition: current probability prices for each outcome, as a comma-separated string. Values sum to approximately 1.0.
  * Examples: `"0.65, 0.35"`, `"0.48, 0.42, 0.10"`
  * Derivation: `outcomePrices` field from the market object (JSON-encoded string from the API).

* `market_status`
  * Definition: current status of the market.
  * Examples: `"active"`, `"closed"`
  * Derivation: computed from `active` and `closed` boolean fields. Priority: closed > active.

#### Trading Data (source: structured Gamma API data)

* `market_volume`
  * Definition: total all-time trading volume for this market.
  * Derivation: `volumeNum` field from the market object. Unit: USD.

* `market_volume_24h`
  * Definition: trading volume in the last 24 hours.
  * Derivation: `volume24hr` field from the market object. Unit: USD.

* `market_liquidity`
  * Definition: current liquidity available in this market.
  * Derivation: `liquidityNum` field from the market object. Unit: USD.

* `best_bid`
  * Definition: highest current bid price (probability) for the "Yes" outcome.
  * Examples: `0.62`, `0.05`
  * Derivation: `bestBid` field from the market object. Range: 0.0 to 1.0.

* `best_ask`
  * Definition: lowest current ask price (probability) for the "Yes" outcome.
  * Examples: `0.65`, `0.08`
  * Derivation: `bestAsk` field from the market object. Range: 0.0 to 1.0.

* `last_trade_price`
  * Definition: price of the most recent trade in this market.
  * Examples: `0.63`, `0.50`
  * Derivation: `lastTradePrice` field from the market object. Range: 0.0 to 1.0.

* `spread`
  * Definition: bid-ask spread for this market.
  * Examples: `0.03`, `0.01`
  * Derivation: `spread` field from the market object.

#### Sports and Grouped Markets (source: structured Gamma API data)

* `sports_market_type`
  * Definition: type classification for sports-related markets.
  * Examples: `"spread"`, `"total"`, `"moneyline"`
  * Derivation: `sportsMarketType` field from the market object. Only present on sports markets.

* `line`
  * Definition: the betting line for the market (spread value or over/under total).
  * Examples: `-1.5` (spread), `6.5` (over/under), `220.5` (point total)
  * Derivation: `line` field from the market object. Only emitted when non-zero.

* `group_item_threshold`
  * Definition: threshold value for grouped market items such as price targets or stat lines.
  * Examples: `"$100,000"`, `"250"`, `"3.5"`
  * Derivation: `groupItemThreshold` field from the market object. Only present on grouped markets.

---

### Prediction Series Properties

All properties sourced from structured Gamma API data via the `/series` endpoint.

* `polymarket_id`
  * Definition: the unique Polymarket identifier for this series.
  * Derivation: `id` field from the Gamma API `/series` response. Also serves as the entity's strong ID.

* `series_title`
  * Definition: title of the prediction series.
  * Examples: `"Weekly Bitcoin Price"`, `"Daily Weather Markets"`
  * Derivation: `title` field from the API response.

* `series_type`
  * Definition: type classification of the series.
  * Derivation: `seriesType` field from the API response.

* `series_recurrence`
  * Definition: recurrence pattern of the series.
  * Examples: `"daily"`, `"weekly"`
  * Derivation: `recurrence` field from the API response.

* `series_status`
  * Definition: current status of the series.
  * Examples: `"active"`, `"closed"`, `"archived"`
  * Derivation: computed from `active`, `closed`, and `archived` boolean fields. Priority: archived > closed > active.

* `slug`
  * Definition: URL slug for the series on Polymarket.
  * Derivation: `slug` field from the API response.

* `series_volume`
  * Definition: total all-time trading volume across all events in the series.
  * Derivation: `volume` field from the API response. Unit: USD.

* `series_volume_24h`
  * Definition: 24-hour trading volume across all events in the series.
  * Derivation: `volume24hr` field from the API response. Unit: USD.

* `series_liquidity`
  * Definition: current liquidity across all events in the series.
  * Derivation: `liquidity` field from the API response. Unit: USD.

---

### LLM-Extracted Entity Properties

These properties are set on LLM-extracted entities (`person`, `organization`, `location`, `financial_instrument`, `product`, `competition`, `conflict`).

* `entity_sentiment`
  * Definition: financial sentiment for a specific entity in the context of the prediction market, from -1.0 (strongly negative) to +1.0 (strongly positive).
  * Examples: `0.5` (the market implies favorable conditions for the entity)
  * Derivation: LLM per-entity sentiment scoring from event text.
  * Note: also carried as a `sentiment` attribute on the entity's `appears_in` atom.

---

### Event Properties

Event entities use the shared `event` flavor and carry standard event properties from the common schema.

* `category`
  * Definition: the type of predicted event.
  * Examples: `"Election outcome"`, `"IPO"`, `"Mergers & acquisitions"`, `"Geopolitical event"`, `"Sports outcome"`
  * Derivation: LLM event category classification from event text.

* `likelihood`
  * Definition: LLM-assessed likelihood of the event occurring.
  * Derivation: LLM classification from event text.

* `date`
  * Definition: expected date of the event, if determinable.
  * Derivation: LLM extraction from event text.

* `description`
  * Definition: brief description of the predicted event.
  * Derivation: LLM extraction from event text.

* `participant`
  * Definition: link from the event to an entity involved in it.
  * Target flavors: `person`, `organization`, `location`, `financial_instrument`, `product`, `competition`, `conflict`
  * Derivation: LLM extraction of event participants. Each participant carries `role` and `sentiment` attributes.

---

## Entity Relationships

```
person/org/location/...  ──[appears_in]──────────→ prediction_event        (LLM-extracted entity appears in event)
person/org/location/...  ──[appears_in]──────────→ prediction_market       (entity name-matched to market question)
prediction_event         ──[has_market]──────────→ prediction_market       (event contains market)
prediction_event         ──[belongs_to_series]───→ prediction_series       (event is part of a series)
event                    ──[appears_in]──────────→ prediction_event        (extracted event linked to prediction event)
event                    ──[participant]──────────→ person/org/location/... (event involves entity)
person                   ──[head_of]─────────────→ organization, location
person                   ──[works_at]────────────→ organization
person/org               ──[invests_in]──────────→ organization, financial_instrument
person/org/location      ──[competes_with]───────→ person, organization, location
person/org               ──[competes_in]─────────→ competition
person/org/conflict      ──[is_located_at]───────→ location
organization             ──[acquires]────────────→ organization
person/org               ──[partnered_with]──────→ person, organization
person/org               ──[owns]────────────────→ organization, financial_instrument, product
organization             ──[produces]────────────→ product
person/org/location      ──[involved_in]─────────→ conflict
```

The first four relationships are atomized from structured API data. All others are LLM-extracted from event text and constrained by the schema's domain/target flavor rules.

---

## Attributes

### `appears_in` attributes

Carried on `appears_in` atoms linking LLM-extracted entities to `prediction_event` entities:

* `event_id` (string): the Polymarket event ID
* `sentiment` (float): entity-level sentiment in the context of this prediction event, from -1.0 to +1.0

### `sentiment` attributes

Carried on document-level `sentiment` atoms on `prediction_event` entities:

* `reasoning` (string): the LLM's justification for the sentiment score

### `participant` attributes

Carried on `participant` atoms linking `event` entities to their participants:

* `role` (string): the participant's role in the event
* `sentiment` (float): sentiment toward the participant in the event context
