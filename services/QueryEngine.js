/**
 * AI-Native Query Engine
 * Replaces hardcoded classification and query construction with AI-generated queries
 */

const openai = require('../config/openai');
const { QUERY_SCHEMA_CONTEXT } = require('../config/prompts/schema-context');
const { generateThinkingMessage } = require('../config/thinking-messages');

class QueryEngine {
  constructor() {
    // Use centralized schema context
    this.schemaContext = QUERY_SCHEMA_CONTEXT;
  }

  /**
   * Generate contextual thinking message (delegates to shared service)
   */
  async generateThinkingMessage(intent, context = {}) {
    // Map intent to phase for shared thinking generator
    const phaseMap = {
      'government_policy': 'government_policy',
      'sec_filings': 'sec_filings',
      'company_research': 'sec_filings',
      'market_data': 'price_data',
      'news': 'news',
      'analyst_ratings': 'price_data',
      'institutional': 'sec_filings',
      'earnings': 'sec_filings',
      'events': 'price_data'
    };
    
    const phase = phaseMap[intent] || 'query_start';
    return generateThinkingMessage(phase, context);
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
