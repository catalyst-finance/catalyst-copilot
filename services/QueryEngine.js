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
   - date: string (YYYY-MM-DD format, e.g., "2025-01-04")
   - title: string (event name, e.g., "Press Gaggle Aboard Air Force One")
   - participants: array of strings (speaker names, e.g., ["President Trump", "Kevin Hassett"])
   - turns: array of {speaker: string, text: string} - full transcript with each speaker's statements
   - source: string (URL)
   - inserted_at: timestamp
   
   Use Cases:
   - What did [politician] say about [topic]?
   - Has [politician] mentioned [company]?
   - Policy announcements, tariffs, regulations
   
   Query Tips:
   - Use $regex on title or participants to find speaker
   - Use $regex on turns.text to search transcript content
   - Use $or for multiple search terms: find documents mentioning ANY of the keywords

2. **sec_filings** - SEC filings (10-K, 10-Q, 8-K, Form 4, 13F, etc.)
   Schema:
   - ticker: string (e.g., "TSLA")
   - form_type: string (e.g., "10-Q", "8-K", "Form 4")
   - acceptance_datetime: string (ISO timestamp)
   - content: string (full filing text)
   - url: string (SEC.gov URL)
   - filing_date: string (YYYY-MM-DD)
   
   Use Cases:
   - Latest 10-Q for [ticker]
   - Form 4 insider trading filings
   - Business updates, financial statements
   
   Query Tips:
   - Filter by ticker and form_type
   - Use acceptance_datetime for date ranges
   - Use $regex on content for keyword searches

3. **institutional_ownership** - 13F filings showing institutional holdings
   Schema:
   - ticker: string
   - institution_name: string
   - shares: number
   - value: number
   - report_date: string (YYYY-MM-DD)
   - change_shares: number
   - change_percent: number
   
   Use Cases:
   - Which institutions own [ticker]?
   - Hedge fund positioning
   - Smart money flows

4. **macro_economics** - Economic indicators, global market news
   Schema:
   - title: string
   - description: string
   - date: string (ISO timestamp with time)
   - country: string
   - category: string
   - author: string
   
   Use Cases:
   - GDP, inflation, unemployment data
   - Market sentiment
   - International markets

**Supabase (PostgreSQL):**

1. **event_data** - Corporate events (earnings, FDA approvals, product launches)
   Schema:
   - ticker: string
   - type: string (earnings, fda, product, merger, legal, regulatory)
   - title: string
   - actualDateTime_et: timestamp
   - impact: string
   - aiInsight: string
   
   Use Cases:
   - Upcoming earnings dates
   - FDA trial milestones
   - Product launches, M&A announcements

2. **finnhub_quote_snapshots** - Current stock quotes
   Schema:
   - symbol: string
   - close: number (price)
   - change: number
   - change_percent: number
   - volume: number
   - timestamp: timestamp

3. **daily_prices** / **intraday_prices** - Historical price data
   Schema:
   - symbol: string
   - timestamp: timestamp
   - open, high, low, close: number
   - volume: number

**QUERY GENERATION RULES:**

1. **Speaker name mapping:**
   - "Trump" → search for "trump" OR "hassett" (Hassett speaks for Trump admin)
   - "Biden" → search for "biden"
   - "Powell" → search for "powell"

2. **Date handling:**
   - "last year" → calculate date range from 365 days ago to today
   - "last week" → 7 days ago to today
   - Always return date ranges as {$gte: "YYYY-MM-DD", $lte: "YYYY-MM-DD"}

3. **Keyword extraction:**
   - For semantic queries like "take a stake in", extract synonyms:
     - ["stake", "investment", "invest", "acquire", "acquired", "purchase", "ownership", "equity", "shares"]
   - Use $or to match ANY keyword, not all

4. **MongoDB query format:**
   - Use $and at top level for combining filters
   - Use $or within $and for synonym matching
   - Example: Find documents by speaker AND mentioning any keyword:
     {
       "$and": [
         {
           "$or": [
             {"title": {$regex: "trump", $options: "i"}},
             {"participants": {$elemMatch: {$regex: "hassett|trump", $options: "i"}}}
           ]
         },
         {
           "$or": [
             {"title": {$regex: "stake", $options: "i"}},
             {"turns.text": {$regex: "stake", $options: "i"}},
             {"title": {$regex: "investment", $options: "i"}},
             {"turns.text": {$regex: "investment", $options: "i"}}
           ]
         }
       ]
     }

5. **Supabase query format:**
   - Use PostgreSQL syntax with comparison operators
   - Example: .select('*').eq('ticker', 'TSLA').gte('actualDateTime_et', '2025-01-01')

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
      "collection": "government_policy" | "sec_filings" | "institutional_ownership" | "macro_economics" | "event_data" | "finnhub_quote_snapshots" | "daily_prices" | "intraday_prices",
      "query": { /* MongoDB query object or Supabase filter params */ },
      "sort": { /* optional sort params */ },
      "limit": 10,
      "reasoning": "Why this query answers the user's question"
    }
  ],
  "extractCompanies": true | false,
  "needsChart": true | false,
  "intent": "brief description of user's intent"
}

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
              {"title": {"$regex": "stake", "$options": "i"}},
              {"turns.text": {"$regex": "stake", "$options": "i"}},
              {"title": {"$regex": "investment", "$options": "i"}},
              {"turns.text": {"$regex": "investment", "$options": "i"}},
              {"title": {"$regex": "invest", "$options": "i"}},
              {"turns.text": {"$regex": "invest", "$options": "i"}},
              {"title": {"$regex": "acquire", "$options": "i"}},
              {"turns.text": {"$regex": "acquire", "$options": "i"}},
              {"title": {"$regex": "ownership", "$options": "i"}},
              {"turns.text": {"$regex": "ownership", "$options": "i"}},
              {"title": {"$regex": "equity", "$options": "i"}},
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
  "intent": "Find companies mentioned by Trump administration in context of taking stakes/investments"
}

**EXAMPLE 2:**
User: "Did Trump mention Chevron?"
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
              {"title": {"$regex": "chevron", "$options": "i"}},
              {"turns.text": {"$regex": "chevron", "$options": "i"}}
            ]
          }
        ]
      },
      "sort": {"date": -1},
      "limit": 20,
      "reasoning": "Search Trump statements mentioning Chevron specifically"
    }
  ],
  "extractCompanies": false,
  "needsChart": false,
  "intent": "Check if Trump mentioned Chevron in any policy statements"
}

Return ONLY valid JSON, no explanation outside the JSON structure.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4000,
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
        
        if (query.database === 'mongodb') {
          if (query.collection === 'government_policy') {
            const result = await DataConnector.getMacroData('policy', {
              query: query.query,
              sort: query.sort || { date: -1 },
              limit: query.limit || 30
            });
            results.push({
              collection: query.collection,
              data: result.data,
              reasoning: query.reasoning
            });
          } else if (query.collection === 'sec_filings') {
            // Handle SEC filings query
            const ticker = query.query.ticker;
            const formTypes = query.query.form_type?.$in || null;
            const dateRange = query.query.acceptance_datetime ? {
              start: query.query.acceptance_datetime.$gte?.split('T')[0],
              end: query.query.acceptance_datetime.$lte?.split('T')[0]
            } : null;
            
            const result = await DataConnector.getSecFilings(ticker, formTypes, dateRange, query.limit || 10);
            results.push({
              collection: query.collection,
              data: result.data,
              reasoning: query.reasoning
            });
          } else if (query.collection === 'institutional_ownership') {
            const result = await DataConnector.getInstitutionalOwnership(
              query.query.ticker,
              query.limit || 10
            );
            results.push({
              collection: query.collection,
              data: result.data,
              reasoning: query.reasoning
            });
          } else if (query.collection === 'macro_economics') {
            const result = await DataConnector.getMacroData('economic', {
              query: query.query,
              sort: query.sort || { date: -1 },
              limit: query.limit || 20
            });
            results.push({
              collection: query.collection,
              data: result.data,
              reasoning: query.reasoning
            });
          }
        } else if (query.database === 'supabase') {
          if (query.collection === 'event_data') {
            const result = await DataConnector.getEvents(query.query);
            results.push({
              collection: query.collection,
              data: result.data,
              reasoning: query.reasoning
            });
          }
          // Add other Supabase collections as needed
        }
      } catch (error) {
        console.error(`Error executing query for ${query.collection}:`, error);
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
