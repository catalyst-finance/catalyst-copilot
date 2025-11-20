const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://www.figma.com',
      'https://figma.com'
    ];
    
    // Allow any *.figma.site subdomain (Figma Make preview) or allowed origins
    if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.figma.site'))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Initialize services
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// MongoDB client setup
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  family: 4,
});

let mongoConnected = false;

// Connect to MongoDB
async function connectMongo() {
  if (!mongoConnected) {
    try {
      await mongoClient.connect();
      await mongoClient.db().admin().ping();
      mongoConnected = true;
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }
  return mongoClient;
}

// Data source functions
class DataConnector {
  // Supabase connector methods
  static async getStockData(symbol, dataType = 'current') {
    try {
      let query;
      
      switch (dataType) {
        case 'current':
          query = supabase
            .from('finnhub_quote_snapshots')
            .select('*')
            .eq('symbol', symbol)
            .order('timestamp', { ascending: false })
            .limit(1);
          break;
          
        case 'intraday':
          const today = new Date().toISOString().split('T')[0];
          query = supabase
            .from('intraday_prices')
            .select('*')
            .eq('symbol', symbol)
            .gte('timestamp_et', `${today}T00:00:00`)
            .lte('timestamp_et', `${today}T23:59:59`)
            .order('timestamp_et', { ascending: true })
            .limit(500);
          break;
          
        case 'daily':
          query = supabase
            .from('daily_prices')
            .select('*')
            .eq('symbol', symbol)
            .order('date', { ascending: false })
            .limit(30);
          break;
          
        default:
          throw new Error(`Unknown data type: ${dataType}`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      return {
        success: true,
        data: data || [],
        source: 'supabase',
        type: dataType
      };
    } catch (error) {
      console.error(`Error fetching ${dataType} data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        source: 'supabase',
        type: dataType
      };
    }
  }
  
  static async getEvents(filters = {}) {
    try {
      let query = supabase
        .from('event_data')
        .select('*')
        .not('title', 'is', null)
        .not('aiInsight', 'is', null);
      
      // Support both simple filters and query object
      if (filters.query) {
        // MongoDB-style query object for complex queries
        const q = filters.query;
        
        if (q.ticker) {
          if (q.ticker.$nin) {
            // NOT IN - exclude tickers
            query = query.not('ticker', 'in', `(${q.ticker.$nin.join(',')})`);
          } else if (q.ticker.$eq) {
            query = query.eq('ticker', q.ticker.$eq);
          } else {
            query = query.eq('ticker', q.ticker);
          }
        }
        
        if (q.type) {
          if (q.type.$in) {
            query = query.in('type', q.type.$in);
          } else {
            query = query.eq('type', q.type);
          }
        }
        
        if (q.actualDateTime_et) {
          if (q.actualDateTime_et.$gte) {
            query = query.gte('actualDateTime_et', q.actualDateTime_et.$gte);
          }
        }
      } else {
        // Simple filters (backward compatibility)
        if (filters.ticker) {
          query = query.eq('ticker', filters.ticker);
        }
        
        if (filters.type) {
          if (Array.isArray(filters.type)) {
            query = query.in('type', filters.type);
          } else {
            query = query.eq('type', filters.type);
          }
        }
        
        if (filters.upcoming) {
          const today = new Date().toISOString();
          query = query.gte('actualDateTime_et', today);
        }
      }
      
      // Apply sort
      if (filters.sort) {
        const sortField = Object.keys(filters.sort)[0];
        const sortDirection = filters.sort[sortField] === 1 ? 'asc' : 'desc';
        query = query.order(sortField, { ascending: sortDirection === 'asc' });
      } else if (filters.upcoming) {
        query = query.order('actualDateTime_et', { ascending: true });
      } else {
        query = query.order('actualDateTime_et', { ascending: false });
      }
      
      query = query.limit(filters.limit || 20);
      
      const { data, error } = await query;
      if (error) throw error;
      
      return {
        success: true,
        data: data || [],
        source: 'supabase',
        type: 'events'
      };
    } catch (error) {
      console.error('Error fetching events:', error);
      return {
        success: false,
        error: error.message,
        source: 'supabase',
        type: 'events'
      };
    }
  }
  
  // MongoDB connector methods
  static async getInstitutionalData(symbol) {
    try {
      await connectMongo();
      const db = mongoClient.db('raw_data');
      const collection = db.collection('institutional_ownership');
      
      // Get only the most recent record
      const data = await collection.find({
        ticker: symbol.toUpperCase()
      }).sort({ date: -1 }).limit(1).toArray();
      
      if (!data || data.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No institutional data available',
          source: 'mongodb',
          type: 'institutional'
        };
      }
      
      const doc = data[0];
      
      // Extract and summarize key information with strict token budgeting
      const summary = {
        ticker: doc.ticker,
        date: doc.date,
        ownership: {
          percentage: doc.institutional_ownership?.value || 'N/A',
          totalShares: doc.institutional_ownership?.total_institutional_shares?.shares || 'N/A',
          totalHolders: doc.institutional_ownership?.total_institutional_shares?.holders || 'N/A'
        },
        activity: {
          increased: {
            holders: doc.institutional_ownership?.increased_positions?.holders || '0',
            shares: doc.institutional_ownership?.increased_positions?.shares || '0'
          },
          decreased: {
            holders: doc.institutional_ownership?.decreased_positions?.holders || '0',
            shares: doc.institutional_ownership?.decreased_positions?.shares || '0'
          },
          held: {
            holders: doc.institutional_ownership?.held_positions?.holders || '0',
            shares: doc.institutional_ownership?.held_positions?.shares || '0'
          }
        },
        // Only top 10 institutional holders to limit tokens
        topHolders: (doc.institutional_holdings?.holders || []).slice(0, 10).map(holder => ({
          owner: holder.owner,
          shares: holder.shares,
          marketValue: holder.marketValue,
          change: holder.percent
        }))
      };
      
      return {
        success: true,
        data: [summary],
        source: 'mongodb',
        type: 'institutional'
      };
    } catch (error) {
      console.error(`Error fetching institutional data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        source: 'mongodb',
        type: 'institutional'
      };
    }
  }
  
  static async getMacroData(category = 'general', filters = {}) {
    try {
      await connectMongo();
      const db = mongoClient.db('raw_data');
      
      let collection, query = {};
      
      switch (category) {
        case 'economic':
          collection = db.collection('macro_economics');
          break;
        case 'policy':
          collection = db.collection('government_policy');
          break;
        case 'news':
          collection = db.collection('market_news');
          break;
        default:
          collection = db.collection('macro_economics');
      }
      
      // Apply filters for speaker, date, or text search
      if (filters.speaker) {
        query.$or = [
          { speaker: { $regex: filters.speaker, $options: 'i' } },
          { title: { $regex: filters.speaker, $options: 'i' } },
          { content: { $regex: filters.speaker, $options: 'i' } }
        ];
      }
      
      if (filters.date) {
        // Support date or date range filtering
        if (filters.date.$gte || filters.date.$lte) {
          query.date = filters.date;
        } else {
          query.date = filters.date;
        }
      }
      
      if (filters.textSearch) {
        query.$text = { $search: filters.textSearch };
      }
      
      // Limit to 10 recent items and only return essential fields
      const data = await collection.find(query)
        .sort({ inserted_at: -1 })
        .limit(filters.limit || 10)
        .toArray();
      
      // Summarize data to reduce token usage
      const summarized = data.map(doc => {
        // Extract only key fields, limit long text fields
        const summary = {
          date: doc.date || doc.inserted_at,
          title: doc.title || doc.headline || 'No title'
        };
        
        // Add description/summary but limit length
        if (doc.description) {
          summary.description = doc.description.substring(0, 500);
        } else if (doc.summary) {
          summary.summary = doc.summary.substring(0, 500);
        } else if (doc.content) {
          summary.content = doc.content.substring(0, 500);
        }
        
        // Build source URLs
        if (category === 'economic' && doc.url) {
          // Build tradingeconomics.com URL from relative path
          summary.source = `https://tradingeconomics.com${doc.url}`;
        } else if (category === 'policy' && doc.url) {
          // Use full URL from government_policy collection
          summary.source = doc.url;
        } else if (doc.source) {
          summary.source = doc.source;
        }
        
        return summary;
      });
      
      return {
        success: true,
        data: summarized,
        count: summarized.length,
        source: 'mongodb',
        type: `macro_${category}`
      };
    } catch (error) {
      console.error(`Error fetching macro data (${category}):`, error);
      return {
        success: false,
        error: error.message,
        source: 'mongodb',
        type: `macro_${category}`
      };
    }
  }
}

// Main AI chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], selectedTickers = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log('Processing message:', message);
    console.log('User portfolio:', selectedTickers);

    // STEP 1: AI-POWERED QUERY CLASSIFICATION
    // Use AI to understand user intent instead of complex regex patterns
    const currentDate = new Date().toISOString().split('T')[0];
    const classificationPrompt = `You are a query classifier for a financial data API. Analyze the user's question and return a JSON object with the following structure:

{
  "intent": "stock_price" | "events" | "institutional" | "macro_economic" | "government_policy" | "market_news" | "general",
  "tickers": ["TSLA", "AAPL"],  // Array of stock tickers mentioned (empty if none)
  "timeframe": "current" | "historical" | "upcoming" | "specific_date",
  "date": "YYYY-MM-DD" or null,  // Specific date if mentioned
  "dateRange": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"} or null,
  "speaker": "hassett" | "biden" | "trump" | "yellen" | "powell" | null,  // For government policy queries
  "eventTypes": ["earnings", "fda", "product", "merger", "legal", "regulatory"],  // Specific event types requested
  "scope": "focus_stocks" | "outside_focus" | "all_stocks" | "specific_tickers",
  "needsChart": true | false,  // Does user want to see price charts?
  "dataNeeded": ["stock_prices", "events", "institutional", "macro", "policy", "news"]  // What data sources to query
}

IMPORTANT: Today's date is ${currentDate}. When user says "last week", calculate the date range from 7 days ago to today.

User's portfolio: ${selectedTickers.join(', ') || 'none'}
User's question: "${message}"

Return ONLY the JSON object, no explanation.`;

    let queryIntent;
    try {
      const classificationResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: classificationPrompt }],
        temperature: 0.1,  // Low temperature for consistent classification
        max_tokens: 300
      });
      
      const classificationText = classificationResponse.choices[0].message.content.trim();
      console.log('AI Classification:', classificationText);
      
      // Parse the JSON response
      queryIntent = JSON.parse(classificationText);
      console.log('Parsed intent:', queryIntent);
      
    } catch (error) {
      console.error('Query classification failed:', error);
      // Fallback to basic classification if AI fails
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
        dataNeeded: ["stock_prices"]
      };
    }

    // STEP 2: FETCH DATA BASED ON AI CLASSIFICATION
    let dataContext = "";
    const lowerMessage = message.toLowerCase();
    
    // Determine which tickers to query based on AI classification
    let tickersToQuery = [];
    if (queryIntent.scope === 'focus_stocks' && selectedTickers.length > 0) {
      tickersToQuery = selectedTickers;
    } else if (queryIntent.scope === 'specific_tickers' && queryIntent.tickers.length > 0) {
      tickersToQuery = queryIntent.tickers;
    } else if (queryIntent.tickers.length > 0) {
      tickersToQuery = queryIntent.tickers;
    } else if (selectedTickers.length > 0) {
      tickersToQuery = selectedTickers;
    }
    
    console.log('Tickers to query:', tickersToQuery);
    console.log('Data sources needed:', queryIntent.dataNeeded);
    
    // FETCH MONGODB DATA (institutional, macro, policy, news)
    if (queryIntent.dataNeeded.includes('institutional') && tickersToQuery.length > 0) {
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
        // Use date range for "last week", "last month" type queries
        macroFilters.date = {
          $gte: queryIntent.dateRange.start,
          $lte: queryIntent.dateRange.end
        };
      }
      if (category === 'policy') macroFilters.limit = 20;
      
      console.log(`Fetching ${category} data with filters:`, macroFilters);
      
      try {
        const macroResult = await DataConnector.getMacroData(category, macroFilters);
        if (macroResult.success && macroResult.data.length > 0) {
          dataContext += `\n\n${category.charAt(0).toUpperCase() + category.slice(1)} data${queryIntent.speaker ? ` (${queryIntent.speaker})` : ''}${queryIntent.date ? ` on ${queryIntent.date}` : ''}:`;
          macroResult.data.slice(0, 5).forEach((item, i) => {
            dataContext += `\n${i + 1}. ${item.title || 'No title'}`;
            if (item.date) dataContext += ` (${item.date})`;
            if (item.source) dataContext += `\n   Source: ${item.source}`;
            if (item.description) dataContext += `\n   ${item.description}`;
            if (item.summary) dataContext += `\n   ${item.summary}`;
            if (item.content) dataContext += `\n   ${item.content}`;
          });
        } else {
          console.log(`No ${category} data found`);
        }
      } catch (error) {
        console.error(`Error fetching ${category} data:`, error);
      }
    }
    
    // FETCH SUPABASE STOCK DATA
    if (queryIntent.dataNeeded.includes('stock_prices') && tickersToQuery.length > 0) {
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            dataContext += `\n\n${ticker} Current Price: $${quote.close?.toFixed(2)}`;
            if (quote.change) dataContext += ` (${quote.change >= 0 ? '+' : ''}${quote.change?.toFixed(2)}, ${quote.change_percent?.toFixed(2)}%)`;
            if (quote.open) dataContext += `\nOpen: $${quote.open?.toFixed(2)}`;
            if (quote.high) dataContext += `, High: $${quote.high?.toFixed(2)}`;
            if (quote.low) dataContext += `, Low: $${quote.low?.toFixed(2)}`;
            if (quote.volume) dataContext += `\nVolume: ${quote.volume?.toLocaleString()}`;
          }
        } catch (error) {
          console.error(`Error fetching stock data for ${ticker}:`, error);
        }
      }
    }
    
    // FETCH EVENTS DATA
    if (queryIntent.dataNeeded.includes('events') && tickersToQuery.length > 0) {
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const eventsQuery = {
            ticker,
            title: { $ne: null },
            aiInsight: { $ne: null }
          };
          
          if (queryIntent.eventTypes && queryIntent.eventTypes.length > 0) {
            eventsQuery.type = { $in: queryIntent.eventTypes };
          }
          
          if (queryIntent.timeframe === 'upcoming') {
            eventsQuery.actualDateTime_et = { $gte: new Date().toISOString() };
          }
          
          const eventsResult = await DataConnector.getEvents({ 
            query: eventsQuery,
            limit: 5,
            sort: queryIntent.timeframe === 'upcoming' ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
          });
          
          if (eventsResult.success && eventsResult.data.length > 0) {
            dataContext += `\n\n${ticker} Events:`;
            eventsResult.data.forEach((e, i) => {
              dataContext += `\n${i + 1}. ${e.type}: ${e.title}`;
              if (e.aiInsight) dataContext += `\n   ${e.aiInsight.substring(0, 100)}...`;
            });
          }
        } catch (error) {
          console.error(`Error fetching events for ${ticker}:`, error);
        }
      }
    }

    // STEP 3: GENERATE VISUAL CARDS (EVENT CARDS, STOCK CARDS)
    // Use AI classification results instead of regex patterns
    const isEventQuery = queryIntent.intent === 'events' || queryIntent.dataNeeded.includes('events');
    const isTradingQuery = queryIntent.needsChart && queryIntent.timeframe === 'current';
    
    // Parse dates from the message (e.g., "11-13-2025", "November 13, 2025", "on 11/13/25")
    let dateFilter = null;
    const datePatterns = [
      /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/, // MM-DD-YYYY or MM/DD/YYYY
      /\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/, // YYYY-MM-DD or YYYY/MM/DD
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i // Month DD, YYYY
    ];
    
    for (const pattern of datePatterns) {
      const match = message.match(pattern);
      if (match) {
        try {
          let dateStr;
          if (pattern === datePatterns[0]) {
            // MM-DD-YYYY format
            dateStr = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
          } else if (pattern === datePatterns[1]) {
            // YYYY-MM-DD format
            dateStr = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else {
            // Month name format
            const monthMap = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
                              july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
            const month = monthMap[match[1].toLowerCase()];
            dateStr = `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
          }
          dateFilter = dateStr;
          console.log('Parsed date from message:', dateFilter);
          break;
        } catch (err) {
          console.error('Error parsing date:', err);
        }
      }
    }
    
    // Detect if MongoDB data is needed
    const needsInstitutional = /institution|institutional|holder|ownership|who owns|top.*holder|position|holdings/i.test(message);
    const needsMacro = /macro|economic|GDP|inflation|unemployment|policy|transcript|news|sentiment|trade|tariff|trump|biden|white house|fed|federal reserve|minerals|critical|china|russia|hassett|yellen|powell|discuss|said|speak|spoke|talk|statement/i.test(message);
    const needsMongoData = needsInstitutional || needsMacro;
    
    // Extract speaker names from query for government_policy searches
    let speakerQuery = null;
    const speakerPatterns = [
      /\b(hasse?tt?|kevin\s+hasse?tt?)\b/i,  // Handles Hassett, Hasset, Hassett, etc.
      /\b(biden|joe\s+biden|president\s+biden)\b/i,
      /\b(trump|donald\s+trump|president\s+trump)\b/i,
      /\b(yellen|janet\s+yellen|secretary\s+yellen)\b/i,
      /\b(powell|jerome\s+powell|chairman\s+powell|chair\s+powell)\b/i
    ];
    
    for (const pattern of speakerPatterns) {
      const match = message.match(pattern);
      if (match) {
        // Normalize speaker name for database search
        speakerQuery = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
        // Use standardized names for better matching
        if (/hasse?tt?/i.test(speakerQuery)) speakerQuery = 'hassett';
        else if (/biden/i.test(speakerQuery)) speakerQuery = 'biden';
        else if (/trump/i.test(speakerQuery)) speakerQuery = 'trump';
        else if (/yellen/i.test(speakerQuery)) speakerQuery = 'yellen';
        else if (/powell/i.test(speakerQuery)) speakerQuery = 'powell';
        
        console.log('Detected speaker query:', speakerQuery);
        break;
      }
    }
    
    // Detect which tickers are mentioned (including company names)
    const tickerMatches = message.match(/\b([A-Z]{2,5})\b/g) || [];
    // Also check for Tesla -> TSLA mapping
    let companyMapped = [];
    if (/tesla/i.test(message)) companyMapped.push('TSLA');
    if (/apple/i.test(message)) companyMapped.push('AAPL');
    if (/microsoft/i.test(message)) companyMapped.push('MSFT');
    if (/amazon/i.test(message)) companyMapped.push('AMZN');
    if (/google|alphabet/i.test(message)) companyMapped.push('GOOGL');
    if (/nvidia/i.test(message)) companyMapped.push('NVDA');
    if (/meta|facebook/i.test(message)) companyMapped.push('META');
    
    const mentionedTickers = [...new Set([...tickerMatches, ...companyMapped, ...(selectedTickers || [])])];
    
    // STEP 2: FETCH MONGODB DATA IF NEEDED (with token budgeting)
    if (needsMongoData && mentionedTickers.length > 0) {
      for (const ticker of mentionedTickers.slice(0, 3)) { // Limit to 3 tickers max
        try {
          if (needsInstitutional) {
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
          }
          
          if (needsMacro) {
            // If speaker is detected, ALWAYS use 'policy' category
            const category = speakerQuery ? 'policy' : 
                           lowerMessage.includes('policy') || lowerMessage.includes('transcript') ? 'policy' : 
                           lowerMessage.includes('news') ? 'news' : 'economic';
            
            const macroFilters = {};
            if (speakerQuery) macroFilters.speaker = speakerQuery;
            if (dateFilter) macroFilters.date = dateFilter;
            if (category === 'policy') macroFilters.limit = 20; // More results for policy searches
            
            console.log(`Fetching macro data: category=${category}, filters=`, macroFilters);
            
            const macroResult = await DataConnector.getMacroData(category, macroFilters);
            if (macroResult.success && macroResult.data.length > 0) {
              dataContext += `\n\n${category.charAt(0).toUpperCase() + category.slice(1)} data${speakerQuery ? ` (${speakerQuery})` : ''}${dateFilter ? ` on ${dateFilter}` : ''}:`;
              macroResult.data.slice(0, 5).forEach((item, i) => {
                dataContext += `\n${i + 1}. ${item.title || 'No title'}`;
                if (item.date) dataContext += ` (${item.date})`;
                if (item.source) dataContext += `\n   Source: ${item.source}`;
                if (item.description) dataContext += `\n   ${item.description}`;
                if (item.summary) dataContext += `\n   ${item.summary}`;
                if (item.content) dataContext += `\n   ${item.content}`;
              });
            } else {
              console.log(`No ${category} data found for filters:`, macroFilters);
            }
          }
        } catch (error) {
          console.error(`Error fetching MongoDB data for ${ticker}:`, error);
        }
      }
      
      // If MongoDB data was required but none found, return error
      if (needsMongoData && !dataContext) {
        console.log('MongoDB data required but none found. needsInstitutional:', needsInstitutional, 'needsMacro:', needsMacro);
        return res.status(503).json({
          error: "Unable to fetch institutional ownership and market data. Please try again or ask about stock prices instead.",
          requiresMongoDBData: true
        });
      }
    }
    
    // STEP 3: FETCH SUPABASE DATA IF NEEDED
    const needsStockData = /price|current|quote|trading|trade|traded|volume|open|close|high|low/i.test(message);
    const needsEvents = /event|earnings|FDA|approval|upcoming|launch/i.test(message);
    
    if (needsStockData && mentionedTickers.length > 0) {
      for (const ticker of mentionedTickers.slice(0, 2)) {
        try {
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            dataContext += `\n\n${ticker} Current Price: $${quote.close?.toFixed(2)}`;
            if (quote.change) dataContext += ` (${quote.change >= 0 ? '+' : ''}${quote.change?.toFixed(2)}, ${quote.change_percent?.toFixed(2)}%)`;
            if (quote.open) dataContext += `\nOpen: $${quote.open?.toFixed(2)}`;
            if (quote.high) dataContext += `, High: $${quote.high?.toFixed(2)}`;
            if (quote.low) dataContext += `, Low: $${quote.low?.toFixed(2)}`;
            if (quote.volume) dataContext += `\nVolume: ${quote.volume?.toLocaleString()}`;
          }
        } catch (error) {
          console.error(`Error fetching stock data for ${ticker}:`, error);
        }
      }
    }
    
    if (needsEvents && mentionedTickers.length > 0) {
      for (const ticker of mentionedTickers.slice(0, 2)) {
        try {
          const eventsResult = await DataConnector.getEvents({ ticker, limit: 3 });
          if (eventsResult.success && eventsResult.data.length > 0) {
            dataContext += `\n\n${ticker} Recent Events:`;
            eventsResult.data.forEach((e, i) => {
              dataContext += `\n${i + 1}. ${e.type}: ${e.title}`;
              if (e.aiInsight) dataContext += `\n   ${e.aiInsight.substring(0, 100)}...`;
            });
          }
        } catch (error) {
          console.error(`Error fetching events for ${ticker}:`, error);
        }
      }
    }

    // STEP 4: PRE-GENERATE EVENT CARDS (BEFORE AI CALL) - Like index.tsx
    const dataCards = [];
    const eventData = {}; // Store event data by ID for inline rendering
    
    // Also check conversation history for event context (follow-up questions)
    const hasEventContext = conversationHistory && conversationHistory.some(msg => 
      msg.role === 'user' && /event|earnings|FDA|approval|launch|announcement|legal|regulatory/i.test(msg.content)
    );
    
    const shouldFetchEvents = isEventQuery || hasEventContext;
    
    // Variable to store event card details for AI context
    let eventCardsContext = "";
    
    // Generate event cards if user is asking about events - DO THIS BEFORE AI CALL
    if (shouldFetchEvents) {
      const isUpcomingQuery = /coming up|upcoming|next|future|will|2026|2027/i.test(message);
      const today = new Date().toISOString();
      
      // Detect specific event types from the user's query
      const eventTypeKeywords = {
        'product': ['product', 'launch'],
        'earnings': ['earnings', 'earning'],
        'fda': ['fda', 'approval', 'drug'],
        'merger': ['merger', 'acquisition', 'M&A'],
        'conference': ['conference', 'summit'],
        'investor_day': ['investor day', 'analyst day'],
        'partnership': ['partnership', 'partner', 'collaboration'],
        'regulatory': ['regulatory', 'regulation', 'compliance', 'antitrust'],
        'guidance_update': ['guidance'],
        'capital_markets': ['capital', 'offering', 'IPO'],
        'legal': ['legal', 'lawsuit', 'litigation', 'settlement'],
        'commerce_event': ['commerce', 'retail'],
        'corporate': ['corporate'],
        'pricing': ['pricing', 'price change'],
        'defense_contract': ['defense', 'contract']
      };
      
      // Find which event types the user is asking about
      const requestedEventTypes = [];
      for (const [eventType, keywords] of Object.entries(eventTypeKeywords)) {
        for (const keyword of keywords) {
          if (lowerMessage.includes(keyword)) {
            requestedEventTypes.push(eventType);
            break; // Only add each event type once
          }
        }
      }
      console.log('Detected event types from query:', requestedEventTypes);
      
      // Detect user intent about stock scope
      const isFocusOnlyQuery = /my.*focus|my.*watchlist|my.*stock|focus.*stock|watchlist.*stock/i.test(message) && 
                                !/outside|beyond|other|different|not.*in|excluding/i.test(message);
      const isOutsideFocusQuery = /outside.*focus|beyond.*focus|other.*stock|different.*stock|not.*in.*focus|not.*focus|non-focus|excluding.*focus|outside.*watchlist|beyond.*watchlist/i.test(message);
      
      console.log('Query intent - Focus only:', isFocusOnlyQuery, 'Outside focus:', isOutsideFocusQuery);
      
      // Determine which tickers to fetch events for
      let tickersForEvents = [];
      
      if (isFocusOnlyQuery) {
        // User explicitly asking about their focus stocks only
        tickersForEvents = selectedTickers || [];
        console.log('Using focus stocks only:', tickersForEvents);
      } else if (isOutsideFocusQuery) {
        // User explicitly asking about stocks outside their focus - query database
        console.log('Querying database for stocks outside focus with requested event types:', requestedEventTypes);
        
        try {
          // Build query to find stocks with relevant events that are NOT in focus list
          const eventsQuery = { 
            ticker: { $nin: selectedTickers || [] },
            title: { $ne: null },
            aiInsight: { $ne: null }
          };
          
          // Filter by event type if specified
          if (requestedEventTypes.length > 0) {
            eventsQuery.type = { $in: requestedEventTypes };
          }
          
          // Only upcoming events
          if (isUpcomingQuery) {
            eventsQuery.actualDateTime_et = { $gte: today };
          }
          
          const eventsResult = await DataConnector.getEvents({ 
            query: eventsQuery,
            limit: 20,
            sort: isUpcomingQuery ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
          });
          
          if (eventsResult.success && eventsResult.data.length > 0) {
            // Get unique tickers from the results (3-6 stocks)
            const uniqueTickersSet = new Set();
            for (const event of eventsResult.data) {
              if (uniqueTickersSet.size >= 6) break;
              uniqueTickersSet.add(event.ticker);
            }
            tickersForEvents = Array.from(uniqueTickersSet).slice(0, 6);
            console.log('Found stocks outside focus with relevant events:', tickersForEvents);
          }
        } catch (error) {
          console.error('Error querying database for outside focus stocks:', error);
        }
      } else {
        // No explicit preference - check focus stocks first, then add relevant outside stocks
        console.log('No explicit preference - checking both focus and outside stocks');
        
        // Start with focus stocks if they have relevant events
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
        
        console.log('Focus stocks with relevant events:', focusStocksWithEvents);
        
        // Add relevant stocks outside focus (3-6 total)
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
              console.log('Added outside focus stocks:', outsideTickers);
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
      console.log('Final tickers for events:', uniqueTickers);
      console.log('Selected tickers (focus stocks):', selectedTickers);
      
      try {
        // Fetch events for the determined tickers
        const eventPromises = uniqueTickers.map(async (ticker) => {
          try {
            const eventsQuery = {
              ticker,
              title: { $ne: null },
              aiInsight: { $ne: null }
            };
            
            // Add event type filtering if specific types were requested
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
            
            console.log(`Found ${eventsResult.data?.length || 0} events for ${ticker}`);
            return eventsResult.data || [];
          } catch (error) {
            console.error(`Error fetching events for ${ticker}:`, error);
            return [];
          }
        });
        
        const allEventsArrays = await Promise.all(eventPromises);
        const allEvents = allEventsArrays.flat();
        
        // Sort events by date and take first 5
        allEvents.sort((a, b) => {
          const dateA = new Date(a.actualDateTime_et || a.actualDateTime || 0);
          const dateB = new Date(b.actualDateTime_et || b.actualDateTime || 0);
          return isUpcomingQuery ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        });
        
        const topEvents = allEvents.slice(0, 5);
        
        // Build context for AI about which event cards will be shown
        if (topEvents.length > 0) {
          eventCardsContext = `\n\n**CRITICAL - EVENT CARDS TO DISPLAY:**\nYou will be showing the following ${topEvents.length} event cards to the user. Your response MUST mention and briefly describe ALL of these events:\n\n`;
          topEvents.forEach((event, index) => {
            const eventDate = new Date(event.actualDateTime_et || event.actualDateTime).toLocaleDateString();
            eventCardsContext += `${index + 1}. ${event.ticker} - ${event.title} (${event.type}) on ${eventDate}\n   AI Insight: ${event.aiInsight}\n\n`;
          });
          eventCardsContext += `\nMake sure your response discusses ALL ${topEvents.length} events listed above. Do not omit any.`;
        }
        
        // Generate event cards
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
    
    // STEP 5: GENERATE STOCK CARDS (biggest movers, specific stock mentions, etc.)
    
    // Detect if user is asking about biggest movers / watchlist movers
    const isBiggestMoversQuery = /biggest\s+mover|top\s+mover|movers\s+in.*watchlist|watchlist.*mover/i.test(message);
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
        
        // Sort by absolute change percent to get biggest movers
        stocksData.sort((a, b) => Math.abs(b.change_percent || 0) - Math.abs(a.change_percent || 0));
        
        // Take top 3-5 movers
        const topMovers = stocksData.slice(0, Math.min(5, stocksData.length));
        
        // Fetch company names
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
        
        // Generate data cards for top movers
        for (const quote of topMovers) {
          dataCards.push({
            type: "stock",
            data: {
              ticker: quote.symbol,
              company: companyNameMap[quote.symbol] || quote.symbol,
              price: quote.close,
              change: quote.change,
              changePercent: quote.change_percent,
              chartData: [] // No chart for watchlist cards to keep it fast
            }
          });
        }
      } catch (error) {
        console.error("Error fetching watchlist movers:", error);
      }
    } else {
      // If asking about a specific stock (TSLA, AAPL, etc) or how it traded, generate a stock card with intraday chart
      const shouldShowIntradayChart = isTradingQuery || /today|intraday/i.test(message);
      
      // Check for ticker symbols (TSLA, AAPL) OR company names (Tesla, Apple, Microsoft, etc)
      let stockMention = message.match(/\b([A-Z]{2,5})\b/);
      let ticker = stockMention?.[1];
      
      // If no ticker found, search for company name in database
      if (!ticker) {
        try {
          // Extract potential company name from message (look for capitalized words)
          const potentialCompanyNames = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) || [];
          
          console.log('Searching for company names:', potentialCompanyNames);
          
          for (const companyName of potentialCompanyNames) {
            // Skip common words that aren't companies
            const skipWords = ['How', 'Did', 'What', 'When', 'Where', 'Why', 'Who', 'The', 'Today', 'Yesterday'];
            if (skipWords.includes(companyName)) {
              console.log(`Skipping common word: ${companyName}`);
              continue;
            }
            
            // Query company_information table for matching name
            const { data, error } = await supabase
              .from('company_information')
              .select('symbol, name')
              .ilike('name', `%${companyName}%`)
              .limit(1)
              .single();
            
            console.log(`Company search for "${companyName}":`, data);
            
            if (data) {
              ticker = data.symbol;
              console.log(`Found ticker ${ticker} for company name: ${companyName}`);
              break; // Found a match, stop searching
            }
          }
        } catch (error) {
          console.error('Error looking up company name:', error);
        }
      }
      
      console.log('Stock card logic - ticker:', ticker, 'shouldShowChart:', shouldShowIntradayChart);
      
      if (ticker && shouldShowIntradayChart) {
        try {
          // Fetch current price
          console.log(`Fetching quote for ${ticker}`);
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            
            // Fetch company name
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
            
            // Check if intraday data exists
            const intradayResult = await DataConnector.getStockData(ticker, 'intraday');
            const hasIntradayData = intradayResult.success && intradayResult.data.length > 0;
            const intradayCount = intradayResult.data?.length || 0;
            
            console.log(`Intraday data available for ${ticker}: ${intradayCount} points`);
            console.log(`Pushing stock card for ${ticker} with${hasIntradayData ? '' : 'out'} intraday chart`);
            
            dataCards.push({
              type: "stock",
              data: {
                ticker: quote.symbol,
                company: companyName,
                price: quote.close,
                change: quote.change,
                changePercent: quote.change_percent,
                // Send metadata for frontend to fetch chart data
                chartMetadata: hasIntradayData ? {
                  available: true,
                  count: intradayCount,
                  date: new Date().toISOString().split('T')[0],
                  // Frontend should fetch intraday data via separate API call
                  needsFetch: true
                } : null
              }
            });
            
            // Add stock card data to AI context
            dataContext += `\n\n**STOCK CARD DATA FOR ${ticker}:**
- Current Price: $${quote.close.toFixed(2)}
- Change: ${quote.change >= 0 ? '+' : ''}$${quote.change.toFixed(2)} (${quote.change_percent >= 0 ? '+' : ''}${quote.change_percent.toFixed(2)}%)
- Day High: $${quote.high?.toFixed(2) || 'N/A'}
- Day Low: $${quote.low?.toFixed(2) || 'N/A'}
- Previous Close: $${quote.previous_close?.toFixed(2) || 'N/A'}
- Intraday Chart: ${hasIntradayData ? `${intradayCount} price points available` : 'No intraday data available'}

**IMPORTANT: Use this exact price data in your response. Do not use any other price information.**`;
          } else {
            console.log(`No quote data found for ${ticker}`);
          }
        } catch (error) {
          console.error("Error fetching stock data:", error);
        }
      }
    }

    // STEP 6: BUILD CONTEXT MESSAGE
    const contextMessage = selectedTickers.length > 0 
      ? `The user is tracking: ${selectedTickers.join(', ')}.`
      : '';

    // STEP 7: PREPARE MESSAGES FOR OPENAI (like index.tsx)
    const messages = [
      {
        role: "system",
        content: `You are Catalyst Copilot, an AI assistant for Catalyst mobile app.

You have access to real-time stock data from Supabase including:
- Current prices and price changes (finnhub_quote_snapshots table)
- Intraday price data (intraday_prices table)
- Historical daily prices (daily_prices table)
- Market events like earnings, FDA approvals, product launches, legal, regulatory, investor day, etc. (event_data table)
- Company information (company_information table)

You also have access to MongoDB data including:
- Institutional ownership data (who owns stocks, position changes, top holders)
- Macro economic indicators (GDP, inflation, unemployment, trade data)
- Government policy transcripts (White House briefings, Fed announcements, congressional hearings)
- Market news and sentiment (global markets, economic trends, country-specific news)

When asked about institutional ownership, reference:
- Percentage of institutional ownership
- Increased/decreased position amounts and percentages, and when (number of holders and shares)
- Top institutional holders

When asked about government policy or macro trends, reference:
- Recent policy announcements and transcripts
- Economic indicators by country
- Market sentiment and news
- Trade, tariff, and regulatory developments

You have access to data for ALL publicly traded stocks, not just the user's watchlist.

When answering questions:
1. Be concise and data-driven - USE THE ACTUAL DATA PROVIDED
2. Reference specific price movements and percentages FROM THE DATA
3. Mention relevant upcoming events FROM THE DATA
4. Use a professional but approachable tone
5. NEVER use placeholder text like $XYZ or % XYZ - always use the real numbers provided
6. When users ask about specific event types (e.g., "legal events", "FDA approvals", "earnings"), ONLY discuss events of that type. Do not mention other event types unless they are directly relevant to the question.
7. **CRITICAL: When event cards are being generated for the user, you MUST mention and briefly describe ALL events that will be shown in the event cards. Do not pick and choose - list every single event. The user will see all the event cards, so your text response should reference all of them.**
8. When institutional or macro data is available, integrate it naturally into your analysis.

CRITICAL RULES:
1. ONLY use data provided below - NEVER use your training data
2. If no data is provided, say "I don't have that information in the database"
3. Be concise - max 3-4 sentences unless discussing multiple event cards
4. Always cite the data source (e.g., "According to the latest data...")
5. When source URLs are provided, include them in your response as clickable references
6. Never make up quotes, statistics, or information

${contextMessage}${dataContext ? '\n\nDATA PROVIDED:\n' + dataContext : '\n\nNO DATA AVAILABLE - You must say you cannot find this information in the database.'}${eventCardsContext}`
      },
      ...conversationHistory || [],
      {
        role: "user", 
        content: message
      }
    ];

    console.log("Calling OpenAI API with", messages.length, "messages");

    // STEP 8: CALL OPENAI (NO FUNCTION CALLING - data already fetched)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cheaper and faster
      messages,
      temperature: 0.7,
      max_tokens: 1000 // Strict 1000 token budget for response
    });

    const assistantMessage = completion.choices[0].message;

    res.json({
      response: assistantMessage.content,
      dataCards,
      eventData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    mongodb: mongoConnected,
    timestamp: new Date().toISOString()
  });
});

// Initialize and start server
async function start() {
  try {
    // Connect to MongoDB on startup
    await connectMongo();
    
    app.listen(port, () => {
      console.log(`🚀 Catalyst AI Agent running on port ${port}`);
      console.log(`📊 Connected to Supabase: ${!!process.env.SUPABASE_URL}`);
      console.log(`🗄️  Connected to MongoDB: ${mongoConnected}`);
      console.log(`🤖 OpenAI API configured: ${!!process.env.OPENAI_API_KEY}`);
    });
  } catch (error) {
    console.error('Failed to start agent:', error);
    process.exit(1);
  }
}

start();