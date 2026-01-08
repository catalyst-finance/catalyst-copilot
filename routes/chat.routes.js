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
const QueryEngine = require('../services/QueryEngine');
const ResponseEngine = require('../services/ResponseEngine');
const { processOpenAIStream } = require('../services/StreamProcessor');
const { optionalAuth } = require('../middleware/auth');
const { buildSystemPrompt } = require('../config/prompts/system-prompt');

const { allocateTokenBudget, getTokenBudget, getTierInfo, estimateCost } = require('../config/token-allocation');

// Main AI chat endpoint
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { 
      message, 
      conversationId = null, 
      conversationHistory = [],
      timezone = 'America/New_York' // Default to ET if not provided
    } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user?.userId || null;

    console.log('Processing message:', message);
    console.log('User ID:', userId);
    console.log('Conversation ID:', conversationId);
    console.log('User Timezone:', timezone);
    
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

    // ===== AI-NATIVE QUERY ENGINE =====
    console.log('🤖 Using AI-Native Query Engine...');
    
    let queryIntent;
    let queryResults = [];
    
    try {
      // AI generates the queries directly (with contextual thinking messages)
      const queryPlan = await QueryEngine.generateQueries(
        message, 
        [],
        sendThinking,  // Pass thinking function for context-aware messages
        timezone       // Pass user's timezone for accurate date interpretation
      );
      console.log('📋 Query Plan:', JSON.stringify(queryPlan, null, 2));
      
      // AI-driven token allocation
      const tokenAllocation = await allocateTokenBudget(queryPlan, message);
      
      // Execute the AI-generated queries
      queryResults = await QueryEngine.executeQueries(queryPlan, DataConnector);
      console.log(`✅ Retrieved data from ${queryResults.length} source(s)`);
      
      // Store intent for later use
      queryIntent = {
        intent: queryPlan.intent,
        extractCompaniesFromTranscripts: queryPlan.extractCompanies,
        needsChart: queryPlan.needsChart,
        needsDeepAnalysis: queryPlan.needsDeepAnalysis || false,
        analysisKeywords: queryPlan.analysisKeywords || [],
        tickers: queryPlan.tickers || [],
        queries: queryPlan.queries,
        chartConfig: queryPlan.chartConfig || null,  // Pass chartConfig for VIEW_CHART marker
        tokenAllocation: tokenAllocation  // AI-allocated token budgets
      };
      
    } catch (error) {
      console.error('❌ AI Query Engine failed:', error);
      // Fallback to empty results
      queryIntent = { intent: 'general', tickers: [] };
      queryResults = [];
    }

    // STEP 2: BUILD DATA CONTEXT FROM RESULTS
    
    let dataContext = "";
    const dataCards = [];
    const eventData = {};
    let upcomingDatesContext = "";
    let responseStyleGuidelines = null;  // AI-recommended response style
    
    // Intelligence metadata tracking
    let intelligenceMetadata = {
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
    
    // Convert AI query results to data context
    if (queryResults.length > 0) {
      console.log('📝 Building data context from AI query results...');
      
      try {
        // AI generates intelligent formatting plan (with contextual thinking messages)
        const formattingPlan = await ResponseEngine.generateFormattingPlan(
          queryResults,
          message,
          queryIntent,
          sendThinking  // Pass thinking function for context-aware messages
        );
        
        // Execute the AI-generated formatting plan
        const formatted = await ResponseEngine.executeFormattingPlan(
          formattingPlan,
          queryResults,
          DataConnector,
          sendThinking,
          queryIntent  // Pass query intent with analysisKeywords for smart filtering
        );
        
        dataContext = formatted.dataContext;
        dataCards.push(...formatted.dataCards);
        intelligenceMetadata = { ...intelligenceMetadata, ...formatted.intelligenceMetadata };
        
        // Add VIEW_CHART markers if chartConfig is present and pre-fetch chart data
        if (queryIntent.chartConfig) {
          dataContext = await ResponseEngine.addChartMarkers(dataContext, queryIntent, dataCards, DataConnector);
          console.log(`📈 Added chart marker for ${queryIntent.chartConfig.symbol}`);
        }
        
        // Store AI-recommended response style (already includes universal formatting rules)
        if (formattingPlan.responseStyle) {
          responseStyleGuidelines = formattingPlan.responseStyle;
          console.log('📐 Response Style:', responseStyleGuidelines.format, '-', responseStyleGuidelines.tone);
        }
        
        console.log(`✅ AI formatting complete - ${intelligenceMetadata.totalSources} sources`);
      } catch (error) {
        console.error('❌ AI formatting failed:', error);
        // Continue with empty context - system will inform user no data available
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
      
      // Use AI to determine which tickers to fetch events for (replaces 135 lines of hardcoded logic)
      let tickersForEvents = [];
      
      try {
        const tickerSelectionPrompt = `You are an intelligent ticker selection system. Determine which stock tickers should have their events fetched.

User Query: "${message}"
Specific Tickers Mentioned: ${queryIntent.tickers.length > 0 ? queryIntent.tickers.join(', ') : 'none'}
Event Types Requested: ${queryIntent.eventTypes.length > 0 ? queryIntent.eventTypes.join(', ') : 'all types'}

Task: Return a list of stock tickers (max 6) that should have their events fetched. Rules:
1. If specific tickers are mentioned in the query → use ONLY those tickers (e.g., "What is MNMD's roadmap?" → ["MNMD"])
2. For broad market queries → suggest the most relevant tickers based on query topic and context
3. Maximum 6 tickers total

Return JSON only: {"tickers": ["AAPL", "TSLA"], "reasoning": "brief explanation"}`;


        const tickerSelectionResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: tickerSelectionPrompt }],
          temperature: 0.2,
          max_tokens: 300,
          response_format: { type: "json_object" }
        });
        
        const tickerSelection = JSON.parse(tickerSelectionResponse.choices[0].message.content.trim());
        tickersForEvents = tickerSelection.tickers || [];
        
        if (tickersForEvents.length > 0) {
          console.log(`🎯 AI selected tickers for events: ${tickersForEvents.join(', ')} - ${tickerSelection.reasoning}`);
        } else {
          // Fallback: use first ticker from query
          tickersForEvents = queryIntent.tickers.slice(0, 6);
          console.log(`⚠️ AI returned no tickers, using fallback: ${tickersForEvents.join(', ')}`);
        }
      } catch (error) {
        console.error('Error in AI ticker selection:', error);
        // Fallback logic if AI fails - use tickers from query intent
        if (queryIntent.tickers.length > 0) {
          tickersForEvents = queryIntent.tickers.slice(0, 6);
        } else {
          tickersForEvents = [];
        }
        console.log(`⚠️ Fallback ticker selection: ${tickersForEvents.join(', ')}`);
      }
      
      const uniqueTickers = [...new Set(tickersForEvents)].slice(0, 6);
      
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
    
    if (isBiggestMoversQuery && queryIntent.tickers && queryIntent.tickers.length > 0) {
      try {
        const stockDataPromises = queryIntent.tickers.map(async (ticker) => {
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
          dataContext += `\n\n=== BIGGEST MOVERS (TOP ${topMovers.length}) ===\n`;
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
        console.error("Error fetching biggest movers:", error);
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
    const contextMessage = '';

    // STEP 5.5: INTELLIGENT ANALYSIS
    // DISABLED: IntelligenceEngine features currently disabled to avoid noise and limitations
    // Can be re-enabled when more sophisticated analysis is implemented
    
    /*
    // Multi-step query decomposition
    const subQueries = IntelligenceEngine.decomposeComplexQuery(message, queryIntent);
    if (subQueries.length > 0) {
      console.log('🧩 Complex Query Decomposed:', subQueries);
    }
    
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
    */
    
    // Simplified: Use empty placeholders for disabled intelligence features
    const missingData = [];
    const followUps = [];
    
    // Add intelligence insights to context
    let intelligenceContext = '';
    
    /*
    /*
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
    */

    // STEP 6: PREPARE SYSTEM PROMPT (truncated for brevity - full prompt in original)
    const systemPrompt = buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext, responseStyleGuidelines);

    // Debug: Check if VIEW_ARTICLE markers are in dataContext
    const viewArticleMatches = (dataContext.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
    if (viewArticleMatches.length > 0) {
      console.log(`🖼️  Data context contains ${viewArticleMatches.length} VIEW_ARTICLE markers:`, viewArticleMatches);
    }

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
            metadata: {}
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

    // Send metadata (intelligence features disabled)
    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      dataCards,
      eventData,
      conversationId: finalConversationId,
      newConversation: newConversation,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Call OpenAI with text-only streaming (SEC.gov blocks image downloads)
    // Use AI-allocated token budget
    const allocation = queryIntent.tokenAllocation || { responseTokens: 8000, planTokens: 1500, queryTokens: 1500, tier: 'standard' };
    const tokenBudget = getTokenBudget(allocation, 'response');
    const tierInfo = getTierInfo(allocation);
    const costEstimate = estimateCost(allocation, messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0));
    
    console.log(`💰 Response Budget: ${allocation.tier.toUpperCase()} tier (${tokenBudget} tokens, ~$${costEstimate.totalCost})`);
    
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_completion_tokens: tokenBudget,  // Use max_completion_tokens with dynamic allocation
      stream: true
    });

    // Use StreamProcessor to emit structured block events instead of raw content
    // This parses markers backend-side so frontend receives clean events:
    // - text_delta: Plain text content
    // - chart_block: { symbol, timeRange }
    // - article_block: { cardId }
    // - image_block: { cardId }
    // - event_block: { cardId }
    const { fullResponse, finishReason, model } = await processOpenAIStream(stream, res, dataCards);

    // Log full response for debugging
    console.log('\n📄 FULL RESPONSE (streamed as structured blocks):');
    console.log('='.repeat(80));
    console.log(fullResponse.substring(0, 500) + (fullResponse.length > 500 ? '...' : ''));
    console.log('='.repeat(80));
    
    // Debug: Check if GPT-4 preserved VIEW_ARTICLE markers
    const responseViewArticleMatches = (fullResponse.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
    if (viewArticleMatches.length > 0) {
      if (responseViewArticleMatches.length === 0) {
        console.log(`⚠️  WARNING: Data had ${viewArticleMatches.length} VIEW_ARTICLE markers but GPT-4 response has 0!`);
      } else if (responseViewArticleMatches.length < viewArticleMatches.length) {
        console.log(`⚠️  WARNING: Data had ${viewArticleMatches.length} VIEW_ARTICLE markers but GPT-4 only kept ${responseViewArticleMatches.length}`);
      } else {
        console.log(`✅ GPT-4 preserved all ${responseViewArticleMatches.length} VIEW_ARTICLE markers`);
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
              tickers_queried: queryIntent.tickers || [],
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

// buildSystemPrompt is now imported from config/prompts/system-prompt.js

module.exports = router;