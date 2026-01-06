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
   - ticker, type, title, actualDateTime_et, impact, aiInsight

2. **finnhub_quote_snapshots** - Current stock quotes
   - symbol, close, change, change_percent, volume, timestamp

3. **daily_prices** / **intraday_prices** - Historical price data
   - symbol, timestamp, open, high, low, close, volume

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
   - Political statements, policy, tariffs → government_policy
   - SEC filings, financial reports → sec_filings
   - Institutional holders, 13F → ownership
   - Analyst ratings, upgrades → price_targets
   - Company news → news
   - Official announcements → press_releases
   - Earnings calls → earnings_transcripts
   - Social sentiment → hype
   - Economic indicators → macro_economics

**TODAY'S DATE:** ${new Date().toISOString().split('T')[0]}
`;
  }

  /**
   * Generate queries using AI instead of hardcoded logic
   */
  async generateQueries(userMessage, userPortfolio = []) {
    const prompt = `You are a database query generator. Based on the user's question, generate the appropriate database queries to answer it.

${this.schemaContext}

**User's Question:** "${userMessage}"
**User's Portfolio:** ${userPortfolio.length > 0 ? userPortfolio.join(', ') : 'none'}

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
- Calculate date ranges based on today's date: ${new Date().toISOString().split('T')[0]}
- If asking "what companies did [politician] mention?", set extractCompanies: true

Return JSON with this structure:
{
  "queries": [
    {
      "database": "mongodb" | "supabase",
      "collection": "government_policy" | "sec_filings" | "ownership" | "macro_economics" | "news" | "press_releases" | "price_targets" | "earnings_transcripts" | "hype" | "event_data" | "finnhub_quote_snapshots" | "daily_prices" | "intraday_prices",
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
  "intent": "brief description of user's intent"
}

**CRITICAL: needsDeepAnalysis flag**
Set needsDeepAnalysis=true when:
- User says "analyze", "examine", "review", "look at", "what does it say"
- User wants detailed information from SEC filings (financials, R&D, products, risks)
- User mentions specific filing types (10-Q, 10-K, 8-K) and wants content
- User asks about financial figures, revenue, cash position, expenses
- User asks about product development, trials, pipeline, research

Set needsDeepAnalysis=false when:
- User just wants a list of recent filings
- User asks "when was the last 10-Q filed?"
- Simple metadata queries

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
  "analysisKeywords": [],
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
