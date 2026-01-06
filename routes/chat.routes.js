/**
 * Chat Routes
 * Main AI chat endpoint with streaming support
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const openai = require('../config/openai');
const DataConnector = require('../services/DataConnector');
const ConversationManager = require('../services/ConversationManager');
const IntelligenceEngine = require('../services/IntelligenceEngine');
const { optionalAuth } = require('../middleware/auth');

// Main AI chat endpoint
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { 
      message, 
      conversationId = null, 
      conversationHistory = [],
      selectedTickers = [] 
    } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user?.userId || null;

    console.log('Processing message:', message);
    console.log('User ID:', userId);
    console.log('Conversation ID:', conversationId);
    console.log('User portfolio:', selectedTickers);
    
    // SET UP SSE IMMEDIATELY - Start streaming right away
    const origin = req.headers.origin;
    if (origin && (origin.endsWith('.figma.site') || origin === 'https://www.figma.com' || origin === 'https://figma.com')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Cache-Control, Connection');
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    console.log('📡 SSE headers sent immediately - streaming enabled');
    
    // Helper function to send thinking updates
    const sendThinking = (phase, content) => {
      res.write(`data: ${JSON.stringify({ type: 'thinking', phase, content })}\n\n`);
      console.log(`💭 Thinking: ${content}`);
    };
    
    // Verify conversation ownership if conversationId provided
    if (conversationId && userId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('user_id')
        .eq('id', conversationId)
        .single();
      
      if (!conversation || conversation.user_id !== userId) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Access denied to this conversation' })}\n\n`);
        return res.end();
      }
    }
    
    // Load conversation history from database if conversationId provided
    let loadedHistory = conversationHistory;
    if (conversationId) {
      loadedHistory = await ConversationManager.loadConversationContext(conversationId, 4000);
      console.log(`Loaded ${loadedHistory.length} messages from conversation ${conversationId}`);
    }

    // STEP 1: AI-POWERED QUERY CLASSIFICATION
    const currentDate = new Date().toISOString().split('T')[0];
    const classificationPrompt = `You are an intelligent query router for a multi-database financial data system. Analyze the user's question and intelligently determine which data sources and collections to query.

AVAILABLE DATA SOURCES:

**Supabase (PostgreSQL)**:
- finnhub_quote_snapshots: Current stock quotes (price, volume, change)
- intraday_prices: Tick-by-tick intraday data for charts
- daily_prices: Historical daily OHLCV data
- event_data: Corporate events (earnings, FDA approvals, product launches, M&A)

**MongoDB - raw_data database**:
- sec_filings: SEC filings (10-K, 10-Q, 8-K, 4, S-1, 13F, DEF 14A, 424B, etc.)
  * Full text content available for deep analysis
  * Use for: financial statements, risk disclosures, business updates, insider trading
- institutional_ownership: 13F filings showing hedge fund/institution holdings
  * Use for: investor sentiment, smart money positioning, ownership changes
- government_policy: White House transcripts, policy speeches, political commentary
  * Use for: tariffs, regulations, government actions, political statements
- macro_economics: Economic indicators, global market news, country-specific data
  * Use for: GDP, inflation, unemployment, market sentiment, international markets

Analyze the query and return a JSON object:

{
  "intent": "stock_price" | "events" | "institutional" | "sec_filings" | "macro_economic" | "government_policy" | "market_news" | "future_outlook" | "general",
  "dataSources": [
    {
      "database": "supabase" | "mongodb",
      "collection": "sec_filings" | "institutional_ownership" | "government_policy" | "macro_economics" | "event_data" | "finnhub_quote_snapshots" | "intraday_prices" | "daily_prices",
      "priority": 1-10,
      "reasoning": "Why this source is relevant"
    }
  ],
  "tickers": ["TSLA", "AAPL"],
  "timeframe": "current" | "historical" | "upcoming" | "specific_date" | "future",
  "date": "YYYY-MM-DD" or null,
  "dateRange": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"} or null,
  "speaker": "hassett" | "biden" | "trump" | "yellen" | "powell" | null,
  "eventTypes": ["earnings", "fda", "product", "merger", "legal", "regulatory"],
  "formTypes": ["10-K", "10-Q", "8-K", "4", "S-1", "13F"],
  "preferredFormType": "10-Q" | "10-K" | "8-K" | null,
  "scope": "focus_stocks" | "outside_focus" | "all_stocks" | "specific_tickers",
  "needsChart": true | false,
  "isFutureOutlook": true | false,
  "needsDeepAnalysis": true | false,
  "isBiggestMoversQuery": true | false,
  "topicKeywords": ["batteries", "tariffs", "South Korea"]
}

**IMPORTANT NOTE ON formTypes**: 
- When requesting SEC filings for roadmap/product/business questions, ALWAYS include ["10-K", "10-Q", "8-K"] as a minimum
- 8-K filings contain the most recent material events and are CRITICAL for up-to-date analysis
- Never return formTypes with only ["10-K", "10-Q"] - always add "8-K"

**FILING TYPE PREFERENCES BY QUERY TYPE** (intelligent prioritization):
- **Product development, clinical trials, R&D, pipeline**: PREFER 10-Q first - contains detailed MD&A with operational updates, trial progress, business strategy
- **Roadmap, outlook, future plans**: PREFER 10-Q first - has forward-looking statements and management discussion
- **Financial results, earnings**: PREFER 10-Q for quarterly, 10-K for annual, 8-K for announcements
- **Material events, announcements, offerings**: PREFER 8-K - contains time-sensitive disclosures
- **Annual overview, risk factors, full business description**: PREFER 10-K - comprehensive annual report
- **Insider trading, executive compensation**: PREFER Form 4, DEF 14A
- When the query is about detailed business operations or product progress, 10-Q filings have MORE SUBSTANCE than 8-Ks

ROUTING INTELLIGENCE - Use MULTIPLE data sources when relevant:
- Roadmap/outlook questions → event_data (upcoming events) + sec_filings (PRIORITIZE 10-Q for detailed MD&A)
- Product development/clinical trials → sec_filings (PRIORITIZE 10-Q for trial progress details) + event_data
- "Use SEC filings" / "based on filings" → ALWAYS include sec_filings + event_data
- Earnings questions → event_data (dates) + sec_filings (10-Q, 8-K for actual results)
- FDA/regulatory → event_data (trial milestones) + sec_filings (10-Q for trial details, 8-K for announcements)
- Price questions ("how has it performed", "price action", "trading") → intraday_prices or daily_prices (for chart)
- Ownership/investors → institutional_ownership (MongoDB)
- Government policy/tariffs → government_policy (MongoDB)
- Economic indicators → macro_economics (MongoDB)
- Insider trading → sec_filings (MongoDB, Form 4)
- Business updates → sec_filings (PRIORITIZE 10-Q for detailed operational info)
- Political statements → government_policy

**CRITICAL MULTI-SOURCE RULES:**
1. If user mentions "SEC filings", "10-K", "10-Q", "8-K" explicitly → MUST include sec_filings with high priority
2. If asking about future/roadmap/outlook/catalyst → MUST include BOTH event_data AND sec_filings
3. **For SEC filings, ALWAYS include 8-K alongside 10-K and 10-Q** - 8-Ks have the most recent material updates
4. If mentions "price", "trading", "chart", "performance" → MUST include price data (intraday_prices or daily_prices)
5. If combines topics (e.g., "roadmap + SEC filings + price") → include ALL relevant sources
6. Give higher priority (7-10) to explicitly mentioned data types

IMPORTANT: Today's date is ${currentDate}. 
- When user says "last week", calculate the date range from 7 days ago to today.
- When user says "past year" or "last year", calculate the date range from 365 days ago to today.
- When user says "past 6 months", calculate from 180 days ago to today.
- When user says "past 3 months" or "this quarter", calculate from 90 days ago to today.

User's portfolio: ${selectedTickers.join(', ') || 'none'}
User's question: "${message}"

Return ONLY the JSON object with intelligent data source routing based on the query's actual needs.

Return ONLY the JSON object, no explanation.`;

    let queryIntent;
    try {
      const classificationResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: classificationPrompt }],
        temperature: 0.1,
        max_tokens: 5000,
        response_format: { type: "json_object" }
      });
      
      const classificationText = classificationResponse.choices[0].message.content.trim();
      console.log('AI Classification:', classificationText);
      queryIntent = JSON.parse(classificationText);
      console.log('Parsed intent:', queryIntent);
      
    } catch (error) {
      console.error('Query classification failed:', error);
      queryIntent = {
        intent: "general",
        tickers: selectedTickers || [],
        timeframe: "current",
        date: null,
        dateRange: null,
        speaker: null,
        eventTypes: [],
        scope: "focus_stocks",
        needsChart: false,
        isFutureOutlook: false,
        needsDeepAnalysis: false,
        isBiggestMoversQuery: false,
        topicKeywords: [],
        dataSources: [
          {
            database: "supabase",
            collection: "finnhub_quote_snapshots",
            priority: 10,
            reasoning: "Fallback to current stock quotes"
          }
        ]
      };
    }

    // STEP 2: FETCH DATA BASED ON AI-ROUTED DATA SOURCES
    let dataContext = "";
    const dataCards = [];
    const eventData = {};
    
    // Intelligence metadata tracking
    const intelligenceMetadata = {
      totalSources: 0,
      sourceFreshness: [],
      dataCompleteness: { hasExpectedData: false, hasPartialData: false },
      tickers: [],
      secFilingTypes: [],
      hasInstitutionalData: false,
      hasPolicyData: false,
      hasEvents: false,
      upcomingEvents: 0,
      institutionalDataDate: null,
      temporalData: {},
      anomalies: [],
      crossRefData: {},
      sentimentData: [],
      secFilings: [],
      entityRelationships: null
    };
    
    // Log AI routing decisions
    console.log('AI-selected data sources:');
    (queryIntent.dataSources || []).forEach(source => {
      console.log(`  ${source.priority}: ${source.database}.${source.collection} - ${source.reasoning}`);
    });
    
    // Determine which tickers to query based on AI routing
    let tickersToQuery = [];
    const needsTickerData = (queryIntent.dataSources || []).some(source => 
      ['sec_filings', 'institutional_ownership', 'event_data', 'finnhub_quote_snapshots', 'intraday_prices', 'daily_prices'].includes(source.collection)
    );
    
    if (needsTickerData) {
      if (queryIntent.scope === 'focus_stocks' && selectedTickers.length > 0) {
        tickersToQuery = selectedTickers;
      } else if (queryIntent.scope === 'specific_tickers' && queryIntent.tickers.length > 0) {
        tickersToQuery = queryIntent.tickers;
      } else if (queryIntent.tickers.length > 0) {
        tickersToQuery = queryIntent.tickers;
      } else if (selectedTickers.length > 0) {
        tickersToQuery = selectedTickers;
      }
    }
    
    console.log('Tickers to query:', tickersToQuery);
    
    // Sort data sources by priority (highest first)
    const sortedDataSources = (queryIntent.dataSources || []).sort((a, b) => b.priority - a.priority);
    
    // DYNAMICALLY FETCH DATA BASED ON AI ROUTING
    for (const dataSource of sortedDataSources) {
      const { database, collection, reasoning } = dataSource;
      
      try {
        // INSTITUTIONAL OWNERSHIP
        if (collection === 'institutional_ownership' && tickersToQuery.length > 0) {
          sendThinking('retrieving', `Looking up institutional ownership data...`);
          for (const ticker of tickersToQuery.slice(0, 3)) {
            try {
              const instResult = await DataConnector.getInstitutionalData(ticker);
              if (instResult.success && instResult.data.length > 0) {
                const ownership = instResult.data[0];
                dataContext += `\n\n${ticker} Institutional Ownership (as of ${ownership.date}):\n`;
                dataContext += `Total institutional ownership: ${ownership.ownership.percentage}\n`;
                dataContext += `Shares held: ${ownership.ownership.totalShares} by ${ownership.ownership.totalHolders} holders\n`;
                dataContext += `Position changes: ${ownership.activity.increased.holders} increased (${ownership.activity.increased.shares} shares), `;
                dataContext += `${ownership.activity.decreased.holders} decreased (${ownership.activity.decreased.shares} shares)\n`;
                
                if (ownership.topHolders && ownership.topHolders.length > 0) {
                  dataContext += `\nTop 10 institutional holders:\n`;
                  ownership.topHolders.forEach((holder, i) => {
                    dataContext += `${i + 1}. ${holder.owner}: ${holder.shares} shares ($${holder.marketValue}), change: ${holder.change}\n`;
                  });
                }
              }
            } catch (error) {
              console.error(`Error fetching institutional data for ${ticker}:`, error);
            }
          }
        }
        
        // SEC FILINGS
        if (collection === 'sec_filings' && tickersToQuery.length > 0) {
          sendThinking('retrieving', `Searching SEC filings database...`);
          const formTypes = queryIntent.formTypes && queryIntent.formTypes.length > 0 ? queryIntent.formTypes : null;
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          const dateRange = queryIntent.dateRange || null;
          
          let uniqueKeywords = [];
          
          if (needsDeepAnalysis) {
            sendThinking('retrieving', `Expanding search keywords with AI...`);
            try {
              const keywordPrompt = `You are an expert research analyst. Extract and intelligently expand search terms from this query to find relevant content in SEC filings.

User query: "${message}"

Return a JSON object with a "keywords" array containing 15-25 search strings.`;

              const keywordResponse = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: keywordPrompt }],
                temperature: 0.2,
                max_tokens: 500,
                response_format: { type: "json_object" }
              });
              
              const keywordText = keywordResponse.choices[0].message.content.trim();
              const keywordData = JSON.parse(keywordText);
              uniqueKeywords = (keywordData.keywords || []).filter(k => k && k.length > 2);
              
              console.log(`AI-expanded keywords for SEC filing analysis: ${uniqueKeywords.join(', ')}`);
            } catch (error) {
              console.error('Keyword expansion failed, using basic extraction:', error);
              uniqueKeywords = message
                .split(/\s+/)
                .filter(word => word.length > 3 && /^[A-Za-z]+$/.test(word))
                .slice(0, 10);
            }
          } else {
            uniqueKeywords = message
              .split(/\s+/)
              .filter(word => word.length > 3 && /^[A-Za-z]+$/.test(word))
              .slice(0, 5);
          }
          
          sendThinking('retrieving', `Querying SEC database for ${tickersToQuery.slice(0, 3).join(', ')}...`);
          
          for (const ticker of tickersToQuery.slice(0, 3)) {
            try {
              const secResult = await DataConnector.getSecFilings(ticker, formTypes, dateRange, needsDeepAnalysis ? 50 : 10);
              if (secResult.success && secResult.data.length > 0) {
                // Track metadata
                intelligenceMetadata.totalSources += secResult.data.length;
                intelligenceMetadata.tickers.push(ticker);
                
                // Track filing types found
                secResult.data.forEach(filing => {
                  if (filing.form_type && !intelligenceMetadata.secFilingTypes.includes(filing.form_type)) {
                    intelligenceMetadata.secFilingTypes.push(filing.form_type);
                  }
                  
                  // Track freshness
                  if (filing.acceptance_datetime) {
                    const filingDate = new Date(filing.acceptance_datetime);
                    const today = new Date();
                    const daysSinceFiling = (today - filingDate) / (1000 * 60 * 60 * 24);
                    intelligenceMetadata.sourceFreshness.push(daysSinceFiling);
                  }
                });
                
                // Store for temporal analysis
                if (!intelligenceMetadata.temporalData[ticker]) {
                  intelligenceMetadata.temporalData[ticker] = { filings: [] };
                }
                secResult.data.forEach(filing => {
                  intelligenceMetadata.temporalData[ticker].filings.push({
                    date: filing.acceptance_datetime,
                    type: filing.form_type
                  });
                });
                
                const substantiveTypes = ['10-K', '10-Q', '8-K', 'S-1', '10-K/A', '10-Q/A', '8-K/A', 'DEF 14A', '424B'];
                let substantiveFilings = secResult.data.filter(f => substantiveTypes.some(t => f.form_type?.includes(t)));
                
                // Sort filings by preferred form type if specified (e.g., prefer 10-Q for product development queries)
                const preferredFormType = queryIntent.preferredFormType || null;
                if (preferredFormType && substantiveFilings.length > 1) {
                  substantiveFilings.sort((a, b) => {
                    const aIsPreferred = a.form_type?.includes(preferredFormType);
                    const bIsPreferred = b.form_type?.includes(preferredFormType);
                    if (aIsPreferred && !bIsPreferred) return -1;
                    if (!aIsPreferred && bIsPreferred) return 1;
                    // Secondary sort: prefer 10-Q over 8-K for detailed content
                    const aIs10Q = a.form_type?.includes('10-Q');
                    const bIs10Q = b.form_type?.includes('10-Q');
                    if (aIs10Q && !bIs10Q) return -1;
                    if (!aIs10Q && bIs10Q) return 1;
                    // Fall back to date (most recent first)
                    return new Date(b.acceptance_datetime || 0) - new Date(a.acceptance_datetime || 0);
                  });
                  console.log(`📋 Sorted filings by preferred type: ${preferredFormType}`);
                }
                
                dataContext += `\n\n${ticker} SEC Filings Analysis:\n`;
                
                if (needsDeepAnalysis && substantiveFilings.length > 0) {
                  const filingsToAnalyze = substantiveFilings.slice(0, 3);
                  
                  sendThinking('retrieving', `Fetching content from ${filingsToAnalyze.length} SEC filing(s)...`);
                  
                  for (let i = 0; i < filingsToAnalyze.length; i++) {
                    const filing = filingsToAnalyze[i];
                    const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                    
                    dataContext += `${i + 1}. ${filing.form_type} filed on ${date}\n`;
                    dataContext += `   URL: ${filing.url}\n`;
                    
                    if (filing.url) {
                      const contentResult = await DataConnector.fetchSecFilingContent(
                        filing.url, 
                        uniqueKeywords, 
                        25000
                      );
                      
                      if (contentResult.success && contentResult.content) {
                        dataContext += `\n   === ${filing.form_type} CONTENT ===\n${contentResult.content}\n   === END CONTENT ===\n`;
                        
                        // Store filing data for sentiment and entity analysis
                        intelligenceMetadata.secFilings.push({
                          ticker,
                          formType: filing.form_type,
                          date: filing.acceptance_datetime,
                          content: contentResult.content.substring(0, 5000), // First 5000 chars for analysis
                          url: filing.url
                        });
                        
                        if (contentResult.images && contentResult.images.length > 0) {
                          contentResult.images.slice(0, 5).forEach((img, idx) => {
                            const imageId = `sec-image-${ticker}-${filing.accession_number || i}-${idx}`;
                            dataCards.push({
                              type: 'image',
                              data: {
                                id: imageId,
                                ticker: ticker,
                                source: 'sec_filing',
                                title: img.alt || 'Chart/Diagram from SEC Filing',
                                imageUrl: img.url,
                                context: img.context || null,
                                filingType: filing.form_type,
                                filingDate: date,
                                filingUrl: filing.url
                              }
                            });
                            // Add inline marker immediately after the filing content
                            dataContext += `   [IMAGE_CARD:${imageId}]\n`;
                          });
                        }
                      }
                    }
                  }
                  
                  const totalImages = dataCards.filter(c => c.type === 'image' && c.data.ticker === ticker).length;
                  if (totalImages > 0) {
                    sendThinking('retrieving', `Extracted ${totalImages} image(s) from ${ticker} filings...`);
                  }
                } else {
                  secResult.data.slice(0, 5).forEach((filing, i) => {
                    const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                    dataContext += `${i + 1}. ${filing.form_type} (${date}): ${filing.url}\n`;
                  });
                }
              }
            } catch (error) {
              console.error(`Error fetching SEC filings for ${ticker}:`, error);
            }
          }
        }
        
        // GOVERNMENT POLICY
        if (collection === 'government_policy') {
          sendThinking('retrieving', `Fetching government policy statements...`);
          const macroFilters = {
            category: 'policy'
          };
          if (queryIntent.speaker) macroFilters.speaker = queryIntent.speaker;
          if (queryIntent.dateRange) {
            macroFilters.date = {
              $gte: queryIntent.dateRange.start,
              $lte: queryIntent.dateRange.end
            };
          }
          if (queryIntent.topicKeywords && queryIntent.topicKeywords.length > 0) {
            macroFilters.textSearch = queryIntent.topicKeywords.join(' ');
          }
          
          try {
            const policyResult = await DataConnector.getMacroData('policy', macroFilters);
            if (policyResult.success && policyResult.data.length > 0) {
              dataContext += `\n\nGovernment Policy Data:\n`;
              policyResult.data.slice(0, 5).forEach((item, i) => {
                dataContext += `${i + 1}. ${item.title} (${item.date})\n`;
                if (item.quotes) {
                  item.quotes.slice(0, 2).forEach(quote => {
                    dataContext += `   "${quote}"\n`;
                  });
                }
              });
            }
          } catch (error) {
            console.error('Error fetching policy data:', error);
          }
        }
        
        // MACRO/ECONOMIC DATA
        if (collection === 'macro_economics') {
          sendThinking('retrieving', `Fetching economic data...`);
          const macroFilters = {};
          if (queryIntent.dateRange) {
            macroFilters.date = {
              $gte: queryIntent.dateRange.start,
              $lte: queryIntent.dateRange.end
            };
          }
          if (queryIntent.topicKeywords && queryIntent.topicKeywords.length > 0) {
            macroFilters.textSearch = queryIntent.topicKeywords.join(' ');
          }
          
          try {
            const macroResult = await DataConnector.getMacroData('economic', macroFilters);
            if (macroResult.success && macroResult.data.length > 0) {
              dataContext += `\n\nEconomic Data:\n`;
              macroResult.data.slice(0, 5).forEach((item, i) => {
                dataContext += `${i + 1}. ${item.title} (${item.date})\n`;
                if (item.description) {
                  dataContext += `   ${item.description.substring(0, 200)}...\n`;
                }
              });
            }
          } catch (error) {
            console.error('Error fetching macro data:', error);
          }
        }
        
        // EVENT DATA
        if (collection === 'event_data') {
          sendThinking('retrieving', `Fetching event data...`);
          const eventFilters = {};
          if (tickersToQuery.length > 0) {
            eventFilters.ticker = tickersToQuery[0];
          }
          if (queryIntent.eventTypes && queryIntent.eventTypes.length > 0) {
            eventFilters.type = queryIntent.eventTypes;
          }
          
          try {
            const eventResult = await DataConnector.getEvents(eventFilters);
            if (eventResult.success && eventResult.data.length > 0) {
              dataContext += `\n\nEvents:\n`;
              eventResult.data.slice(0, 5).forEach((event, i) => {
                dataContext += `${i + 1}. ${event.title} - ${event.type}\n`;
              });
            }
          } catch (error) {
            console.error('Error fetching events:', error);
          }
        }
        
      } catch (error) {
        console.error(`Error processing data source ${collection}:`, error);
      }
    }
    
    // STEP 2.5: EXTRACT UPCOMING DATES FOR FUTURE OUTLOOK QUERIES
    let upcomingDatesContext = "";
    
    if (queryIntent.isFutureOutlook) {
      console.log('Future outlook query detected - extracting upcoming dates from data');
      const upcomingDates = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (const ticker of tickersToQuery.slice(0, 5)) {
        try {
          const eventFilters = {
            query: {
              ticker: { $regex: new RegExp(`^${ticker}$`, 'i') },
              actualDateTime_et: { $gte: today.toISOString() }
            },
            sort: { actualDateTime_et: 1 },
            limit: 10
          };
          
          const eventsResult = await DataConnector.getEvents(eventFilters);
          
          if (eventsResult.success && eventsResult.data.length > 0) {
            eventsResult.data.forEach(event => {
              const eventDate = new Date(event.actualDateTime_et);
              const daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
              
              upcomingDates.push({
                date: event.actualDateTime_et.split('T')[0],
                daysUntil,
                ticker: event.ticker,
                type: 'event',
                description: `${event.type}: ${event.title}`,
                importance: event.impactRating || 'medium'
              });
            });
          }
        } catch (error) {
          console.error(`Error fetching events for date extraction (${ticker}):`, error);
        }
      }
      
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const recentFilings = await DataConnector.getSecFilings(ticker, ['8-K', '10-Q', '10-K'], null, 5);
          
          if (recentFilings.success && recentFilings.data.length > 0) {
            recentFilings.data.forEach(filing => {
              const filingDate = new Date(filing.acceptance_datetime);
              const daysAgo = Math.ceil((today - filingDate) / (1000 * 60 * 60 * 24));
              
              if (daysAgo <= 30) {
                upcomingDates.push({
                  date: filing.acceptance_datetime.split('T')[0],
                  daysAgo,
                  ticker: filing.ticker,
                  type: 'sec_filing',
                  description: `${filing.form_type} filing - may contain forward guidance`,
                  formType: filing.form_type
                });
              }
            });
          }
        } catch (error) {
          console.error(`Error fetching SEC filings for date extraction (${ticker}):`, error);
        }
      }
      
      upcomingDates.sort((a, b) => {
        if (a.daysUntil !== undefined && b.daysUntil !== undefined) {
          return a.daysUntil - b.daysUntil;
        }
        return 0;
      });
      
      if (upcomingDates.length > 0) {
        upcomingDatesContext = "\n\n═══ KEY UPCOMING DATES ═══\n";
        upcomingDatesContext += "The following dates are important for the requested analysis:\n\n";
        
        const upcomingEvents = upcomingDates.filter(d => d.type === 'event');
        if (upcomingEvents.length > 0) {
          upcomingDatesContext += "UPCOMING EVENTS:\n";
          upcomingEvents.forEach(item => {
            upcomingDatesContext += `• ${item.date} (${item.daysUntil} days) - ${item.ticker}: ${item.description}\n`;
          });
          upcomingDatesContext += "\n";
        }
        
        const recentFilings = upcomingDates.filter(d => d.type === 'sec_filing');
        if (recentFilings.length > 0) {
          upcomingDatesContext += "RECENT SEC FILINGS (may contain forward guidance):\n";
          recentFilings.slice(0, 5).forEach(item => {
            upcomingDatesContext += `• ${item.date} (${item.daysAgo} days ago) - ${item.ticker}: ${item.description}\n`;
          });
        }
        
        console.log(`Extracted ${upcomingDates.length} key dates for future outlook analysis`);
      } else {
        upcomingDatesContext = "\n\n═══ NO UPCOMING DATES FOUND ═══\nNo scheduled events or recent filings found in the database. Analysis should focus on historical trends and general market conditions.\n";
        console.log('No upcoming dates found for future outlook query');
      }
    }

    // STEP 3: PRE-GENERATE EVENT CARDS
    const hasEventContext = conversationHistory && conversationHistory.some(msg => 
      msg.role === 'user' && /event|earnings|FDA|approval|launch|announcement|legal|regulatory/i.test(msg.content)
    );
    
    const shouldFetchEvents = (queryIntent.dataSources || []).some(ds => ds.collection === 'event_data') || hasEventContext;
    let eventCardsContext = "";
    
    if (shouldFetchEvents) {
      const isUpcomingQuery = queryIntent.timeframe === 'upcoming' || queryIntent.isFutureOutlook;
      const today = new Date().toISOString();
      // For roadmap/outlook queries, fetch ALL event types, not just requested ones
      const requestedEventTypes = queryIntent.isFutureOutlook ? [] : (queryIntent.eventTypes || []);
      const isFocusOnlyQuery = queryIntent.scope === 'focus_stocks';
      const isOutsideFocusQuery = queryIntent.scope === 'outside_focus';
      const isSpecificTickersQuery = queryIntent.scope === 'specific_tickers';
      
      let tickersForEvents = [];
      
      if (isFocusOnlyQuery) {
        tickersForEvents = selectedTickers || [];
      } else if (isSpecificTickersQuery) {
        // When user asks about specific tickers (e.g., "What is the roadmap for MNMD?"), 
        // use ONLY those tickers for events, not the portfolio
        tickersForEvents = queryIntent.tickers || [];
        console.log(`💭 Thinking: Fetching events for specifically requested tickers: ${tickersForEvents.join(', ')}`);
      } else if (isOutsideFocusQuery) {
        try {
          const eventsQuery = { 
            ticker: { $nin: selectedTickers || [] },
            title: { $ne: null },
            aiInsight: { $ne: null }
          };
          
          if (requestedEventTypes.length > 0) {
            eventsQuery.type = { $in: requestedEventTypes };
          }
          
          if (isUpcomingQuery) {
            eventsQuery.actualDateTime_et = { $gte: today };
          }
          
          const eventsResult = await DataConnector.getEvents({ 
            query: eventsQuery,
            limit: 20,
            sort: isUpcomingQuery ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
          });
          
          if (eventsResult.success && eventsResult.data.length > 0) {
            const uniqueTickersSet = new Set();
            for (const event of eventsResult.data) {
              if (uniqueTickersSet.size >= 6) break;
              uniqueTickersSet.add(event.ticker);
            }
            tickersForEvents = Array.from(uniqueTickersSet).slice(0, 6);
          }
        } catch (error) {
          console.error('Error querying database for outside focus stocks:', error);
        }
      } else {
        const focusStocksWithEvents = [];
        
        if (selectedTickers && selectedTickers.length > 0) {
          for (const ticker of selectedTickers) {
            try {
              const checkQuery = {
                ticker,
                title: { $ne: null },
                aiInsight: { $ne: null }
              };
              
              if (requestedEventTypes.length > 0) {
                checkQuery.type = { $in: requestedEventTypes };
              }
              
              if (isUpcomingQuery) {
                checkQuery.actualDateTime_et = { $gte: today };
              }
              
              const checkResult = await DataConnector.getEvents({ 
                query: checkQuery,
                limit: 1 
              });
              
              if (checkResult.success && checkResult.data.length > 0) {
                focusStocksWithEvents.push(ticker);
              }
            } catch (error) {
              console.error(`Error checking focus stock ${ticker}:`, error);
            }
          }
        }
        
        const targetCount = 6;
        const remainingSlots = Math.max(0, targetCount - focusStocksWithEvents.length);
        
        if (remainingSlots > 0) {
          try {
            const eventsQuery = {
              ticker: { $nin: selectedTickers || [] },
              title: { $ne: null },
              aiInsight: { $ne: null }
            };
            
            if (requestedEventTypes.length > 0) {
              eventsQuery.type = { $in: requestedEventTypes };
            }
            
            if (isUpcomingQuery) {
              eventsQuery.actualDateTime_et = { $gte: today };
            }
            
            const eventsResult = await DataConnector.getEvents({
              query: eventsQuery,
              limit: 20,
              sort: isUpcomingQuery ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
            });
            
            if (eventsResult.success && eventsResult.data.length > 0) {
              const outsideTickersSet = new Set();
              for (const event of eventsResult.data) {
                if (outsideTickersSet.size >= remainingSlots) break;
                outsideTickersSet.add(event.ticker);
              }
              
              const outsideTickers = Array.from(outsideTickersSet);
              tickersForEvents = [...focusStocksWithEvents, ...outsideTickers];
            } else {
              tickersForEvents = focusStocksWithEvents;
            }
          } catch (error) {
            console.error('Error querying for outside stocks:', error);
            tickersForEvents = focusStocksWithEvents;
          }
        } else {
          tickersForEvents = focusStocksWithEvents;
        }
      }
      
      const uniqueTickers = [...new Set(tickersForEvents)];
      
      try {
        const eventPromises = uniqueTickers.map(async (ticker) => {
          try {
            const eventsQuery = {
              ticker,
              title: { $ne: null },
              aiInsight: { $ne: null }
            };
            
            if (requestedEventTypes.length > 0) {
              eventsQuery.type = { $in: requestedEventTypes };
            }
            
            if (isUpcomingQuery) {
              eventsQuery.actualDateTime_et = { $gte: today };
            }
            
            const eventsResult = await DataConnector.getEvents({
              query: eventsQuery,
              limit: 5,
              sort: isUpcomingQuery ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
            });
            
            return eventsResult.data || [];
          } catch (error) {
            console.error(`Error fetching events for ${ticker}:`, error);
            return [];
          }
        });
        
        const allEventsArrays = await Promise.all(eventPromises);
        const allEvents = allEventsArrays.flat();
        
        allEvents.sort((a, b) => {
          const dateA = new Date(a.actualDateTime_et || a.actualDateTime || 0);
          const dateB = new Date(b.actualDateTime_et || b.actualDateTime || 0);
          return isUpcomingQuery ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        });
        
        const topEvents = allEvents.slice(0, 5);
        
        if (topEvents.length > 0) {
          eventCardsContext = `\n\n**CRITICAL - EVENT CARDS TO DISPLAY INLINE:**\nThe following ${topEvents.length} events MUST be integrated into your timeline/roadmap sections - DO NOT create a separate "Event Cards" or "Important Events" section at the end. Each event should appear in the appropriate time period section (Q1, Q2, etc.) with its [EVENT_CARD:...] marker placed at the end of the bullet point describing that event:\n\n`;
          topEvents.forEach((event, index) => {
            const eventDate = new Date(event.actualDateTime_et || event.actualDateTime).toLocaleDateString();
            const eventId = event.id || `${event.ticker}_${event.type}_${(event.actualDateTime_et || event.actualDateTime)}`;
            eventCardsContext += `${index + 1}. ${event.ticker} - ${event.title} (${event.type}) on ${eventDate}\n   AI Insight: ${event.aiInsight}\n   Marker to use: [EVENT_CARD:${eventId}]\n\n`;
          });
          eventCardsContext += `\n**INTEGRATION RULES:**\n- Place each event in the appropriate timeline section (e.g., May 2026 events go in Q2 2026)\n- Add the [EVENT_CARD:...] marker at the END of the bullet point describing that specific event\n- NEVER create a separate section like "Important Event Cards" or "Events Summary" - events must be woven into the narrative\n- Example: "• VOYAGE Phase 3 topline data expected May 15, 2026, which could de-risk the MM120 platform [EVENT_CARD:MNMD_clinical_2026-05-15T09:00:00+00:00]"`;
          console.log(`📋 Event Cards Context Built: ${topEvents.length} events with inline markers`);
        }
        
        for (const event of topEvents) {
          const eventId = event.id || `${event.ticker}_${event.type}_${event.actualDateTime_et || event.actualDateTime}`;
          eventData[eventId] = {
            id: event.id || eventId,
            ticker: event.ticker,
            title: event.title,
            type: event.type,
            datetime: event.actualDateTime_et || event.actualDateTime,
            aiInsight: event.aiInsight,
            impact: event.impact
          };
          dataCards.push({
            type: "event",
            data: eventData[eventId]
          });
        }
      } catch (error) {
        console.error("Error generating event cards:", error);
      }
    }
    
    // STEP 4: GENERATE STOCK CARDS
    const isBiggestMoversQuery = queryIntent.isBiggestMoversQuery || false;
    
    if (isBiggestMoversQuery && selectedTickers && selectedTickers.length > 0) {
      try {
        const stockDataPromises = selectedTickers.map(async (ticker) => {
          try {
            const stockResult = await DataConnector.getStockData(ticker, 'current');
            if (stockResult.success && stockResult.data.length > 0) {
              return stockResult.data[0];
            }
          } catch (error) {
            console.error(`Error fetching data for ${ticker}:`, error);
          }
          return null;
        });
        
        const stocksData = (await Promise.all(stockDataPromises)).filter(s => s !== null);
        stocksData.sort((a, b) => Math.abs(b.change_percent || 0) - Math.abs(a.change_percent || 0));
        
        const topMovers = stocksData.slice(0, Math.min(5, stocksData.length));
        
        const companyDataPromises = topMovers.map(async (quote) => {
          try {
            const { data, error } = await supabase
              .from('company_information')
              .select('name')
              .eq('symbol', quote.symbol)
              .limit(1)
              .single();
            
            if (data) {
              return { symbol: quote.symbol, name: data.name };
            }
          } catch (error) {
            console.error(`Error fetching company name for ${quote.symbol}:`, error);
          }
          return { symbol: quote.symbol, name: quote.symbol };
        });
        
        const companyNames = await Promise.all(companyDataPromises);
        const companyNameMap = Object.fromEntries(companyNames.map(c => [c.symbol, c.name]));
        
        if (topMovers.length > 0) {
          dataContext += `\n\n=== WATCHLIST BIGGEST MOVERS (TOP ${topMovers.length}) ===\n`;
          for (const quote of topMovers) {
            const company = companyNameMap[quote.symbol] || quote.symbol;
            dataContext += `\n${quote.symbol} (${company}):\n`;
            dataContext += `- Current Price: $${quote.close?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Change: $${quote.change?.toFixed(2) || 'N/A'} (${quote.change_percent?.toFixed(2) || 'N/A'}%)\n`;
            dataContext += `- Day High: $${quote.high?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Day Low: $${quote.low?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Volume: ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}\n`;
          }
        }
        
        for (const quote of topMovers) {
          dataCards.push({
            type: "stock",
            data: {
              ticker: quote.symbol,
              company: companyNameMap[quote.symbol] || quote.symbol,
              price: quote.close,
              change: quote.change,
              changePercent: quote.change_percent,
              chartData: []
            }
          });
        }
      } catch (error) {
        console.error("Error fetching watchlist movers:", error);
      }
    } else {
      // Check if price data is requested in dataSources (intraday_prices or daily_prices)
      const priceDataRequested = (queryIntent.dataSources || []).some(ds => 
        ['intraday_prices', 'daily_prices', 'finnhub_quote_snapshots'].includes(ds.collection)
      );
      const shouldShowIntradayChart = queryIntent.needsChart || priceDataRequested;
      const ticker = queryIntent.tickers && queryIntent.tickers.length > 0 ? queryIntent.tickers[0] : null;
      
      if (ticker && (shouldShowIntradayChart || queryIntent.intent === 'stock_price')) {
        try {
          const isVolumeQuery = /volume|traded|trading.*shares|shares.*traded/i.test(message);
          
          let priceTable = 'intraday_prices';
          let chartTimeframe = 'intraday';
          
          if (queryIntent.dateRange) {
            const startDate = new Date(queryIntent.dateRange.start);
            const endDate = new Date(queryIntent.dateRange.end);
            const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff <= 1) {
              priceTable = 'intraday_prices';
              chartTimeframe = 'intraday';
            } else if (daysDiff <= 7) {
              priceTable = 'one_minute_prices';
              chartTimeframe = '1week';
            } else if (daysDiff <= 30) {
              priceTable = 'hourly_prices';
              chartTimeframe = '1month';
            } else {
              priceTable = 'daily_prices';
              chartTimeframe = 'daily';
            }
          }
          
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            
            let companyName = ticker;
            try {
              const { data, error } = await supabase
                .from('company_information')
                .select('name')
                .eq('symbol', ticker)
                .limit(1)
                .single();
              
              if (data) {
                companyName = data.name;
              }
            } catch (error) {
              console.error(`Error fetching company name for ${ticker}:`, error);
            }
            
            let priceHistory = [];
            let chartReference = null;
            
            if (priceTable === 'daily_prices') {
              const startDate = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const endDate = queryIntent.dateRange?.end || new Date().toISOString().split('T')[0];
              
              const { data: dailyData, error: dailyError } = await supabase
                .from('daily_prices')
                .select('date, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: true });
              
              if (!dailyError && dailyData && dailyData.length > 0) {
                priceHistory = dailyData.map(row => ({
                  timestamp: row.date,
                  open: row.open,
                  high: row.high,
                  low: row.low,
                  close: row.close,
                  volume: row.volume
                }));
              }
            } else if (priceTable === 'hourly_prices') {
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              const { data: hourlyData, error: hourlyError } = await supabase
                .from('hourly_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (!hourlyError && hourlyData && hourlyData.length > 0) {
                priceHistory = hourlyData;
              }
            } else if (priceTable === 'one_minute_prices') {
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              const { data: minuteData, error: minuteError } = await supabase
                .from('one_minute_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (!minuteError && minuteData && minuteData.length > 0) {
                priceHistory = minuteData;
              }
            } else {
              const targetDate = new Date();
              const etOffset = -5 * 60;
              const etDate = new Date(targetDate.getTime() + (etOffset + targetDate.getTimezoneOffset()) * 60000);
              const dateStr = etDate.toISOString().split('T')[0];
              
              chartReference = {
                table: 'intraday_prices',
                symbol: ticker,
                dateRange: {
                  start: `${dateStr}T00:00:00`,
                  end: `${dateStr}T23:59:59`
                },
                columns: ['timestamp_et', 'price', 'volume'],
                orderBy: 'timestamp_et.asc'
              };
            }
            
            dataCards.push({
              type: "stock",
              data: {
                ticker: quote.symbol,
                company: companyName,
                price: quote.close,
                change: quote.change,
                changePercent: quote.change_percent,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                previousClose: quote.previous_close,
                volume: quote.volume,
                chartReference: chartReference,
                chartData: priceHistory.length > 0 ? priceHistory : null,
                chartTimeframe: chartTimeframe,
                priceTable: priceTable
              }
            });
            
            dataContext += `\n\n**STOCK CARD DATA FOR ${ticker}:**
- Current Price: $${quote.close.toFixed(2)}
- Change: ${quote.change >= 0 ? '+' : ''}$${quote.change.toFixed(2)} (${quote.change_percent >= 0 ? '+' : ''}${quote.change_percent.toFixed(2)}%)
- Day High: $${quote.high?.toFixed(2) || 'N/A'}
- Day Low: $${quote.low?.toFixed(2) || 'N/A'}
- Previous Close: $${quote.previous_close?.toFixed(2) || 'N/A'}`;
            
            if (priceHistory.length > 0) {
              const oldestPrice = priceHistory[0].close;
              const newestPrice = priceHistory[priceHistory.length - 1].close;
              const periodChange = ((newestPrice - oldestPrice) / oldestPrice * 100).toFixed(2);
              dataContext += `\n- Chart Period: ${priceHistory.length} data points from ${priceTable}`;
              dataContext += `\n- Period Performance: ${periodChange >= 0 ? '+' : ''}${periodChange}%`;
            }
            
            if (isVolumeQuery) {
              const volumeResult = await DataConnector.getVolumeData(ticker, 'intraday');
              
              if (volumeResult.success && volumeResult.data.totalVolume > 0) {
                dataContext += `\n- Trading Volume (Real-time Intraday): ${volumeResult.data.totalVolume.toLocaleString()} shares`;
                dataContext += `\n- Volume Data Points: ${volumeResult.data.dataPoints || 0} tick-by-tick records`;
              } else {
                dataContext += `\n- Trading Volume (Daily): ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
              }
            } else {
              dataContext += `\n- Trading Volume: ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
            }
            
            dataContext += `\n\n**IMPORTANT: Use this exact price data in your response. Do not use any other price information.**`;
          }
        } catch (error) {
          console.error("Error fetching stock data:", error);
        }
      }
    }

    // STEP 5: BUILD CONTEXT MESSAGE
    const contextMessage = selectedTickers.length > 0 
      ? `The user is tracking: ${selectedTickers.join(', ')}.`
      : '';

    // STEP 5.5: INTELLIGENT ANALYSIS
    sendThinking('synthesizing', 'Running intelligent analysis...');
    
    // Multi-step query decomposition
    const subQueries = IntelligenceEngine.decomposeComplexQuery(message, queryIntent);
    if (subQueries.length > 0) {
      console.log('🧩 Complex Query Decomposed:', subQueries);
    }
    
    // Calculate confidence score
    intelligenceMetadata.dataCompleteness.hasExpectedData = intelligenceMetadata.totalSources >= 3;
    intelligenceMetadata.dataCompleteness.hasPartialData = intelligenceMetadata.totalSources > 0;
    
    const confidence = IntelligenceEngine.calculateConfidence(intelligenceMetadata);
    console.log('📊 Confidence Analysis:', confidence);
    
    // Detect anomalies in temporal patterns
    Object.keys(intelligenceMetadata.temporalData).forEach(ticker => {
      const filings = intelligenceMetadata.temporalData[ticker].filings;
      if (filings.length >= 3) {
        const pattern = IntelligenceEngine.analyzeTemporalPatterns(filings, `${ticker} SEC filings`);
        if (pattern.hasPattern || pattern.insights?.length > 0) {
          console.log(`📈 Temporal Pattern for ${ticker}:`, pattern);
          intelligenceMetadata.anomalies.push({
            type: 'temporal_pattern',
            ticker,
            pattern
          });
        }
        
        // Detect filing frequency anomalies
        const filingCounts = filings.map((f, i) => ({ value: 1, date: f.date }));
        const anomalies = IntelligenceEngine.detectAnomalies(filingCounts, `${ticker} filing frequency`);
        if (anomalies.length > 0) {
          console.log(`⚠️ Anomalies detected for ${ticker}:`, anomalies);
          intelligenceMetadata.anomalies.push(...anomalies);
        }
      }
    });
    
    // Identify missing data
    const missingData = IntelligenceEngine.identifyMissingData(queryIntent, intelligenceMetadata);
    if (missingData.length > 0) {
      console.log('🔍 Missing Data Detected:', missingData);
    }
    
    // Generate follow-up suggestions
    const followUps = IntelligenceEngine.generateFollowUps(queryIntent, intelligenceMetadata);
    console.log('💡 Suggested Follow-ups:', followUps);
    
    // Sentiment analysis on SEC filings
    const sentiments = [];
    intelligenceMetadata.secFilings.forEach(filing => {
      const sentiment = IntelligenceEngine.analyzeSentiment(
        filing.content,
        `${filing.ticker} ${filing.formType}`
      );
      if (sentiment.hasSentiment) {
        sentiment.date = filing.date;
        sentiments.push(sentiment);
        intelligenceMetadata.sentimentData.push(sentiment);
      }
    });
    
    if (sentiments.length > 0) {
      console.log('💬 Sentiment Analysis:', sentiments);
      
      // Compare sentiments if multiple filings
      if (sentiments.length >= 2) {
        const sentimentComparison = IntelligenceEngine.compareSentiments(sentiments);
        if (sentimentComparison.hasComparison) {
          console.log('📊 Sentiment Comparison:', sentimentComparison);
          intelligenceMetadata.anomalies.push({
            type: 'sentiment_shift',
            data: sentimentComparison
          });
        }
      }
    }
    
    // Build entity relationships
    if (intelligenceMetadata.secFilings.length > 0) {
      const entities = IntelligenceEngine.buildEntityRelationships({
        secFilings: intelligenceMetadata.secFilings
      });
      intelligenceMetadata.entityRelationships = entities;
      
      if (entities.connections.length > 0) {
        console.log('🔗 Entity Relationships:', entities.connections);
      }
    }
    
    // Add intelligence insights to context
    let intelligenceContext = '';
    
    if (confidence.level !== 'High') {
      intelligenceContext += `\n\n═══ DATA QUALITY ASSESSMENT ═══\n`;
      intelligenceContext += `Confidence Level: ${confidence.level} (${confidence.score}/100)\n`;
      intelligenceContext += `Factors: ${confidence.factors.join(', ')}\n`;
      if (confidence.warnings.length > 0) {
        intelligenceContext += `Warnings:\n${confidence.warnings.map(w => `- ${w}`).join('\n')}\n`;
      }
    }
    
    if (missingData.length > 0) {
      intelligenceContext += `\n\n═══ DATA GAPS IDENTIFIED ═══\n`;
      missingData.forEach(gap => {
        intelligenceContext += `- ${gap.message}\n`;
      });
    }
    
    if (intelligenceMetadata.anomalies.length > 0) {
      intelligenceContext += `\n\n═══ PATTERNS & ANOMALIES ═══\n`;
      intelligenceMetadata.anomalies.forEach(anomaly => {
        if (anomaly.pattern) {
          intelligenceContext += `- ${anomaly.pattern.message}\n`;
          if (anomaly.pattern.insights) {
            anomaly.pattern.insights.forEach(insight => {
              intelligenceContext += `  • ${insight.message}\n`;
            });
          }
        } else if (anomaly.type === 'sentiment_shift' && anomaly.data) {
          intelligenceContext += `- Sentiment Analysis: ${anomaly.data.message}\n`;
          if (anomaly.data.insights) {
            anomaly.data.insights.forEach(insight => {
              intelligenceContext += `  • ${insight}\n`;
            });
          }
        } else if (anomaly.message) {
          intelligenceContext += `- ${anomaly.message}\n`;
        }
      });
    }
    
    // Add sentiment insights
    if (intelligenceMetadata.sentimentData.length > 0) {
      intelligenceContext += `\n\n═══ MANAGEMENT SENTIMENT ═══\n`;
      intelligenceMetadata.sentimentData.forEach(s => {
        intelligenceContext += `- ${s.message} (${s.scores.positive}% positive, ${s.scores.negative}% negative)\n`;
      });
    }
    
    // Add entity relationships
    if (intelligenceMetadata.entityRelationships && intelligenceMetadata.entityRelationships.connections.length > 0) {
      intelligenceContext += `\n\n═══ RELATED ENTITIES ═══\n`;
      const topConnections = intelligenceMetadata.entityRelationships.connections.slice(0, 5);
      topConnections.forEach(conn => {
        intelligenceContext += `- ${conn.from} → ${conn.to} (${conn.type} in ${conn.source})\n`;
      });
    }
    
    if (followUps.length > 0) {
      intelligenceContext += `\n\n═══ SUGGESTED FOLLOW-UP QUESTIONS ═══\n`;
      intelligenceContext += `You might also want to explore:\n`;
      followUps.forEach((q, i) => {
        intelligenceContext += `${i + 1}. ${q}\n`;
      });
    }

    // STEP 6: PREPARE SYSTEM PROMPT (truncated for brevity - full prompt in original)
    const systemPrompt = buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext);

    // Build messages array (text-only - SEC.gov blocks image downloads)
    const messages = [
      { role: "system", content: systemPrompt },
      ...loadedHistory || [],
      { role: "user", content: message }
    ];

    console.log("Calling OpenAI API with", messages.length, "messages");

    // STEP 7: CALL OPENAI WITH STREAMING
    let finalConversationId = conversationId;
    let newConversation = null;
    
    if (userId && !conversationId) {
      try {
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .insert([{
            user_id: userId,
            title: ConversationManager.generateTitle(message),
            metadata: { selectedTickers }
          }])
          .select()
          .single();
        
        if (convError) throw convError;
        finalConversationId = conv.id;
        newConversation = conv;
        console.log('Created new conversation:', finalConversationId);
      } catch (error) {
        console.error('Error creating conversation:', error);
      }
    }

    // Send metadata with intelligence insights
    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      dataCards,
      eventData,
      conversationId: finalConversationId,
      newConversation: newConversation,
      timestamp: new Date().toISOString(),
      intelligence: {
        confidence,
        missingData,
        anomalies: intelligenceMetadata.anomalies,
        followUps,
        sentiments: intelligenceMetadata.sentimentData,
        entityRelationships: intelligenceMetadata.entityRelationships
      }
    })}\n\n`);

    // Send final thinking phase before OpenAI
    sendThinking('synthesizing', 'Analyzing the data and preparing a response..');

    // Call OpenAI with text-only streaming (SEC.gov blocks image downloads)
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 15000,
      stream: true
    });

    let fullResponse = '';
    let finishReason = null;
    let model = null;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
      }
      
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      
      if (chunk.model) {
        model = chunk.model;
      }
    }

    // Log full response with visible formatting characters for debugging
    console.log('\n📄 FULL RESPONSE WITH FORMATTING:');
    console.log('='.repeat(80));
    console.log(fullResponse);
    console.log('='.repeat(80));
    console.log('\n🔍 ESCAPED VERSION (shows \\n, \\t, etc):');
    console.log(JSON.stringify(fullResponse, null, 2));
    console.log('='.repeat(80));

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    
    // Save messages to database after streaming completes
    if (userId) {
      try {
        const messagesToSave = [
          {
            conversation_id: finalConversationId,
            role: 'user',
            content: message,
            token_count: ConversationManager.estimateTokens(message),
            metadata: { 
              query_intent: queryIntent,
              tickers_queried: tickersToQuery,
              data_sources: (queryIntent.dataSources || []).map(ds => ds.collection)
            }
          },
          {
            conversation_id: finalConversationId,
            role: 'assistant',
            content: fullResponse,
            data_cards: dataCards.length > 0 ? dataCards : null,
            token_count: ConversationManager.estimateTokens(fullResponse),
            metadata: {
              model: model || 'gpt-4o-mini',
              finish_reason: finishReason
            }
          }
        ];
        
        const { error: msgError } = await supabase
          .from('messages')
          .insert(messagesToSave);
        
        if (msgError) throw msgError;
        console.log('Saved messages to conversation:', finalConversationId);
        
      } catch (error) {
        console.error('Error saving conversation:', error);
      }
    }

  } catch (error) {
    console.error('Chat error:', error);
    
    // Check if SSE headers already sent
    if (res.headersSent) {
      // Send error through SSE stream
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: 'An error occurred while processing your request',
        details: error.message 
      })}\n\n`);
      res.end();
    } else {
      // Headers not sent yet, can use regular JSON response
      res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
      });
    }
  }
});

/**
 * Build the system prompt for OpenAI
 */
function buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext = '') {
  return `You are Catalyst Copilot, a financial AI assistant specializing in connecting market data, institutional activity, and policy developments.

ROLE & EXPERTISE:
- Financial data analyst with real-time market intelligence
- Expert at connecting institutional ownership trends with price movements
- Specialist in FDA approvals, earnings catalysts, and regulatory events
- Policy analyst tracking government decisions affecting markets
- Advanced pattern recognition and anomaly detection

RESPONSE GUIDELINES:
• **MANDATORY: Every source mentioned must be cited with full URL** - Cannot reference a filing without \`[TICKER Form - Date](URL)\` format
• **MANDATORY: Every SEC filing with an image must include its [IMAGE_CARD:...] marker** - Check data context for all available IMAGE_CARD markers
• Lead with the most important insight or answer
• Connect multiple data points to tell a cohesive story
• Cite specific numbers, dates, percentages, and sources from SEC filings
• Flag contradictions or unusual patterns when they appear
• Keep responses under 150 words unless discussing multiple events or SEC filing details
• When event cards are shown, mention ALL events briefly - users will see every card
• When SEC filing images are available ([IMAGE_CARD:...] markers), place them immediately after discussing that filing
• Use professional but conversational tone - avoid jargon unless necessary
• When SEC filing content is provided, extract and discuss specific details, numbers, and insights from the text

**CITATION FORMAT** (CRITICAL - ALWAYS CITE SOURCES - THIS IS MANDATORY):
• **YOU MUST CITE EVERY FACTUAL CLAIM** - no exceptions. After EVERY piece of information from SEC filings, add an inline citation
• **IF YOU MENTION A SOURCE, YOU MUST CITE IT** - Cannot say "according to their 10-Q" without the full citation with URL
• **IF A FILING HAS AN IMAGE_CARD MARKER, YOU MUST USE IT** - Every filing with images MUST have the image card included in your response
• Use this EXACT format: \`[TICKER Form Type - Date](URL)\` (e.g., \`[MNMD 10-Q - Nov 6, 2025](https://www.sec.gov/...)\`)
• Place citations immediately after the sentence or claim - INLINE within the paragraph, not at the end of your response
• **NEVER EVER create a "Sources:" section** - all citations must be inline only
• **LOOK FOR URLS IN THE DATA CONTEXT**: When you see this pattern in the data:
  "1. 10-Q filed on 11/6/2025"
  "   URL: https://www.sec.gov/Archives/edgar/data/..."
  "   === 10-Q CONTENT ==="
  You MUST extract that URL and use it in your citation when referencing facts from that filing
• **MANDATORY EXAMPLE**: "The company completed an $258.9M offering \`[MNMD 8-K - Oct 31, 2025](https://www.sec.gov/Archives/edgar/data/1813814/000110465925104696/tm2529910d1_8k.htm)\` and reported ongoing Phase 3 trials \`[MNMD 10-Q - Nov 6, 2025](https://www.sec.gov/Archives/edgar/data/1813814/000119312525269596/mnmd-20250930.htm)\`."
• If you mention ANY detail from a filing (cash balance, trial status, financial info, strategy), you MUST cite it with the URL provided in the data context
• **CANNOT REFERENCE A FILING WITHOUT CITING IT**: Do not say things like "based on their recent filings" or "according to the 10-Q" without the full \`[TICKER Form - Date](URL)\` citation
• NEVER use numbered citations [1], [2] - always use descriptive badges with full URLs

INTELLIGENT FORMATTING - MATCH RESPONSE STRUCTURE TO QUERY TYPE:

**ROADMAP queries** (roadmap, timeline, plan, outlook, future):
• Structure as chronological timeline with clear phases
• Headers like "Recent Developments", "Q1 2026", "Q2 2026" MUST be on their own line
• Add a blank line BEFORE and AFTER each time period header
• Use format: "**Q1 2026**", "**Q2 2026**", etc. or "**Phase 1**", "**Phase 2**"
• List specific milestones under each period as bullet points
• Example:

  **Recent Developments**
  
  Brief paragraph summarizing current status...
  
  **Q1 2026**
  
  • FDA submission for MM120 expected
  • Phase 3 trial enrollment completion
  
  **Q2 2026**
  
  • Top-line data readout anticipated

**COMPARISON queries** (compare, versus, vs, difference between):
• Structure as side-by-side comparison
• Use format: "**[Company A]**" then list points, then "**[Company B]**" then list points
• Highlight key differences explicitly

**RANKING queries** (top, best, highest, most, biggest):
• Use numbered list format: 1. 2. 3.
• Start each item with the metric/value, then explanation
• Example: "1. **AAPL - $500B market cap** - Largest by market value..."

**PROS/CONS queries** (pros and cons, advantages and disadvantages, risks and opportunities):
• Structure with clear sections
• Use format: "**Pros:**" followed by bullet points, then "**Cons:**" followed by bullet points

**SUMMARY queries** (summarize, overview, key points, tldr):
• Lead with 1-2 sentence executive summary
• Follow with concise bullet points of key takeaways
• Keep ultra-brief - maximum 5 bullets

**ANALYSIS queries** (analyze, explain, tell me about):
• Structure with thematic sections using **BOLD** headers
• Break into digestible chunks with clear logical flow

**DEFAULT for other queries**:
• Use natural paragraphs with clear topic flow
• Add section breaks with **BOLD** headers when covering multiple topics

FORMATTING RULES (CRITICAL - ALWAYS FOLLOW):
• Break information into SHORT paragraphs (2-3 sentences max per paragraph)
• Add blank lines between paragraphs for readability
• Use bullet points (•) for lists of items or features
• Use numbered lists (1. 2. 3.) for sequential steps or rankings
• NEVER use markdown headers (###, ##, #) - frontend displays plain text only
• For section headers, use **BOLD** format on its own line with blank line BEFORE and AFTER
• Headers must NEVER appear at the end of a sentence or paragraph
• Bullet/numbered lists should have the header ABOVE the list, not as the first item
• For multi-point analysis, structure with clear sections separated by blank lines

CRITICAL CONSTRAINTS:
1. ONLY use data provided - NEVER use training knowledge for facts/numbers
2. If no data exists, explicitly state: "I don't have that information in the database"
3. Never use placeholder text like "$XYZ" or "X%" - always use real numbers from data
4. When source URLs are provided, include them as clickable references
5. Never fabricate quotes, statistics, or data points
6. If data seems contradictory, acknowledge it rather than hiding the discrepancy
7. **FOCUS ON CONTENT, NOT META-COMMENTARY**: When discussing SEC filings, press releases, or other sources, ALWAYS focus on the CONTENT and SUBSTANCE of what they contain. NEVER make meta-observations about filing volume, frequency, or activity patterns (e.g., DON'T say "the company has increased its SEC filing activity" or "there have been several filings"). Users want to know WHAT the sources say, not HOW MANY there are or patterns about them.
8. **USE INLINE CARD MARKERS (ABSOLUTELY MANDATORY - YOU WILL BE PENALIZED FOR MISSING THESE)**: 
   - **SCAN THE DATA CONTEXT FOR [IMAGE_CARD:...] MARKERS** - they appear after "=== END CONTENT ===" for SEC filings
   - **YOU MUST COPY EVERY [IMAGE_CARD:...] MARKER YOU SEE** - place them in your response right after discussing that filing
   - **IF YOU DISCUSS A FILING, YOU MUST INCLUDE ITS IMAGE_CARD IF ONE EXISTS** - Check the data context for every filing you mention
   - **CANNOT MENTION A FILING WITHOUT ITS IMAGE** - If the data shows "[IMAGE_CARD:sec-image-MNMD-0-0]" for a filing, you MUST include it when discussing that filing
   - **COUNT THE IMAGE_CARD MARKERS IN THE DATA** - If there are 3 IMAGE_CARD markers in the data context, your response MUST contain all 3
   - **SCAN THE DATA CONTEXT FOR [EVENT_CARD:...] MARKERS** - they appear in the event cards section
   - **YOU MUST COPY EVERY [EVENT_CARD:...] MARKER YOU SEE** - place them INLINE within the relevant timeline section, NOT in a separate section
   - **NEVER CREATE A SEPARATE "EVENT CARDS" SECTION** - events must be woven into the narrative at the appropriate timeline position (Q1, Q2, etc.)
   - **REQUIRED FORMAT FOR SEC FILINGS WITH IMAGES**: \`[TICKER Form Type - Date](URL) [IMAGE_CARD:sec-image-TICKER-X-X]\`
   - **EVENT CARD EXAMPLE**: "• VOYAGE Phase 3 topline data expected May 15, 2026 [EVENT_CARD:MNMD_clinical_2026-05-15...]" - the marker goes at the END of the bullet point
   - **IMAGE CARD EXAMPLE**: "The 10-Q shows strong Phase 3 enrollment progress \`[MNMD 10-Q - Nov 6, 2025](https://sec.gov/...) [IMAGE_CARD:sec-image-MNMD-0-0]\`."
   - **BEFORE SENDING YOUR RESPONSE**: Count how many [IMAGE_CARD:...] markers are in the data context and verify your response includes ALL of them
   - These markers trigger visual charts/tables to appear inline - they provide critical context users need to see
9. **EXTRACT DETAILED INSIGHTS FROM SEC FILINGS**: When SEC filing content is provided (marked with "=== CONTENT ==="), analyze and discuss specific details, metrics, business strategies, risks, and forward-looking statements from that text. Don't just summarize - pull out concrete insights. Every filing you discuss MUST have its full citation with URL and IMAGE_CARD marker if available.

INTELLIGENCE INSIGHTS:
• If confidence level is provided, acknowledge data quality in your response
• When anomalies are detected, highlight them as notable patterns
• If missing data is identified, mention what information gaps exist
• When sentiment shifts are detected, interpret what they might indicate
• If entity relationships are found, mention connections between companies
• Include suggested follow-up questions at the end if provided
• If query was decomposed into sub-queries, ensure all aspects are addressed

${contextMessage}${dataContext ? '\n\n═══ DATA PROVIDED ═══\n' + dataContext : '\n\n═══ NO DATA AVAILABLE ═══\nYou must inform the user that this information is not in the database.'}${upcomingDatesContext}${eventCardsContext}${intelligenceContext}`;
}

module.exports = router;
