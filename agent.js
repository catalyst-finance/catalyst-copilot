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
      // HARDCODED SUPABASE SCHEMAS:
      //
      // finnhub_quote_snapshots (current quotes):
      //   - symbol, timestamp, timestamp_et, market_date
      //   - close, change, change_percent, high, low, open, previous_close, volume
      //
      // intraday_prices (tick-by-tick):
      //   - symbol, timestamp, timestamp_et
      //   - price, volume
      //   - Most granular, use for detailed intraday charts
      //
      // one_minute_prices (1-min bars):
      //   - symbol, timestamp, timestamp_et
      //   - open, high, low, close, volume
      //
      // five_minute_prices (5-min bars):
      //   - symbol, timestamp, timestamp_et
      //   - open, high, low, close, volume
      //
      // hourly_prices (hourly bars):
      //   - symbol, timestamp, timestamp_et  
      //   - open, high, low, close, volume
      //
      // daily_prices (daily bars):
      //   - symbol, date, date_et
      //   - open, high, low, close, volume
      
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
          // Use intraday_prices for tick-by-tick data
          // Query using timestamp_et (already in ET timezone)
          // Use Eastern Time (UTC-5) for market hours
          const targetDate = new Date();
          const etOffset = -5 * 60; // Eastern Time offset in minutes
          const etDate = new Date(targetDate.getTime() + (etOffset + targetDate.getTimezoneOffset()) * 60000);
          
          // Format as YYYY-MM-DD for timestamp_et column
          const dateStr = etDate.toISOString().split('T')[0];
          
          console.log(`Querying intraday_prices for ${symbol} on ${dateStr}`);
          
          // Fetch FULL day (00:00:00 to 23:59:59) to ensure we get all available data
          // Use limit=5000 to capture entire trading day of high-frequency data
          query = supabase
            .from('intraday_prices')
            .select('timestamp_et, price, volume')
            .eq('symbol', symbol)
            .gte('timestamp_et', `${dateStr}T00:00:00`)
            .lte('timestamp_et', `${dateStr}T23:59:59`)
            .order('timestamp_et', { ascending: true })
            .limit(5000);
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
      
      // HARDCODED SCHEMAS:
      // macro_economics collection:
      //   - date (string): "2025-11-14T21:22:56.16"
      //   - title (string): "Ibovespa Closes Near Record High"
      //   - description (string): Long text content
      //   - url (string): "/brazil/stock-market"
      //   - author (string): "Felipe Alarcon"
      //   - country (string): "Brazil"
      //   - category (string): "Stock Market"
      //   - importance (number): 1
      //   - inserted_at (date object)
      //
      // government_policy collection:
      //   - date (string): "2025-11-13" (just date, no time)
      //   - url (string): Full URL to transcript
      //   - title (string): "Press Briefing: Kevin Hassett Speaks..."
      //   - participants (array): ["Kevin Hassett", "Question"]
      //   - turns (array): [{ speaker: "Question", text: "..." }]
      
      let collection;
      const query = {};
      const andConditions = [];
      
      // Choose collection based on category
      if (category === 'policy') {
        collection = db.collection('government_policy');
        
        // For policy: search in title, participants, and turn text
        // IMPORTANT: government_policy schema has:
        //   - participants: array of strings ["Kevin Hassett", "Question"]
        //   - turns: array of { speaker: "Kevin Hassett", text: "..." }
        // When searching for "trump", we need to find Trump administration officials
        // like Kevin Hassett speaking at Trump White House briefings
        
        if (filters.speaker) {
          // For Trump queries: match Trump directly OR Trump administration context
          if (filters.speaker.toLowerCase() === 'trump') {
            andConditions.push({
              $or: [
                { title: { $regex: 'trump', $options: 'i' } },
                { participants: { $elemMatch: { $regex: 'hassett|trump', $options: 'i' } } }
              ]
            });
          } else {
            // For other speakers: search normally
            andConditions.push({
              $or: [
                { title: { $regex: filters.speaker, $options: 'i' } },
                { participants: { $regex: filters.speaker, $options: 'i' } }
              ]
            });
          }
        }
        
        if (filters.textSearch) {
          // Split multi-word searches into individual terms
          const searchTerms = filters.textSearch.toLowerCase().split(/\s+/).filter(term => 
            term.length > 2 && !['the', 'and', 'for', 'with', 'from', 'about'].includes(term)
          );
          
          if (searchTerms.length > 0) {
            // For each term, create an $or condition across title and turns.text
            // Then combine all terms with $and to require ALL terms to be present
            const termConditions = searchTerms.map(term => ({
              $or: [
                { title: { $regex: term, $options: 'i' } },
                { 'turns.text': { $regex: term, $options: 'i' } }
              ]
            }));
            
            // Add all term conditions to the main AND array
            andConditions.push(...termConditions);
          }
        }
      } else {
        // For economic and news: use macro_economics collection
        collection = db.collection('macro_economics');
        
        // For macro_economics: search in title, description, country, author, category
        if (filters.textSearch) {
          // Split multi-word searches into individual terms
          const searchTerms = filters.textSearch.toLowerCase().split(/\s+/).filter(term => 
            term.length > 2 && !['the', 'and', 'for', 'with', 'from', 'about'].includes(term)
          );
          
          if (searchTerms.length > 0) {
            // For each term, create an $or condition across all searchable fields
            // Then combine all terms with $and to require ALL terms to be present
            const termConditions = searchTerms.map(term => ({
              $or: [
                { title: { $regex: term, $options: 'i' } },
                { description: { $regex: term, $options: 'i' } },
                { country: { $regex: term, $options: 'i' } },
                { author: { $regex: term, $options: 'i' } },
                { category: { $regex: term, $options: 'i' } }
              ]
            }));
            
            // Add all term conditions to the main AND array
            andConditions.push(...termConditions);
          }
        }
      }
      
      if (andConditions.length > 0) {
        query.$and = andConditions;
      }
      
      if (filters.date) {
        // Handle date filtering based on collection schema
        if (category === 'policy') {
          // government_policy: date is simple "2025-11-13" format
          if (filters.date.$gte || filters.date.$lte) {
            if (filters.date.$gte) {
              andConditions.push({ date: { $gte: filters.date.$gte } });
            }
            if (filters.date.$lte) {
              andConditions.push({ date: { $lte: filters.date.$lte } });
            }
          } else {
            andConditions.push({ date: filters.date });
          }
        } else {
          // macro_economics: date is "2025-11-14T21:22:56.16" format
          if (filters.date.$gte || filters.date.$lte) {
            if (filters.date.$gte) {
              const startDateTime = filters.date.$gte + "T00:00:00";
              andConditions.push({ date: { $gte: startDateTime } });
            }
            if (filters.date.$lte) {
              const endDate = new Date(filters.date.$lte);
              endDate.setDate(endDate.getDate() + 1);
              const endDateTime = endDate.toISOString().split('T')[0] + "T00:00:00";
              andConditions.push({ date: { $lt: endDateTime } });
            }
          } else {
            const dateStr = filters.date;
            const startDateTime = dateStr + "T00:00:00";
            const endDate = new Date(dateStr);
            endDate.setDate(endDate.getDate() + 1);
            const endDateTime = endDate.toISOString().split('T')[0] + "T00:00:00";
            andConditions.push({
              date: {
                $gte: startDateTime,
                $lt: endDateTime
              }
            });
          }
        }
      }
      
      // Limit to 10 recent items and only return essential fields
      const data = await collection.find(query)
        .sort({ inserted_at: -1 })
        .limit(filters.limit || 10)
        .toArray();
      
      console.log(`MongoDB query for ${category}:`, JSON.stringify(query, null, 2));
      console.log(`MongoDB results: ${data.length} documents found`);
      
      // Summarize data to reduce token usage - handle different schemas
      const summarized = data.map(doc => {
        const summary = {
          date: doc.date || doc.inserted_at,
          title: doc.title || 'No title'
        };
        
        if (category === 'policy') {
          // government_policy schema
          if (doc.url) summary.source = doc.url;
          if (doc.participants) summary.participants = doc.participants.join(', ');
          
          // Extract key quotes from turns (limit to 3 most relevant)
          if (doc.turns && doc.turns.length > 0) {
            // For policy documents, extract turns that contain the search terms
            let relevantTurns = doc.turns;
            
            // If there's a textSearch, find turns containing those terms
            if (filters.textSearch) {
              const searchTerms = filters.textSearch.toLowerCase().split(/\s+/);
              relevantTurns = doc.turns.filter(turn => {
                const turnText = turn.text.toLowerCase();
                // Check if turn contains ANY of the search terms
                return searchTerms.some(term => turnText.includes(term));
              });
            }
            
            // If speaker filter is specified and it's not Trump, filter by speaker
            // (Skip speaker filter for Trump since he doesn't speak in these transcripts)
            if (filters.speaker && filters.speaker.toLowerCase() !== 'trump') {
              relevantTurns = relevantTurns.filter(turn => 
                turn.speaker.toLowerCase().includes(filters.speaker.toLowerCase())
              );
            }
            
            // Take first 3 relevant turns
            relevantTurns = relevantTurns.slice(0, 3);
            
            summary.quotes = relevantTurns.map(turn => 
              `${turn.speaker}: ${turn.text.substring(0, 300)}...`
            );
          }
        } else {
          // macro_economics schema
          if (doc.description) {
            summary.description = doc.description.substring(0, 500);
          }
          if (doc.country) summary.country = doc.country;
          if (doc.author) summary.author = doc.author;
          if (doc.category) summary.category = doc.category;
          
          // Build tradingeconomics.com URL from relative path
          if (doc.url) {
            summary.source = `https://tradingeconomics.com${doc.url}`;
          }
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
  "needsChart": true | false,  // Set to true if user asks about intraday trading, today's price action, or wants to see price movement
  "dataNeeded": ["stock_prices", "events", "institutional", "macro", "policy", "news"]  // What data sources to query
}

IMPORTANT: Set needsChart=true when user asks "How did [stock] trade today?" or similar intraday questions.

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
    
    // Determine which tickers to query based on AI classification
    // ONLY populate tickers for stock-related queries (not for macro/policy/news)
    let tickersToQuery = [];
    const isStockQuery = queryIntent.dataNeeded.includes('stock_prices') || 
                         queryIntent.dataNeeded.includes('institutional') || 
                         queryIntent.dataNeeded.includes('events');
    
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
      
      // Extract keywords from message for text search (e.g., "Brazil", "South Korea", "batteries", "tariffs")
      // This helps find relevant content beyond just speaker/date filters
      const commonWords = new Set(['what', 'when', 'where', 'how', 'did', 'does', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'about', 'happened', 'happen', 'say', 'said', 'discuss', 'discussed', 'talk', 'talked', 'stock', 'market', 'markets', 'last', 'week', 'weeks', 'month', 'months', 'year', 'years', 'today', 'yesterday', 'recently', 'current', 'currently', 'press', 'with', 'from', 'that', 'this', 'have', 'were', 'been', 'trump', 'biden', 'hassett', 'yellen', 'powell', 'past', 'future', 'ago']);
      const words = message.toLowerCase()
        .replace(/[^a-z\s]/g, ' ')  // Remove all non-letter characters except spaces
        .split(/\s+/)
        .filter(word => 
          word.length > 3 && 
          !commonWords.has(word) && 
          !selectedTickers.some(t => word === t.toLowerCase())
        );
      
      // If we have meaningful keywords, add them as a text search
      // Example: "What did Trump say about South Korea and batteries?" → textSearch: "south korea batteries"
      if (words.length > 0) {
        macroFilters.textSearch = words.join(' ');
      }
      
      console.log(`Fetching ${category} data with filters:`, macroFilters);
      
      try {
        const macroResult = await DataConnector.getMacroData(category, macroFilters);
        if (macroResult.success && macroResult.data.length > 0) {
          dataContext += `\n\n${category.charAt(0).toUpperCase() + category.slice(1)} data${queryIntent.speaker ? ` (${queryIntent.speaker})` : ''}${queryIntent.date ? ` on ${queryIntent.date}` : ''}:`;
          macroResult.data.slice(0, 5).forEach((item, i) => {
            dataContext += `\n${i + 1}. ${item.title || 'No title'}`;
            if (item.date) dataContext += ` (${item.date})`;
            if (item.source) dataContext += `\n   Source: ${item.source}`;
            if (item.participants) dataContext += `\n   Participants: ${item.participants}`;
            if (item.description) dataContext += `\n   ${item.description}`;
            if (item.summary) dataContext += `\n   ${item.summary}`;
            if (item.content) dataContext += `\n   ${item.content}`;
            // Add quotes for policy documents
            if (item.quotes && item.quotes.length > 0) {
              dataContext += `\n   Key Quotes:`;
              item.quotes.forEach(quote => {
                dataContext += `\n   - ${quote}`;
              });
            }
          });
        } else {
          console.log(`No ${category} data found`);
          // Tell AI that no data was found so it can inform the user
          dataContext += `\n\nNO ${category.toUpperCase()} DATA FOUND for the requested query${queryIntent.speaker ? ` about ${queryIntent.speaker}` : ''}${queryIntent.dateRange ? ` from ${queryIntent.dateRange.start} to ${queryIntent.dateRange.end}` : ''}. The database does not contain matching information.`;
        }
      } catch (error) {
        console.error(`Error fetching ${category} data:`, error);
        dataContext += `\n\nERROR fetching ${category} data: ${error.message}`;
      }
    }
    
    // Stock prices will be fetched during card generation (STEP 5) to avoid duplication
    
    // Events will be fetched during card generation (STEP 4) to avoid duplication

    // STEP 3: PRE-GENERATE EVENT CARDS (BEFORE AI CALL)
    const dataCards = [];
    const eventData = {}; // Store event data by ID for inline rendering
    
    // Also check conversation history for event context (follow-up questions)
    const hasEventContext = conversationHistory && conversationHistory.some(msg => 
      msg.role === 'user' && /event|earnings|FDA|approval|launch|announcement|legal|regulatory/i.test(msg.content)
    );
    
    const shouldFetchEvents = queryIntent.dataNeeded.includes('events') || hasEventContext;
    
    // Variable to store event card details for AI context
    let eventCardsContext = "";
    
    // Generate event cards if user is asking about events - DO THIS BEFORE AI CALL
    if (shouldFetchEvents) {
      const isUpcomingQuery = queryIntent.timeframe === 'upcoming';
      const today = new Date().toISOString();
      
      // Use AI-detected event types instead of regex keyword matching
      const requestedEventTypes = queryIntent.eventTypes || [];
      console.log('AI-detected event types:', requestedEventTypes);
      
      // Use AI classification scope instead of regex detection
      const isFocusOnlyQuery = queryIntent.scope === 'focus_stocks';
      const isOutsideFocusQuery = queryIntent.scope === 'outside_focus';
      
      console.log('AI-classified scope - Focus only:', isFocusOnlyQuery, 'Outside focus:', isOutsideFocusQuery);
      
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
    
    // STEP 4: GENERATE STOCK CARDS (biggest movers, specific stock mentions, etc.)
    
    // Use AI intent to detect movers query
    const isBiggestMoversQuery = queryIntent.intent === 'stock_price' && queryIntent.scope === 'focus_stocks' && /mover/i.test(message);
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
      // Use AI-detected tickers instead of regex parsing
      const shouldShowIntradayChart = queryIntent.needsChart;
      const ticker = queryIntent.tickers && queryIntent.tickers.length > 0 ? queryIntent.tickers[0] : null;
      
      console.log('Stock card logic - AI detected ticker:', ticker, 'needsChart:', shouldShowIntradayChart);
      
      // Fetch stock data if ticker is mentioned and user is asking about stock prices
      if (ticker && (shouldShowIntradayChart || queryIntent.intent === 'stock_price')) {
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
            
            // Check if intraday data exists and format it for the frontend
            const intradayResult = await DataConnector.getStockData(ticker, 'intraday');
            const hasIntradayData = intradayResult.success && intradayResult.data.length > 0;
            const intradayCount = intradayResult.data?.length || 0;
            
            console.log(`Intraday query for ${ticker}: ${hasIntradayData ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Intraday data points for ${ticker}: ${intradayCount}`);
            if (intradayCount > 0) {
              console.log(`First data point:`, JSON.stringify(intradayResult.data[0]));
              console.log(`Last data point:`, JSON.stringify(intradayResult.data[intradayCount - 1]));
            }
            
            console.log(`Pushing stock card for ${ticker} with${hasIntradayData ? '' : 'out'} intraday chart`);
            
            // Format intraday data for frontend chart rendering
            let chartData = null;
            if (hasIntradayData) {
              chartData = intradayResult.data.map(point => {
                // timestamp_et from intraday_prices is already in ET timezone as a timestamp string
                // Convert to Unix milliseconds for chart
                const timestamp = new Date(point.timestamp_et).getTime();
                
                return {
                  timestamp: timestamp,
                  price: point.price,  // intraday_prices uses 'price' field
                  volume: point.volume || 0
                };
              });
              
              console.log(`Chart data prepared: ${chartData.length} points`);
              console.log(`First chart point timestamp: ${chartData[0].timestamp} (${new Date(chartData[0].timestamp).toISOString()})`);
              console.log(`Last chart point timestamp: ${chartData[chartData.length - 1].timestamp} (${new Date(chartData[chartData.length - 1].timestamp).toISOString()})`);
            }
            
            dataCards.push({
              type: "stock",
              data: {
                ticker: quote.symbol,
                company: companyName,
                price: quote.close,
                change: quote.change,
                changePercent: quote.change_percent,
                // Send actual chart data instead of metadata
                chartData: chartData,
                // Include opening price for context
                open: quote.open,
                high: quote.high,
                low: quote.low,
                previousClose: quote.previous_close
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

    // STEP 5: BUILD CONTEXT MESSAGE
    const contextMessage = selectedTickers.length > 0 
      ? `The user is tracking: ${selectedTickers.join(', ')}.`
      : '';

    // STEP 6: PREPARE MESSAGES FOR OPENAI
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

    // STEP 7: CALL OPENAI
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