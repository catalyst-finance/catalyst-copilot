/**
 * Unified Database Schema Context
 * Single source of truth for all AI prompts about available data
 * 
 * Version: 1.0
 * Used by: QueryEngine.js, ContextEngine.js
 */

/**
 * Full schema context for query generation (QueryEngine)
 * Includes detailed field descriptions, query rules, and examples
 */
const QUERY_SCHEMA_CONTEXT = `
**AVAILABLE DATABASES AND COLLECTIONS:**

**MongoDB - raw_data database:**

1. **government_policy** - White House transcripts, policy speeches, political statements
   Fields: _id, date (YYYY-MM-DD), title, url, participants[], turns[{speaker, text}], source, inserted_at, enriched
   Use: Political statements, policy announcements, tariffs, regulations

2. **sec_filings** - SEC filings (10-K, 10-Q, 8-K, Form 3/4, 13F, etc.)
   Fields: _id, ticker, form_type, publication_date, report_date, acceptance_datetime, access_number, file_number, url, file_size, source, enriched, inserted_at
   Use: Financial reports, insider trading, regulatory filings

3. **ownership** - 13F filings showing institutional holdings
   Fields: _id, ticker, source, event_type, file_date, form_type, holder_name, shares, shares_change, shares_percent_change, total_position_value, enriched, inserted_at
   Use: Institutional holders, hedge fund positioning, smart money flows

4. **macro_economics** - Economic indicators, global market news
   Fields: _id, date (ISO timestamp), title, description, url, author, country, category, importance, source, enriched, inserted_at
   Use: GDP, inflation, unemployment, market sentiment by country

5. **news** - Company news articles
   Fields: _id, source, origin, sourced_from, ticker, title, content, url, article_id, origin_domain, published_at, enriched, inserted_at
   Use: Latest news, sentiment analysis, company announcements

6. **press_releases** - Company press releases
   Fields: _id, ticker, title, url, date, content, source, enriched, inserted_at
   Use: Official announcements, product launches, partnerships

7. **price_targets** - Analyst price targets and ratings
   Fields: _id, ticker, date, analyst, action, rating_change, price_target_change, source, enriched, inserted_at
   Use: Analyst ratings, price targets, upgrade/downgrade history

8. **earnings_transcripts** - Earnings call transcripts
   Fields: _id, source, origin, ticker, content, report_date, year, quarter, transcript_id, metadata{}, enriched, inserted_at
   Use: Management commentary, Q&A analysis, forward guidance

9. **hype** - Social and news sentiment metrics
   Fields: _id, source, origin, ticker, timestamp, social_sentiment{}, news_sentiment{}, buzz{}, companyNewsScore, sentiment{}, search_interest, enriched, inserted_at
   Use: Social media sentiment, news buzz, retail interest

**Supabase (PostgreSQL):**

1. **event_data** - Corporate events (earnings, FDA, product launches)
   Fields: ticker, type, title, actualDateTime_et, impact, aiInsight
   Use: Upcoming earnings, FDA approvals, corporate events

2. **company_information** - Company profile and fundamentals
   Fields: symbol, name, description, country, currency, exchange, gsector, gind, gsubind, ggroup, naics, naicsSector, naicsSubsector, finnhubIndustry, ipo, employeeTotal, marketCapitalization, shareOutstanding, floatingShare, insiderOwnership, institutionOwnership, weburl, logo, phone, address, city, state, cusip, isin, sedol, lei, ingested_at_et
   Use: Company profiles, industry/sector analysis, fundamentals

3. **finnhub_quote_snapshots** - Real-time and historical quotes
   Fields: symbol, timestamp, market_date, session, close, open, high, low, previous_close, change, change_percent, volume, timestamp_et, ingested_at
   Use: Current prices, intraday snapshots, pre/post market pricing

4. **one_minute_prices** - 1-minute intraday bars
   Fields: symbol, timestamp, open, high, low, close, volume, timestamp_et, created_at, source
   Use: Intraday charts, price analysis, volume patterns

5. **daily_prices** - Historical daily OHLCV
   Fields: symbol, timestamp, open, high, low, close, volume
   Use: Historical charts, long-term analysis

**QUERY GENERATION RULES:**

1. **Speaker mapping**: "Trump" → search for "trump"/"hassett", "Biden" → "biden", "Powell" → "powell", "Vance" → "vance"
   Search in: title, participants[], turns.text

2. **Date handling**: "last year" → 365 days, "last week" → 7 days, "last month" → 30 days
   government_policy date is YYYY-MM-DD string, macro_economics date is ISO timestamp

3. **Keyword search**: Extract synonyms for semantic queries (e.g., "stake" → ["stake", "investment", "acquire", "ownership", "equity", "shares"])
   Use $or to match ANY keyword

4. **MongoDB format**: Use $and at top level, $or within for alternatives, $regex with $options: "i" for case-insensitive

5. **Collection routing**:
   - Political/policy → government_policy
   - SEC/financial reports → sec_filings
   - Institutional/13F → ownership
   - Analyst ratings → price_targets
   - Company news → news
   - Official announcements/board changes/executive appointments → press_releases
   - Earnings calls → earnings_transcripts
   - Social sentiment → hype
   - Economic indicators → macro_economics
   - Company profile → company_information (Supabase)
   - Current prices → finnhub_quote_snapshots (Supabase)
   - Intraday bars → one_minute_prices (Supabase)
   - Daily history → daily_prices (Supabase)
   - Calendar events → event_data (Supabase - usually empty, use press_releases instead)

6. **Supabase format**: .select(), .eq(), .ilike(), .gte()/.lte(), .order(), .limit()
`;

/**
 * Simplified schema context for response formatting (ContextEngine)
 * Focus on what fields are available and how to use them
 */
const RESPONSE_SCHEMA_CONTEXT = `
**AVAILABLE DATA FIELDS BY COLLECTION:**

**MongoDB Collections:**

**government_policy:** title, date, participants[], url, turns[{speaker, text}]
- Full transcript in database, no external fetch needed

**sec_filings:** ticker, form_type, publication_date, url
- Content must be fetched from URL for deep analysis
- May contain images/charts

**news:** title, ticker, published_at, origin, url, content (may be truncated)
- May need URL fetch for full article

**press_releases:** title, ticker, date, url, content/summary
- May need URL fetch for full content

**earnings_transcripts:** ticker, quarter, year, report_date, content
- Full transcript in database

**price_targets:** ticker, date, analyst, action, rating_change, price_target_change
- No external content needed

**macro_economics:** title, date, country, category, description, url
- May need URL fetch for details

**ownership:** ticker, holder_name, shares, shares_change, total_position_value, file_date
- No external content needed

**hype:** ticker, sentiment, buzz, social_sentiment
- No external content needed

**Supabase Collections:**

**finnhub_quote_snapshots:** symbol, timestamp, c (current), o (open), h (high), l (low), pc (previous close), d (change), dp (change %)
**one_minute_prices:** symbol, timestamp, open, high, low, close, volume
**daily_prices:** symbol, timestamp, open, high, low, close, volume
**company_information:** symbol, name, exchange, country, sector, industry, market_cap, shares_outstanding, ipo_date, weburl, logo
`;

/**
 * Collection metadata for AI-friendly names
 */
const COLLECTION_METADATA = {
  government_policy: {
    title: 'GOVERNMENT POLICY STATEMENTS',
    friendlyName: 'government statements',
    hasExternalContent: false
  },
  sec_filings: {
    title: 'SEC FILINGS',
    friendlyName: 'SEC filings',
    hasExternalContent: true
  },
  news: {
    title: 'NEWS ARTICLES',
    friendlyName: 'news articles',
    hasExternalContent: true
  },
  press_releases: {
    title: 'PRESS RELEASES',
    friendlyName: 'press releases',
    hasExternalContent: true
  },
  earnings_transcripts: {
    title: 'EARNINGS TRANSCRIPTS',
    friendlyName: 'earnings transcripts',
    hasExternalContent: false
  },
  price_targets: {
    title: 'ANALYST PRICE TARGETS',
    friendlyName: 'analyst ratings',
    hasExternalContent: false
  },
  macro_economics: {
    title: 'ECONOMIC DATA',
    friendlyName: 'economic data',
    hasExternalContent: true
  },
  ownership: {
    title: 'INSTITUTIONAL OWNERSHIP',
    friendlyName: 'institutional holdings',
    hasExternalContent: false
  },
  hype: {
    title: 'SENTIMENT DATA',
    friendlyName: 'sentiment data',
    hasExternalContent: false
  },
  finnhub_quote_snapshots: {
    title: 'CURRENT STOCK PRICES',
    friendlyName: 'current stock prices',
    hasExternalContent: false
  },
  one_minute_prices: {
    title: 'INTRADAY PRICE DATA',
    friendlyName: 'intraday price data',
    hasExternalContent: false
  },
  daily_prices: {
    title: 'DAILY PRICE HISTORY',
    friendlyName: 'daily price history',
    hasExternalContent: false
  },
  company_information: {
    title: 'COMPANY INFORMATION',
    friendlyName: 'company details',
    hasExternalContent: false
  }
};

/**
 * Get collection title (uppercase for display)
 */
function getCollectionTitle(collection) {
  return COLLECTION_METADATA[collection]?.title || collection.toUpperCase();
}

/**
 * Get collection friendly name (lowercase for thinking messages)
 */
function getCollectionFriendlyName(collection) {
  return COLLECTION_METADATA[collection]?.friendlyName || collection;
}

/**
 * Check if collection supports external content fetching
 */
function hasExternalContent(collection) {
  return COLLECTION_METADATA[collection]?.hasExternalContent || false;
}

module.exports = {
  QUERY_SCHEMA_CONTEXT,
  RESPONSE_SCHEMA_CONTEXT,
  COLLECTION_METADATA,
  getCollectionTitle,
  getCollectionFriendlyName,
  hasExternalContent
};
