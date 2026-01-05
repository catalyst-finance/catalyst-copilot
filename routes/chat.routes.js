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
  "scope": "focus_stocks" | "outside_focus" | "all_stocks" | "specific_tickers",
  "needsChart": true | false,
  "isFutureOutlook": true | false,
  "needsDeepAnalysis": true | false,
  "isBiggestMoversQuery": true | false,
  "topicKeywords": ["batteries", "tariffs", "South Korea"]
}

ROUTING INTELLIGENCE:
- Earnings questions → event_data (Supabase) + sec_filings (MongoDB 10-Q, 8-K)
- FDA/regulatory → event_data + sec_filings (8-K, S-1)
- Ownership/investors → institutional_ownership (MongoDB)
- Government policy/tariffs → government_policy (MongoDB)
- Economic indicators → macro_economics (MongoDB)
- Insider trading → sec_filings (MongoDB, Form 4)
- Business updates → sec_filings (10-K, 10-Q for detailed info)
- Stock price movements → finnhub_quote_snapshots or intraday_prices
- Political statements → government_policy

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
                // Process SEC filings...
                dataContext += `\n\n${ticker} SEC Filings (${secResult.data.length} found):\n`;
                secResult.data.slice(0, 5).forEach((filing, i) => {
                  const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                  dataContext += `${i + 1}. ${filing.form_type} (${date}): ${filing.url}\n`;
                });
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
      const isUpcomingQuery = queryIntent.timeframe === 'upcoming';
      const today = new Date().toISOString();
      const requestedEventTypes = queryIntent.eventTypes || [];
      const isFocusOnlyQuery = queryIntent.scope === 'focus_stocks';
      const isOutsideFocusQuery = queryIntent.scope === 'outside_focus';
      
      let tickersForEvents = [];
      
      if (isFocusOnlyQuery) {
        tickersForEvents = selectedTickers || [];
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
          eventCardsContext = `\n\n**CRITICAL - EVENT CARDS TO DISPLAY:**\nYou will be showing the following ${topEvents.length} event cards to the user. Your response MUST mention and briefly describe ALL of these events:\n\n`;
          topEvents.forEach((event, index) => {
            const eventDate = new Date(event.actualDateTime_et || event.actualDateTime).toLocaleDateString();
            eventCardsContext += `${index + 1}. ${event.ticker} - ${event.title} (${event.type}) on ${eventDate}\n   AI Insight: ${event.aiInsight}\n\n`;
          });
          eventCardsContext += `\nMake sure your response discusses ALL ${topEvents.length} events listed above. Do not omit any.`;
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
      const shouldShowIntradayChart = queryIntent.needsChart;
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

    // STEP 6: PREPARE SYSTEM PROMPT (truncated for brevity - full prompt in original)
    const systemPrompt = buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext);

    // Extract image URLs for vision analysis
    const imageCards = dataCards.filter(card => card.type === 'image');
    const hasImages = imageCards.length > 0;

    // Build messages array with vision support
    const messages = [
      { role: "system", content: systemPrompt },
      ...loadedHistory || []
    ];

    // Add user message with images for vision analysis
    if (hasImages) {
      sendThinking('synthesizing', `Preparing visual analysis of ${imageCards.length} chart(s)/diagram(s)...`);
      const userContent = [
        { type: "text", text: message }
      ];
      
      // Add up to 3 images for vision analysis (to stay within limits)
      imageCards.slice(0, 3).forEach(card => {
        userContent.push({
          type: "image_url",
          image_url: {
            url: card.data.imageUrl,
            detail: "high" // Use high detail for better analysis
          }
        });
      });
      
      messages.push({ role: "user", content: userContent });
      
      console.log(`📸 Including ${imageCards.slice(0, 3).length} images for visual analysis`);
    } else {
      messages.push({ role: "user", content: message });
    }

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

    // Send metadata
    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      dataCards,
      eventData,
      conversationId: finalConversationId,
      newConversation: newConversation,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Send final thinking phase before OpenAI
    sendThinking('synthesizing', hasImages ? 'Analyzing charts and data visually...' : 'Analyzing the data and preparing your answer...');

    let stream;
    let useImages = hasImages;
    
    try {
      stream = await openai.chat.completions.create({
        model: useImages ? "gpt-4o" : "gpt-4o-mini", // Use gpt-4o for vision, gpt-4o-mini otherwise
        messages,
        temperature: 0.7,
        max_tokens: 10000,
        stream: true
      });
    } catch (imageError) {
      // If image download fails, retry without images
      if (imageError.code === 'invalid_image_url' && useImages) {
        console.log('⚠️ Image download failed, retrying without images:', imageError.message);
        sendThinking('synthesizing', 'Image unavailable, analyzing text content...');
        
        // Rebuild messages without images
        const textOnlyMessages = [
          { role: "system", content: systemPrompt },
          ...loadedHistory || [],
          { role: "user", content: message }
        ];
        
        stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: textOnlyMessages,
          temperature: 0.7,
          max_tokens: 10000,
          stream: true
        });
        
        useImages = false;
      } else {
        throw imageError; // Re-throw if it's not an image error
      }
    }

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
function buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext) {
  return `You are Catalyst Copilot, a financial AI assistant specializing in connecting market data, institutional activity, and policy developments.

ROLE & EXPERTISE:
- Financial data analyst with real-time market intelligence
- Expert at connecting institutional ownership trends with price movements
- Specialist in FDA approvals, earnings catalysts, and regulatory events
- Policy analyst tracking government decisions affecting markets
- **Vision-enabled analyst**: Can analyze charts, tables, and diagrams from SEC filings

VISUAL ANALYSIS GUIDELINES (when images are provided):
• Carefully examine any charts, tables, or diagrams shown
• Extract key data points, trends, and patterns from visual elements
• Describe what the images show in specific detail (e.g., "The pipeline chart shows 3 Phase 3 trials")
• Integrate visual insights with text data to provide comprehensive analysis
• Call out important visual information that enhances understanding
• If tables show numerical data, reference specific figures

RESPONSE GUIDELINES:
• Lead with the most important insight or answer
• Connect multiple data points to tell a cohesive story
• Cite specific numbers, dates, percentages, and sources
• Flag contradictions or unusual patterns when they appear
• Keep responses under 150 words unless discussing multiple events
• When event cards are shown, mention ALL events briefly - users will see every card
• Use professional but conversational tone - avoid jargon unless necessary

**CITATION FORMAT** (CRITICAL - ALWAYS CITE SOURCES):
• After EVERY factual claim, add inline citations using this EXACT format: \`[Source Name]\`
• Place citations immediately after the sentence or claim they support
• Use specific source names from the data provided (e.g., "Mind Medicine 10-Q", "MNMD 8-K", "SEC Filing", "Institutional Data")
• For SEC filings: Use format \`[TICKER Form Type - Date]\` (e.g., \`[MNMD 10-Q - Nov 6, 2025]\`)
• Multiple claims from same source need only one citation at the end of that paragraph
• Example: "The company reported $15M in cash reserves and three Phase 3 trials underway \`[MNMD 10-Q - Nov 6, 2025]\`. Their pipeline focuses on GAD treatment with MM120 ODT \`[MNMD 8-K - Oct 31, 2025]\`."

INTELLIGENT FORMATTING - MATCH RESPONSE STRUCTURE TO QUERY TYPE:

**ROADMAP queries** (roadmap, timeline, plan, outlook, future):
• Structure as chronological timeline with clear phases
• Use format: "**Q1 2026**", "**Q2 2026**", etc. or "**Phase 1**", "**Phase 2**"
• List specific milestones under each period
• Example:
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
• For section headers, use **BOLD** format on its own line with blank line after
• Bullet/numbered lists should have the header ABOVE the list, not as the first item
• For multi-point analysis, structure with clear sections

CRITICAL CONSTRAINTS:
1. ONLY use data provided - NEVER use training knowledge for facts/numbers
2. If no data exists, explicitly state: "I don't have that information in the database"
3. Never use placeholder text like "$XYZ" or "X%" - always use real numbers from data
4. When source URLs are provided, include them as clickable references
5. Never fabricate quotes, statistics, or data points
6. If data seems contradictory, acknowledge it rather than hiding the discrepancy

${contextMessage}${dataContext ? '\n\n═══ DATA PROVIDED ═══\n' + dataContext : '\n\n═══ NO DATA AVAILABLE ═══\nYou must inform the user that this information is not in the database.'}${upcomingDatesContext}${eventCardsContext}`;
}

module.exports = router;
