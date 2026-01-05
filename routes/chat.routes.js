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
    sendThinking('analyzing', 'Reading your question and understanding what you need...');
    const currentDate = new Date().toISOString().split('T')[0];
    const classificationPrompt = `You are a query classifier for a financial data API. Analyze the user's question and return a JSON object with the following structure:

{
  "intent": "stock_price" | "events" | "institutional" | "sec_filings" | "macro_economic" | "government_policy" | "market_news" | "future_outlook" | "general",
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
  "topicKeywords": ["batteries", "tariffs", "South Korea"],
  "dataNeeded": ["stock_prices", "events", "institutional", "sec_filings", "macro", "policy", "news"]
}

IMPORTANT: Today's date is ${currentDate}. 
- When user says "last week", calculate the date range from 7 days ago to today.
- When user says "past year" or "last year", calculate the date range from 365 days ago to today.
- When user says "past 6 months", calculate from 180 days ago to today.
- When user says "past 3 months" or "this quarter", calculate from 90 days ago to today.

User's portfolio: ${selectedTickers.join(', ') || 'none'}
User's question: "${message}"

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
        dataNeeded: ["stock_prices"]
      };
    }

    // STEP 2: FETCH DATA BASED ON AI CLASSIFICATION
    let dataContext = "";
    const dataCards = [];
    const eventData = {};
    
    // Determine which tickers to query
    let tickersToQuery = [];
    const isStockQuery = queryIntent.dataNeeded.includes('stock_prices') || 
                         queryIntent.dataNeeded.includes('institutional') || 
                         queryIntent.dataNeeded.includes('events') ||
                         queryIntent.dataNeeded.includes('sec_filings');
    
    if (isStockQuery) {
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
    console.log('Data sources needed:', queryIntent.dataNeeded);
    
    // Send data gathering update
    const dataSourceMap = {
      'stock_prices': 'stock prices',
      'events': 'upcoming events',
      'institutional': 'institutional ownership',
      'sec_filings': 'SEC filings',
      'macro': 'economic data',
      'policy': 'government policy',
      'news': 'market news'
    };
    
    const friendlyDataSources = queryIntent.dataNeeded
      .map(source => dataSourceMap[source] || source)
      .join(', ');
    
    const tickerList = tickersToQuery.length > 0 
      ? tickersToQuery.join(', ')
      : 'market-wide data';
    
    sendThinking('retrieving', `Gathering ${friendlyDataSources} for ${tickerList}...`);
    
    // FETCH INSTITUTIONAL DATA
    if (queryIntent.dataNeeded.includes('institutional') && tickersToQuery.length > 0) {
      sendThinking('retrieving', `Looking up institutional ownership data...`);
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const instResult = await DataConnector.getInstitutionalData(ticker);
          if (instResult.success && instResult.data.length > 0) {
            const summary = instResult.data[0];
            dataContext += `\n\n${ticker} Institutional Ownership (${summary.date}):
- Total Ownership: ${summary.ownership.percentage}
- Total Shares: ${summary.ownership.totalShares}
- Number of Holders: ${summary.ownership.totalHolders}
- Increased Positions: ${summary.activity.increased.holders} holders, ${summary.activity.increased.shares} shares
- Decreased Positions: ${summary.activity.decreased.holders} holders, ${summary.activity.decreased.shares} shares

Top Holders:`;
            summary.topHolders.slice(0, 5).forEach((h, i) => {
              dataContext += `\n${i + 1}. ${h.owner}: ${h.shares} shares (${h.change})`;
            });
          }
        } catch (error) {
          console.error(`Error fetching institutional data for ${ticker}:`, error);
        }
      }
    }
    
    // FETCH SEC FILINGS DATA
    if (queryIntent.dataNeeded.includes('sec_filings') && tickersToQuery.length > 0) {
      sendThinking('retrieving', `Searching SEC filings database...`);
      const formTypes = queryIntent.formTypes && queryIntent.formTypes.length > 0 ? queryIntent.formTypes : null;
      const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
      const dateRange = queryIntent.dateRange || null;
      
      let uniqueKeywords = [];
      
      if (needsDeepAnalysis) {
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
      
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const secResult = await DataConnector.getSecFilings(ticker, formTypes, dateRange, needsDeepAnalysis ? 50 : 10);
          if (secResult.success && secResult.data.length > 0) {
            
            const substantiveTypes = ['10-K', '10-Q', '8-K', 'S-1', '10-K/A', '10-Q/A', '8-K/A', 'DEF 14A', '424B'];
            const substantiveFilings = secResult.data.filter(f => substantiveTypes.some(t => f.form_type?.includes(t)));
            const routineFilings = secResult.data.filter(f => !substantiveTypes.some(t => f.form_type?.includes(t)));
            
            console.log(`Found ${substantiveFilings.length} substantive filings and ${routineFilings.length} routine filings for ${ticker}`);
            
            dataContext += `\n\n${ticker} SEC Filings Analysis:\n`;
            
            if (needsDeepAnalysis && substantiveFilings.length > 0) {
              dataContext += `\n--- SUBSTANTIVE FILINGS (10-K, 10-Q, 8-K) ---\n`;
              
              const substantiveToAnalyze = substantiveFilings.slice(0, 3);
              
              for (let i = 0; i < substantiveToAnalyze.length; i++) {
                const filing = substantiveToAnalyze[i];
                const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                const reportDate = filing.report_date ? ` (Period: ${filing.report_date})` : '';
                const size = filing.file_size || 'N/A';
                const enrichedIndicator = filing.enriched ? ' ✓' : '';
                
                dataContext += `${i + 1}. ${filing.form_type}${enrichedIndicator} filed on ${date}${reportDate} (${size})\n`;
                dataContext += `   URL: ${filing.url}\n`;
                
                if (filing.enriched && filing.summary) {
                  const shortSummary = filing.summary.length > 300 ? filing.summary.substring(0, 300) + '...' : filing.summary;
                  dataContext += `   Summary: ${shortSummary}\n`;
                }
                
                if (filing.url) {
                  console.log(`Fetching content for ${filing.form_type} filing (${date})...`);
                  const contentResult = await DataConnector.fetchSecFilingContent(
                    filing.url, 
                    uniqueKeywords, 
                    25000
                  );
                  
                  if (contentResult.success && contentResult.content) {
                    dataContext += `\n   === ${filing.form_type} FILING CONTENT ${contentResult.keywordMatches ? '(Keyword-Focused)' : ''} ===\n${contentResult.content}\n   === END ${filing.form_type} CONTENT ===\n`;
                    
                    if (contentResult.images && contentResult.images.length > 0) {
                      dataContext += `\n   === IMAGES/CHARTS IN THIS FILING ===\n`;
                      contentResult.images.slice(0, 5).forEach((img, idx) => {
                        dataContext += `   ${idx + 1}. ${img.alt || 'Chart/Diagram'}: ${img.url}\n`;
                        if (img.context) {
                          dataContext += `      Context: ${img.context}...\n`;
                        }
                      });
                      dataContext += `   === END IMAGES ===\n\n`;
                      
                      contentResult.images.slice(0, 5).forEach((img, idx) => {
                        dataCards.push({
                          type: 'image',
                          id: `sec-image-${ticker}-${filing.accession_number}-${idx}`,
                          ticker: ticker,
                          source: 'sec_filing',
                          title: img.alt || 'Chart/Diagram from SEC Filing',
                          imageUrl: img.url,
                          context: img.context || null,
                          filingType: filing.form_type,
                          filingDate: filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date,
                          filingUrl: filing.url
                        });
                      });
                    }
                  } else {
                    dataContext += `   (Unable to fetch filing content: ${contentResult.error})\n\n`;
                  }
                }
              }
            }
            
            if (routineFilings.length > 0) {
              dataContext += `\n--- RECENT ROUTINE FILINGS (Form 4, etc.) ---\n`;
              const routineToShow = routineFilings.slice(0, 5);
              
              for (let i = 0; i < routineToShow.length; i++) {
                const filing = routineToShow[i];
                const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                dataContext += `${i + 1}. ${filing.form_type} filed on ${date} - ${filing.url}\n`;
              }
            }
            
            if (!needsDeepAnalysis || substantiveFilings.length === 0) {
              const filingsToShow = secResult.data.slice(0, 5);
              
              for (let i = 0; i < filingsToShow.length; i++) {
                const filing = filingsToShow[i];
                const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
                const reportDate = filing.report_date ? ` (Period: ${filing.report_date})` : '';
                const size = filing.file_size || 'N/A';
                
                dataContext += `${i + 1}. ${filing.form_type} filed on ${date}${reportDate} (${size})\n`;
                dataContext += `   URL: ${filing.url}\n`;
              }
            }
            
          } else if (secResult.message) {
            dataContext += `\n\n${secResult.message}`;
          }
        } catch (error) {
          console.error(`Error fetching SEC filings for ${ticker}:`, error);
        }
      }
    }
    
    // FETCH MACRO/POLICY/NEWS DATA
    if (queryIntent.dataNeeded.includes('macro') || queryIntent.dataNeeded.includes('policy') || queryIntent.dataNeeded.includes('news')) {
      let category = 'economic';
      if (queryIntent.intent === 'government_policy' || queryIntent.speaker) {
        category = 'policy';
      } else if (queryIntent.dataNeeded.includes('news')) {
        category = 'news';
      } else if (queryIntent.dataNeeded.includes('macro')) {
        category = 'economic';
      }
      
      const macroFilters = {};
      if (queryIntent.speaker) macroFilters.speaker = queryIntent.speaker;
      if (queryIntent.date) {
        macroFilters.date = queryIntent.date;
      } else if (queryIntent.dateRange) {
        macroFilters.date = {
          $gte: queryIntent.dateRange.start,
          $lte: queryIntent.dateRange.end
        };
      }
      if (category === 'policy') macroFilters.limit = 50;
      
      if (queryIntent.topicKeywords && queryIntent.topicKeywords.length > 0) {
        macroFilters.textSearch = queryIntent.topicKeywords.join(' ');
        console.log('Using AI-extracted topic keywords for search:', queryIntent.topicKeywords);
      }
      
      console.log(`Fetching ${category} data with filters:`, macroFilters);
      
      try {
        const macroResult = await DataConnector.getMacroData(category, macroFilters);
        if (macroResult.success && macroResult.data.length > 0) {
          dataContext += `\n\n${category.charAt(0).toUpperCase() + category.slice(1)} data${queryIntent.speaker ? ` (${queryIntent.speaker})` : ''}${queryIntent.date ? ` on ${queryIntent.date}` : ''}:`;
          dataContext += `\n\nFound ${macroResult.data.length} relevant ${category} documents. Showing top 10:\n`;
          macroResult.data.slice(0, 10).forEach((item, i) => {
            dataContext += `\n━━━ DOCUMENT ${i + 1} ━━━`;
            dataContext += `\n${item.title || 'No title'}`;
            if (item.date) dataContext += ` (${item.date})`;
            if (item.source) dataContext += `\n📄 Source: ${item.source}`;
            if (item.participants) dataContext += `\n👥 Participants: ${item.participants}`;
            if (item.description) dataContext += `\n\n📝 ${item.description}`;
            if (item.summary) dataContext += `\n\n📝 ${item.summary}`;
            if (item.content) dataContext += `\n\n📝 ${item.content}`;
            if (item.quotes && item.quotes.length > 0) {
              dataContext += `\n\n💬 KEY QUOTES FROM THIS BRIEFING:`;
              item.quotes.forEach((quote, qIdx) => {
                dataContext += `\n\n   Quote ${qIdx + 1}: ${quote}`;
              });
            }
            dataContext += `\n`;
          });
        } else {
          console.log(`No ${category} data found`);
          dataContext += `\n\nNO ${category.toUpperCase()} DATA FOUND for the requested query${queryIntent.speaker ? ` about ${queryIntent.speaker}` : ''}${queryIntent.dateRange ? ` from ${queryIntent.dateRange.start} to ${queryIntent.dateRange.end}` : ''}. The database does not contain matching information.`;
        }
      } catch (error) {
        console.error(`Error fetching ${category} data:`, error);
        dataContext += `\n\nERROR fetching ${category} data: ${error.message}`;
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
    
    const shouldFetchEvents = queryIntent.dataNeeded.includes('events') || hasEventContext;
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
    sendThinking('synthesizing', 'Analyzing the data and preparing your answer...');

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 5000,
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
              data_sources: queryIntent.dataNeeded
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
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
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

RESPONSE GUIDELINES:
• Lead with the most important insight or answer
• Connect multiple data points to tell a cohesive story
• Cite specific numbers, dates, percentages, and sources
• Flag contradictions or unusual patterns when they appear
• Keep responses under 150 words unless discussing multiple events
• When event cards are shown, mention ALL events briefly - users will see every card
• Use professional but conversational tone - avoid jargon unless necessary

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
