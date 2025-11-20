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
      
      // Apply filters
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
  
  static async getMacroData(category = 'general') {
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
      
      // Limit to 10 recent items and only return essential fields
      const data = await collection.find(query)
        .sort({ inserted_at: -1 })
        .limit(10)
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
        
        // Add source if available
        if (doc.source) summary.source = doc.source;
        
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

    // STEP 1: DETECT QUERY TYPE AND FETCH DATA FIRST (like index.tsx pattern)
    let dataContext = "";
    const lowerMessage = message.toLowerCase();
    
    // Detect if MongoDB data is needed
    const needsInstitutional = /institution|institutional|holder|ownership|who owns|top.*holder|position|holdings/i.test(message);
    const needsMacro = /macro|economic|GDP|inflation|unemployment|policy|transcript|news|sentiment|trade|tariff|trump|biden|white house|fed|federal reserve|minerals|critical|china|russia/i.test(message);
    const needsMongoData = needsInstitutional || needsMacro;
    
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
            const category = lowerMessage.includes('policy') ? 'policy' : 
                           lowerMessage.includes('news') ? 'news' : 'economic';
            const macroResult = await DataConnector.getMacroData(category);
            if (macroResult.success && macroResult.data.length > 0) {
              dataContext += `\n\nRecent ${category} data:`;
              macroResult.data.slice(0, 3).forEach((item, i) => {
                dataContext += `\n${i + 1}. ${item.title}`;
                if (item.description) dataContext += `\n   ${item.description}`;
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching MongoDB data for ${ticker}:`, error);
        }
      }
      
      // If MongoDB data was required but none found, return error
      if (needsMongoData && !dataContext) {
        return res.json({
          error: "Unable to fetch institutional ownership and market data. Please try again or ask about stock prices instead.",
          requiresMongoDBData: true
        }, 503);
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

    // STEP 4: BUILD CONTEXT MESSAGE
    const contextMessage = selectedTickers.length > 0 
      ? `The user is tracking: ${selectedTickers.join(', ')}.`
      : '';

    // STEP 5: PREPARE MESSAGES FOR OPENAI (like index.tsx)
    const messages = [
      {
        role: "system",
        content: `You are Catalyst Copilot, an AI assistant for Catalyst mobile app.

CRITICAL RULES:
1. ONLY use data provided below - NEVER use your training data
2. If no data is provided, say "I don't have that information in the database"
3. Be concise - max 3-4 sentences
4. Always cite the data source (e.g., "According to the latest data...")
5. Never make up quotes, statistics, or information

${contextMessage}${dataContext ? '\n\nDATA PROVIDED:\n' + dataContext : '\n\nNO DATA AVAILABLE - You must say you cannot find this information in the database.'}`
      },
      ...conversationHistory || [],
      {
        role: "user", 
        content: message
      }
    ];

    // STEP 6: CALL OPENAI (NO FUNCTION CALLING - data already fetched)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cheaper and faster
      messages,
      temperature: 0.7,
      max_tokens: 1000 // Strict 1000 token budget for response
    });

    const assistantMessage = completion.choices[0].message;

    res.json({
      response: assistantMessage.content,
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