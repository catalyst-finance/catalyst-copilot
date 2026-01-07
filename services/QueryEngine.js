/**
 * AI-Native Query Engine
 * Replaces hardcoded classification and query construction with AI-generated queries
 */

const openai = require('../config/openai');

class QueryEngine {
  constructor() {
    // Database schema context - the AI's knowledge of what data exists
    this.schemaContext = `
**AVAILABLE DATABASES AND COLLECTIONS:**

**MongoDB - raw_data database:**

1. **government_policy** - White House transcripts, policy speeches, political statements
   Schema:
   - _id: ObjectId
   - date: string (YYYY-MM-DD format, e.g., "2025-11-12")
   - title: string (event name, e.g., "Remarks: JD Vance Addresses the Make America Healthy Again Summit")
   - url: string (source URL)
   - participants: array of strings (speaker names, e.g., ["Jd Vance", "Robert F. Kennedy Jr."])
   - turns: array of {speaker: string, text: string} - full transcript with each speaker's statements
   - source: "government_policy"
   - inserted_at: timestamp
   - enriched: boolean
   
   Use Cases:
   - What did [politician] say about [topic]?
   - Has [politician] mentioned [company]?
   - Policy announcements, tariffs, regulations, political statements

2. **sec_filings** - SEC filings (10-K, 10-Q, 8-K, Form 3, Form 4, 13F, etc.)
   Schema:
   - _id: ObjectId
   - ticker: string (e.g., "AAPL")
   - form_type: string (e.g., "10-Q", "8-K", "3", "4")
   - publication_date: string (YYYY-MM-DD)
   - report_date: string (YYYY-MM-DD)
   - acceptance_datetime: timestamp
   - access_number: string
   - file_number: string
   - url: string (SEC.gov URL)
   - file_size: string
   - source: "sec_filings"
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Latest 10-Q/10-K for [ticker]
   - Form 4 insider trading filings
   - Recent SEC filings for a company
   
   IMPORTANT - Material Event Triggers:
   - 8-K filings = Material corporate events (M&A, exec changes, financial results)
   - Recent 8-K + "why is stock up/down?" query = ALWAYS set needsDeepAnalysis: true
   - 8-K content explains stock movements and must be fetched and analyzed

3. **ownership** - 13F filings showing institutional holdings
   Schema:
   - _id: ObjectId
   - ticker: string (e.g., "TMC")
   - source: "ownership"
   - event_type: string (e.g., "position_change")
   - file_date: string (YYYY-MM-DD)
   - form_type: string (e.g., "13F-HR")
   - holder_name: string (e.g., "First Manhattan Co. Llc.")
   - shares: number
   - shares_change: number
   - shares_percent_change: number
   - total_position_value: number
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Which institutions own [ticker]?
   - Hedge fund positioning changes
   - Smart money flows

4. **macro_economics** - Economic indicators, global market news
   Schema:
   - _id: ObjectId
   - date: string (ISO timestamp with time, e.g., "2026-01-06T04:47:36.75")
   - title: string
   - description: string
   - url: string
   - author: string
   - country: string
   - category: string (e.g., "Stock Market")
   - importance: number
   - source: "macro_economics"
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - GDP, inflation, unemployment data
   - Market sentiment by country
   - International markets news

5. **news** - Company news articles
   Schema:
   - _id: ObjectId
   - source: "news"
   - origin: string (e.g., "Yahoo")
   - sourced_from: string (e.g., "finnhub")
   - ticker: string
   - title: string
   - content: string
   - url: string
   - article_id: string
   - origin_domain: string
   - published_at: timestamp
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Latest news for [ticker]
   - News sentiment analysis
   - Company announcements

6. **press_releases** - Company press releases
   Schema:
   - _id: ObjectId
   - ticker: string
   - title: string
   - url: string
   - date: string (YYYY-MM-DD HH:mm:ss)
   - content: string
   - source: "press_releases"
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Official company announcements
   - Product launches, partnerships
   - Corporate communications

7. **price_targets** - Analyst price targets and ratings
   Schema:
   - _id: ObjectId
   - ticker: string
   - date: timestamp
   - analyst: string (e.g., "Wedbush")
   - action: string (e.g., "Upgrade", "Downgrade", "Initiated")
   - rating_change: string (e.g., "Neutral → Outperform")
   - price_target_change: string (e.g., "$11")
   - source: "price_targets"
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Analyst ratings for [ticker]
   - Price target changes
   - Upgrade/downgrade history

8. **earnings_transcripts** - Earnings call transcripts
   Schema:
   - _id: ObjectId
   - source: "earnings_transcripts"
   - origin: string (e.g., "defeatbeta")
   - ticker: string
   - content: string (full transcript text)
   - report_date: timestamp
   - year: number
   - quarter: number
   - transcript_id: string (e.g., "TMC32025")
   - metadata: {paragraph_count, character_count, word_count}
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - What did management say on earnings call?
   - Earnings call Q&A analysis
   - Forward guidance from calls

9. **hype** - Social and news sentiment metrics
   Schema:
   - _id: ObjectId
   - source: "hype"
   - origin: string (ticker)
   - ticker: string
   - timestamp: string
   - social_sentiment: {atTime, mention, positiveScore, negativeScore, positiveMention, negativeMention, score}
   - news_sentiment: object
   - buzz: {articlesInLastWeek, buzz, weeklyAverage}
   - companyNewsScore: number
   - sectorAverageBullishPercent: number
   - sectorAverageNewsScore: number
   - sentiment: {bearishPercent, bullishPercent, symbol}
   - search_interest: number or null
   - enriched: boolean
   - inserted_at: timestamp
   
   Use Cases:
   - Social media sentiment for [ticker]
   - News buzz and sentiment
   - Retail investor interest

**Supabase (PostgreSQL):**

1. **event_data** - Corporate events (earnings, FDA approvals, product launches)
   Schema:
   - ticker: text
   - type: text (e.g., "earnings", "fda", "merger", "split")
   - title: text
   - actualDateTime_et: timestamp (Eastern Time)
   - impact: text
   - aiInsight: text
   
   Use Cases:
   - Upcoming earnings dates
   - FDA approval events
   - Corporate events for specific tickers

2. **company_information** - Company profile and fundamental data
   Schema:
   - symbol: text (primary key)
   - name: text (company name)
   - description: text (company description)
   - country: text
   - currency: text
   - exchange: text (e.g., "NASDAQ NMS - GLOBAL MARKET")
   - gsector: text (GICS sector)
   - gind: text (GICS industry)
   - gsubind: text (GICS sub-industry)
   - ggroup: text (GICS group)
   - naics: text (NAICS code)
   - naicsSector: text
   - naicsSubsector: text
   - finnhubIndustry: text
   - ipo: date (IPO date)
   - employeeTotal: integer
   - marketCapitalization: numeric
   - shareOutstanding: double precision
   - floatingShare: numeric
   - insiderOwnership: numeric
   - institutionOwnership: numeric
   - weburl: text
   - logo: text (logo URL)
   - phone: text
   - address: text
   - city: text
   - state: text
   - cusip: text
   - isin: text
   - sedol: text
   - lei: text
   - ingested_at_et: timestamp (when data was last updated)
   
   Use Cases:
   - Company profile lookup
   - Industry/sector analysis (query by gsector, gind, naics)
   - Market cap comparisons
   - Company fundamentals (employees, ownership structure)
   - Finding companies by CUSIP/ISIN/SEDOL
   
   Indexed Fields: symbol, cusip, isin, naics, ggroup, ingested_at_et

3. **finnhub_quote_snapshots** - Real-time and historical stock quotes
   Schema:
   - symbol: text (primary key part)
   - timestamp: timestamp with time zone (primary key part)
   - market_date: date (trading date)
   - session: text ("pre", "regular", "post")
   - close: double precision (current price)
   - open: double precision
   - high: double precision
   - low: double precision
   - previous_close: double precision
   - change: double precision (dollar change)
   - change_percent: double precision (percent change)
   - volume: bigint
   - timestamp_et: timestamp (Eastern Time, auto-generated)
   - ingested_at: timestamp (when quote was captured)
   
   Use Cases:
   - Current stock prices
   - Intraday price snapshots
   - Pre-market, regular, and after-hours pricing
   - Price change and percent change
   - Daily high/low/open/close
   
   Indexed Fields: symbol+timestamp, symbol+market_date, session, ingested_at
   
   Query Tips:
   - Filter by session for specific market hours
   - Use market_date for daily queries
   - Order by timestamp DESC for most recent quotes

4. **one_minute_prices** - 1-minute intraday price bars
   Schema:
   - symbol: text (primary key part)
   - timestamp: timestamp with time zone (primary key part)
   - open: double precision
   - high: double precision
   - low: double precision
   - close: double precision
   - volume: bigint
   - timestamp_et: timestamp (Eastern Time, auto-generated)
   - created_at: timestamp (when bar was created)
   - source: text (default "intraday_aggregated_1m")
   
   Use Cases:
   - 1-minute intraday charts
   - Intraday price analysis
   - Volume patterns during trading day
   - High-frequency price data
   
   Indexed Fields: symbol+timestamp, timestamp, timestamp_et, created_at
   
   Query Tips:
   - Use timestamp range for specific time periods
   - Order by timestamp for chronological data
   - Limit results to avoid excessive data (1 minute data adds up fast)

5. **daily_prices** / **intraday_prices** - Historical daily and intraday price data (legacy)
   Schema:
   - symbol: text
   - timestamp: timestamp
   - open: double precision
   - high: double precision
   - low: double precision
   - close: double precision
   - volume: bigint
   
   Use Cases:
   - Historical daily price charts
   - Long-term price analysis
   - Daily OHLCV data

**QUERY GENERATION RULES:**

1. **Speaker name mapping for government_policy:**
   - "Trump" → search participants/title for "trump" (also include "hassett" for Trump admin)
   - "Biden" → search for "biden"
   - "Powell" → search for "powell"
   - "Vance" → search for "vance"
   - Search in: title, participants array, and turns.text

2. **Date handling:**
   - "last year" → from 365 days ago to today
   - "last week" → 7 days ago to today
   - "last month" → 30 days ago to today
   - For government_policy: date field is "YYYY-MM-DD" string
   - For macro_economics: date field is ISO timestamp string

3. **Keyword/Semantic search:**
   - For semantic queries like "take a stake in", extract synonyms:
     ["stake", "investment", "invest", "acquire", "ownership", "equity", "shares", "purchase"]
   - Use $or to match ANY keyword, not all

4. **MongoDB query format:**
   - Use $and at top level for combining filters
   - Use $or within $and for synonym/alternative matching
   - Use $regex with $options: "i" for case-insensitive text search
   - For array fields like participants, use $elemMatch with $regex

5. **Collection selection by query type:**
   - Political statements, policy, tariffs → government_policy (MongoDB)
   - SEC filings, financial reports → sec_filings (MongoDB)
   - Institutional holders, 13F → ownership (MongoDB)
   - Analyst ratings, upgrades → price_targets (MongoDB)
   - Company news → news (MongoDB)
   - Official announcements → press_releases (MongoDB)
   - Earnings calls → earnings_transcripts (MongoDB)
   - Social sentiment → hype (MongoDB)
   - Economic indicators → macro_economics (MongoDB)
   - Company profile, industry, sector, fundamentals → company_information (Supabase)
   - Current stock price, quotes → finnhub_quote_snapshots (Supabase)
   - Intraday 1-minute bars → one_minute_prices (Supabase)
   - Historical daily prices → daily_prices (Supabase)
   - Corporate events (earnings dates, FDA) → event_data (Supabase)

6. **Supabase query format:**
   - Use .select() with column names
   - Use .eq() for exact match, .ilike() for case-insensitive text search
   - Use .gte() and .lte() for date/number ranges
   - Use .order() for sorting
   - Use .limit() to restrict results
   - For company_information: can query by symbol, name, gsector, gind, naics, cusip, isin
   - For finnhub_quote_snapshots: filter by symbol, market_date, session, order by timestamp
   - For one_minute_prices: filter by symbol, timestamp range, order by timestamp

**Note:** Today's date will be provided in the query prompt based on user's timezone.
`;
  }

  /**
   * Generate contextual thinking message based on query intent using AI
   */
  async generateThinkingMessage(intent, context = {}) {
    // Build prompt based on intent and context
    let prompt = '';
    
    if (intent === 'government_policy') {
      const subject = context.politicians || 'government officials';
      const topic = context.topics || 'the topic';
      prompt = `Write a 3-5 word status message saying you're searching for ${subject} statements about ${topic}. Use professional language. Words like "exploring", "investigating", "analyzing" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid database jargon like "querying", "extracting", "processing". Examples: "Searching government statements..." or "Investigating policy remarks..."`;
    } else if (intent === 'sec_filings') {
      const tickers = context.tickers ? context.tickers.join(' and ') : 'the company';
      prompt = `Write a 3-5 word status message saying you're searching SEC filings for ${tickers}. Use professional language. Words like "exploring", "investigating", "analyzing" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid database jargon like "querying", "extracting", "processing". Examples: "Analyzing SEC filings..." or "Investigating regulatory filings..."`;
    } else if (intent === 'company_research') {
      const tickers = context.tickers ? context.tickers.join(' and ') : 'company';
      prompt = `Write a 3-5 word status message saying you're researching ${tickers}. Use professional language. Words like "exploring", "investigating", "analyzing" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid database jargon like "querying", "extracting", "processing". Examples: "Researching company data..." or "Analyzing company info..."`;
    } else if (intent === 'market_data') {
      const tickers = context.tickers ? ` for ${context.tickers.length} stock${context.tickers.length > 1 ? 's' : ''}` : '';
      prompt = `Write a 3-5 word status message saying you're getting market data${tickers}. Examples: "Getting market data..." or "Fetching stock prices..."`;
    } else if (intent === 'news') {
      const tickers = context.tickers ? ` about ${context.tickers}` : '';
      prompt = `Write a 3-5 word status message saying you're checking recent news${tickers}. Examples: "Checking recent news..." or "Finding news articles..."`;
    } else if (intent === 'analyst_ratings') {
      const tickers = context.tickers ? ` for ${context.tickers}` : '';
      prompt = `Write a 3-5 word status message saying you're looking up analyst ratings${tickers}. Examples: "Checking analyst ratings..." or "Finding price targets..."`;
    } else if (intent === 'institutional') {
      const tickers = context.tickers ? ` for ${context.tickers}` : '';
      prompt = `Write a 3-5 word status message saying you're checking institutional ownership${tickers}. Examples: "Checking institutional holders..." or "Finding ownership data..."`;
    } else if (intent === 'earnings') {
      const tickers = context.tickers ? ` for ${context.tickers}` : '';
      prompt = `Write a 3-5 word status message saying you're finding earnings information${tickers}. Examples: "Finding earnings data..." or "Checking earnings calls..."`;
    } else if (intent === 'events') {
      const tickers = context.tickers ? ` for ${context.tickers}` : '';
      prompt = `Write a 3-5 word status message saying you're looking up upcoming events${tickers}. Examples: "Finding upcoming events..." or "Checking event calendar..."`;
    } else {
      prompt = `Write a 3-5 word status message saying you're looking into the user's question. Examples: "Searching databases..." or "Gathering information..."`;
    }
    
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 15
      });
      const raw = response.choices[0].message.content || '';
      const sanitized = raw.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
      return sanitized;
    } catch (error) {
      console.error('QueryEngine thinking message generation failed, using fallback');
      // Fallback to simple message
      const fallbacks = {
        'government_policy': 'Searching government statements...',
        'sec_filings': 'Searching SEC filings...',
        'company_research': 'Researching company data...',
        'market_data': 'Getting market data...',
        'news': 'Checking recent news...',
        'analyst_ratings': 'Checking analyst ratings...',
        'institutional': 'Checking institutional ownership...',
        'earnings': 'Finding earnings data...',
        'events': 'Finding upcoming events...'
      };
      const fb = fallbacks[intent] || 'Searching databases...';
      return fb.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
    }
  }

  /**
   * Calculate "today" date in user's timezone
   */
  getTodayInTimezone(timezone = 'America/New_York') {
    try {
      // Use Intl.DateTimeFormat to get the date parts in the user's timezone
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD format
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(now); // Returns YYYY-MM-DD in user's timezone
    } catch (error) {
      // Fallback to UTC if timezone is invalid
      console.warn(`Invalid timezone "${timezone}", falling back to UTC`);
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Generate queries using AI instead of hardcoded logic
   * @param {string} userMessage - The user's question
   * @param {string[]} userPortfolio - User's portfolio tickers
   * @param {function} sendThinking - Callback to send thinking messages
   * @param {string} timezone - User's timezone (e.g., 'America/New_York')
   */
  async generateQueries(userMessage, userPortfolio = [], sendThinking = null, timezone = 'America/New_York') {
    // Calculate today's date in user's timezone for accurate query generation
    const todayInUserTimezone = this.getTodayInTimezone(timezone);
    console.log(`📅 User timezone: ${timezone}, Today: ${todayInUserTimezone}`);
    
    const prompt = `You are a database query generator. Based on the user's question, generate the appropriate database queries to answer it.

${this.schemaContext}

**User's Question:** "${userMessage}"
**User's Portfolio:** ${userPortfolio.length > 0 ? userPortfolio.join(', ') : 'none'}
**User's Timezone:** ${timezone}
**TODAY'S DATE (in user's timezone):** ${todayInUserTimezone}

**Your Task:**
1. Understand what the user is asking
2. Determine which database(s) and collection(s) to query
3. Generate the exact query object(s) needed
4. Explain your reasoning

**CRITICAL RULES:**
- For government policy queries about politicians, ALWAYS query government_policy collection
- Extract semantic synonyms for concepts (e.g., "take a stake" → ["stake", "investment", "invest", "acquire", ...])
- Use $or to match ANY keyword when searching transcripts
- Map speaker names correctly (Trump → search for "trump" OR "hassett")
- Calculate date ranges based on TODAY'S DATE in the user's timezone: ${todayInUserTimezone}
- When user says "today", "yesterday", "this week", etc. - interpret relative to THEIR timezone
- If asking "what companies did [politician] mention?", set extractCompanies: true

**CRITICAL: CONNECTING QUALITATIVE + QUANTITATIVE DATA**
When users ask about news, price movements, or "why" questions, ALWAYS query BOTH qualitative AND quantitative data:

1. **News queries → Also get price data:**
   - When asking "latest news for [ticker]" → also query finnhub_quote_snapshots for recent prices
   - This allows speculating whether news sentiment correlates with price movement

2. **Price movement queries → Also get news/filings:**
   - When asking "why did [ticker] go up/down" → query news, price_targets, sec_filings from that time period
   - When asking about "all-time high", "52-week high", "big move" → find the price data FIRST, then query news/filings from that date range

3. **Correlation analysis:**
   - If news is overwhelmingly positive/negative, speculate it may have caused recent price movement
   - Always include price data when discussing news to show actual market reaction
   - Set needsChart=true when discussing price movements so a mini chart can be included

4. **Time-based correlation queries:**
   - For "why did X happen on [date]" → query all sources (news, price_targets, sec_filings, press_releases) filtered to that date range
   - For "what caused the spike/drop" → first identify when the spike occurred from price data, then query news from ±1-2 days

Return JSON with this structure:
{
  "queries": [
    {
      "database": "mongodb" | "supabase",
      "collection": "government_policy" | "sec_filings" | "ownership" | "macro_economics" | "news" | "press_releases" | "price_targets" | "earnings_transcripts" | "hype" | "event_data" | "company_information" | "finnhub_quote_snapshots" | "one_minute_prices" | "daily_prices" | "intraday_prices",
      "query": { /* MongoDB query object or Supabase filter params */ },
      "sort": { /* optional sort params */ },
      "limit": 10,
      "reasoning": "Why this query answers the user's question"
    }
  ],
  "extractCompanies": true | false,
  "needsChart": true | false,
  "needsDeepAnalysis": true | false,  // Set true for SEC filing analysis, detailed content examination
  "analysisKeywords": ["keyword1", "keyword2"],  // Keywords to search for in SEC filing content
  "chartConfig": {  // Optional - specify chart parameters when needsChart is true
    "symbol": "TSLA",
    "timeRange": "1d" | "5d" | "1m" | "3m" | "1y",  // How much history to show
    "highlightDate": "2026-01-05"  // Optional - date to highlight on chart
  },
  "intent": "brief description of user's intent"
}

**CRITICAL: needsDeepAnalysis flag**
This flag tells the system to fetch full content from source URLs, not just use stored metadata/summaries.

Set needsDeepAnalysis=true when:
- User says "analyze", "examine", "review", "look at", "what does it say", "tell me about", "explain"
- User wants detailed information from SEC filings (financials, R&D, products, risks)
- User wants to read/understand news articles in depth
- User wants full press release content (not just titles)
- User wants detailed economic data/reports
- User asks about specific details that require reading the full source
- User asks about financial figures, revenue, cash position, expenses
- User asks about product development, trials, pipeline, research

Set needsDeepAnalysis=false when:
- User just wants a list/overview (recent filings, recent news headlines)
- User asks "when was the last 10-Q filed?" (just needs date)
- Simple metadata queries (counts, dates, names)
- User wants a quick summary, not detailed analysis

**Collections that support deep analysis (URL content fetching):**
- sec_filings: Fetches full filing content from SEC.gov
- news: Fetches full article content from news source
- press_releases: Fetches full press release from source
- macro_economics: Fetches full economic report/article

**EXAMPLE 1:**
User: "What companies did Trump take a stake in last year?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "government_policy",
      "query": {
        "$and": [
          {
            "$or": [
              {"title": {"$regex": "trump", "$options": "i"}},
              {"participants": {"$elemMatch": {"$regex": "hassett|trump", "$options": "i"}}}
            ]
          },
          {
            "$or": [
              {"turns.text": {"$regex": "stake", "$options": "i"}},
              {"turns.text": {"$regex": "investment", "$options": "i"}},
              {"turns.text": {"$regex": "invest", "$options": "i"}},
              {"turns.text": {"$regex": "acquire", "$options": "i"}},
              {"turns.text": {"$regex": "ownership", "$options": "i"}},
              {"turns.text": {"$regex": "equity", "$options": "i"}}
            ]
          },
          {"date": {"$gte": "2025-01-06", "$lte": "2026-01-06"}}
        ]
      },
      "sort": {"date": -1},
      "limit": 30,
      "reasoning": "Search government policy transcripts where Trump/Hassett mentioned stakes, investments, or acquisitions in the last year"
    }
  ],
  "extractCompanies": true,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": ["stake", "investment", "invest", "acquire", "company", "companies"],
  "intent": "Find companies mentioned by Trump administration in context of taking stakes/investments"
}

**EXAMPLE 2:**
User: "What are analysts saying about TSLA?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "price_targets",
      "query": {"ticker": "TSLA"},
      "sort": {"date": -1},
      "limit": 10,
      "reasoning": "Get recent analyst ratings and price targets for TSLA"
    },
    {
      "database": "mongodb",
      "collection": "news",
      "query": {"ticker": "TSLA"},
      "sort": {"published_at": -1},
      "limit": 10,
      "reasoning": "Get recent news articles about TSLA for context"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Analyst sentiment and ratings for TSLA"
}

**EXAMPLE 3:**
User: "What did the CEO say on TMC's last earnings call?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "earnings_transcripts",
      "query": {"ticker": "TMC"},
      "sort": {"report_date": -1},
      "limit": 1,
      "reasoning": "Get the most recent earnings call transcript for TMC"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Find CEO statements from TMC's latest earnings call"
}

**EXAMPLE 4 (SEC Filing Deep Analysis - IMPORTANT):**
User: "Analyze the last 10-Q from MNMD"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "sec_filings",
      "query": {"$and": [{"ticker": "MNMD"}, {"form_type": "10-Q"}]},
      "sort": {"publication_date": -1},
      "limit": 1,
      "reasoning": "Get the most recent 10-Q filing for MNMD to analyze its contents"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": true,
  "analysisKeywords": ["revenue", "cash", "trial", "phase", "expense", "product", "development", "pipeline", "risk"],
  "intent": "Deep analysis of MNMD's latest 10-Q filing including financials and product development"
}

**EXAMPLE 5 (SEC Filing List - No Deep Analysis):**
User: "When was AAPL's last 10-K filed?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "sec_filings",
      "query": {"$and": [{"ticker": "AAPL"}, {"form_type": "10-K"}]},
      "sort": {"publication_date": -1},
      "limit": 1,
      "reasoning": "Get the most recent 10-K filing date for AAPL"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Find filing date of AAPL's most recent 10-K"
}

**EXAMPLE 6 (Company Information - Supabase):**
User: "Tell me about AAPL"
Response:
{
  "queries": [
    {
      "database": "supabase",
      "collection": "company_information",
      "query": {"symbol": "AAPL"},
      "limit": 1,
      "reasoning": "Get company profile information for AAPL"
    },
    {
      "database": "supabase",
      "collection": "finnhub_quote_snapshots",
      "query": {"symbol": "AAPL"},
      "sort": {"timestamp": "desc"},
      "limit": 1,
      "reasoning": "Get current stock price for AAPL"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Get company profile and current price for AAPL"
}

**EXAMPLE 7 (Industry Query - Supabase):**
User: "What biotech companies are in our database?"
Response:
{
  "queries": [
    {
      "database": "supabase",
      "collection": "company_information",
      "query": {"finnhubIndustry": "Healthcare"},
      "limit": 50,
      "reasoning": "Find healthcare/biotech companies by industry classification"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "List biotech/healthcare companies"
}

**EXAMPLE 8 (Current Prices - Supabase):**
User: "What's the current price of TSLA?"
Response:
{
  "queries": [
    {
      "database": "supabase",
      "collection": "finnhub_quote_snapshots",
      "query": {"symbol": "TSLA"},
      "sort": {"timestamp": "desc"},
      "limit": 1,
      "reasoning": "Get most recent stock price for TSLA"
    }
  ],
  "extractCompanies": false,
  "needsChart": true,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Get current stock price for TSLA"
}

**EXAMPLE 9 (News + Price Correlation):**
User: "What's the latest news for TSLA stock?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "news",
      "query": {"symbols": "TSLA"},
      "sort": {"published_date": -1},
      "limit": 8,
      "reasoning": "Get recent news articles for TSLA"
    },
    {
      "database": "supabase",
      "collection": "finnhub_quote_snapshots",
      "query": {"symbol": "TSLA"},
      "sort": {"timestamp": "desc"},
      "limit": 1,
      "reasoning": "Get current price to correlate with news sentiment"
    },
    {
      "database": "supabase",
      "collection": "one_minute_prices",
      "query": {"symbol": "TSLA", "timestamp_gte": "24h_ago"},
      "sort": {"timestamp": "desc"},
      "limit": 60,
      "reasoning": "Get recent price history to show movement alongside news"
    }
  ],
  "extractCompanies": false,
  "needsChart": true,
  "needsDeepAnalysis": false,
  "analysisKeywords": [],
  "intent": "Get latest news for TSLA with price context",
  "chartConfig": {
    "symbol": "TSLA",
    "timeRange": "1D",
    "highlightDate": null
  }
}

**EXAMPLE 10 (Explaining Price Movement):**
User: "Why did NVDA spike today?" or "What caused the drop in AAPL?"
Response:
{
  "queries": [
    {
      "database": "supabase",
      "collection": "finnhub_quote_snapshots",
      "query": {"symbol": "NVDA"},
      "sort": {"timestamp": "desc"},
      "limit": 1,
      "reasoning": "Get current price and daily change percentage"
    },
    {
      "database": "supabase",
      "collection": "one_minute_prices",
      "query": {"symbol": "NVDA", "timestamp_gte": "24h_ago"},
      "sort": {"timestamp": "asc"},
      "limit": 120,
      "reasoning": "Get intraday price action to identify when the spike occurred"
    },
    {
      "database": "mongodb",
      "collection": "news",
      "query": {"symbols": "NVDA", "published_date_gte": "24h_ago"},
      "sort": {"published_date": -1},
      "limit": 10,
      "reasoning": "Find news that may have caused the price movement"
    },
    {
      "database": "mongodb",
      "collection": "sec_filings",
      "query": {"ticker": "NVDA", "filing_date_gte": "7d_ago"},
      "sort": {"filing_date": -1},
      "limit": 3,
      "reasoning": "Check for recent SEC filings that may have impacted price"
    },
    {
      "database": "mongodb",
      "collection": "price_targets",
      "query": {"ticker": "NVDA", "date_gte": "7d_ago"},
      "sort": {"date": -1},
      "limit": 5,
      "reasoning": "Check for analyst upgrades/downgrades"
    }
  ],
  "extractCompanies": false,
  "needsChart": true,
  "needsDeepAnalysis": true,
  "analysisKeywords": ["spike", "caused", "why"],
  "intent": "Explain what caused NVDA's price movement today",
  "chartConfig": {
    "symbol": "NVDA",
    "timeRange": "1D",
    "highlightDate": null
  }
}

**EXAMPLE 11 (Earnings Impact Analysis):**
User: "How did MSFT react to their last earnings?"
Response:
{
  "queries": [
    {
      "database": "mongodb",
      "collection": "earnings_transcripts",
      "query": {"ticker": "MSFT"},
      "sort": {"date": -1},
      "limit": 1,
      "reasoning": "Get most recent earnings transcript for context"
    },
    {
      "database": "mongodb",
      "collection": "news",
      "query": {"symbols": "MSFT", "title_contains": ["earnings", "quarterly", "results"]},
      "sort": {"published_date": -1},
      "limit": 5,
      "reasoning": "Get news coverage of the earnings report"
    },
    {
      "database": "supabase",
      "collection": "daily_prices",
      "query": {"symbol": "MSFT"},
      "sort": {"timestamp": "desc"},
      "limit": 10,
      "reasoning": "Get daily price data around earnings date to see reaction"
    }
  ],
  "extractCompanies": false,
  "needsChart": true,
  "needsDeepAnalysis": true,
  "analysisKeywords": ["react", "earnings"],
  "intent": "Analyze MSFT stock reaction to most recent earnings",
  "chartConfig": {
    "symbol": "MSFT",
    "timeRange": "1W",
    "highlightDate": "earnings_date"
  }
}

Return ONLY valid JSON, no explanation outside the JSON structure.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",  // Faster and cheaper - query generation is a structured task
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,  // Lower for more deterministic query generation
        max_tokens: 1500,  // JSON response rarely exceeds 500-800 tokens
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content.trim());
      console.log('🤖 AI-Generated Queries:', JSON.stringify(result, null, 2));
      
      // Send contextual thinking message based on intent (AI-generated)
      if (sendThinking && result.intent) {
        const thinkingMsg = await this.generateThinkingMessage(result.intent, {
          tickers: result.tickers || userPortfolio,
          topics: result.intent,
          politicians: result.queries.some(q => q.collection === 'government_policy') ? 
            'government officials' : null
        });
        sendThinking('retrieving', thinkingMsg);
      }
      
      return result;
    } catch (error) {
      console.error('Query generation failed:', error);
      throw error;
    }
  }

  /**
   * Execute generated queries against databases
   */
  async executeQueries(queryPlan, DataConnector) {
    const results = [];

    for (const query of queryPlan.queries) {
      try {
        console.log(`📊 Executing ${query.database}.${query.collection}...`);
        console.log('   Query:', JSON.stringify(query.query, null, 2));
        
        if (query.database === 'mongodb') {
          // Use direct MongoDB access for flexibility
          const result = await DataConnector.executeRawQuery(
            query.collection,
            query.query,
            query.sort || {},
            query.limit || 30
          );
          
          results.push({
            collection: query.collection,
            data: result.data || [],
            count: result.data?.length || 0,
            reasoning: query.reasoning
          });
          
          console.log(`   ✅ Found ${result.data?.length || 0} documents`);
          
        } else if (query.database === 'supabase') {
          if (query.collection === 'event_data') {
            const result = await DataConnector.getEvents(query.query);
            results.push({
              collection: query.collection,
              data: result.data || [],
              count: result.data?.length || 0,
              reasoning: query.reasoning
            });
          } else if (query.collection === 'finnhub_quote_snapshots') {
            // Fetch current stock quote with previous close for accurate change calculation
            // Uses stock_quote_now for current price + finnhub_quote_snapshots for pc/open/high/low
            const symbol = query.query.symbol;
            const result = await DataConnector.getQuoteWithPreviousClose(symbol);
            
            // Format data to match expected schema (c, d, dp, o, h, l, pc)
            let formattedData = [];
            if (result.success && result.data) {
              const q = result.data;
              formattedData = [{
                symbol: q.symbol,
                c: q.currentPrice,      // current price from stock_quote_now
                d: q.change,            // calculated: currentPrice - previousClose
                dp: q.changePercent,    // calculated: (change / pc) * 100
                o: q.open,              // from finnhub_quote_snapshots
                h: q.high,              // from finnhub_quote_snapshots
                l: q.low,               // from finnhub_quote_snapshots
                pc: q.previousClose,    // from finnhub_quote_snapshots
                volume: q.volume,
                timestamp: q.timestamp,
                source: q.source
              }];
            }
            
            results.push({
              collection: query.collection,
              data: formattedData,
              count: formattedData.length,
              reasoning: query.reasoning
            });
            console.log(`   ✅ Found ${formattedData.length} quote snapshots (source: ${result.data?.source || 'unknown'})`);
          } else if (query.collection === 'one_minute_prices' || query.collection === 'daily_prices' || query.collection === 'hourly_prices') {
            // Fetch price history from Supabase
            const { supabase } = require('../config/database');
            
            let supabaseQuery = supabase
              .from(query.collection)
              .select('*');
            
            // Apply query filters
            Object.keys(query.query).forEach(key => {
              const value = query.query[key];
              
              // Handle AI-generated queries like "timestamp_gte" or "timestamp_lte"
              // Convert them to proper Supabase filter calls
              if (key.endsWith('_gte')) {
                const actualKey = key.replace('_gte', '');
                supabaseQuery = supabaseQuery.gte(actualKey, value);
              } else if (key.endsWith('_lte')) {
                const actualKey = key.replace('_lte', '');
                supabaseQuery = supabaseQuery.lte(actualKey, value);
              } else if (key.endsWith('_gt')) {
                const actualKey = key.replace('_gt', '');
                supabaseQuery = supabaseQuery.gt(actualKey, value);
              } else if (key.endsWith('_lt')) {
                const actualKey = key.replace('_lt', '');
                supabaseQuery = supabaseQuery.lt(actualKey, value);
              } else if (typeof value === 'object' && value !== null) {
                // Handle nested operators like { gte: "2026-01-05T00:00:00Z" }
                Object.keys(value).forEach(op => {
                  if (op === 'gte') {
                    supabaseQuery = supabaseQuery.gte(key, value[op]);
                  } else if (op === 'lte') {
                    supabaseQuery = supabaseQuery.lte(key, value[op]);
                  } else if (op === 'gt') {
                    supabaseQuery = supabaseQuery.gt(key, value[op]);
                  } else if (op === 'lt') {
                    supabaseQuery = supabaseQuery.lt(key, value[op]);
                  }
                });
              } else {
                // Simple equality
                supabaseQuery = supabaseQuery.eq(key, value);
              }
            });
            
            // Apply sorting
            if (query.sort) {
              Object.keys(query.sort).forEach(key => {
                const direction = query.sort[key] === 'desc' || query.sort[key] === -1 ? 'desc' : 'asc';
                supabaseQuery = supabaseQuery.order(key, { ascending: direction === 'asc' });
              });
            }
            
            // Apply limit
            if (query.limit) {
              supabaseQuery = supabaseQuery.limit(query.limit);
            }
            
            const { data, error } = await supabaseQuery;
            
            if (error) {
              throw error;
            }
            
            results.push({
              collection: query.collection,
              data: data || [],
              count: data?.length || 0,
              reasoning: query.reasoning
            });
            console.log(`   ✅ Found ${data?.length || 0} price records`);
          }
          // Add other Supabase collections as needed
        }
      } catch (error) {
        console.error(`❌ Error executing query for ${query.collection}:`, error.message);
        results.push({
          collection: query.collection,
          data: [],
          error: error.message,
          reasoning: query.reasoning
        });
      }
    }

    return results;
  }
}

module.exports = new QueryEngine();
