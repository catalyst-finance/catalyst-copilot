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
  origin: ['https://www.figma.com', 'https://figma.com'],
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
      
      const data = await collection.find({
        ticker: symbol.toUpperCase()
      }).sort({ date: -1 }).limit(10).toArray();
      
      return {
        success: true,
        data: data || [],
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
      
      const data = await collection.find(query)
        .sort({ inserted_at: -1 })
        .limit(20)
        .toArray();
      
      return {
        success: true,
        data: data || [],
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

// AI Agent with function calling
const tools = [
  {
    type: "function",
    function: {
      name: "get_stock_data",
      description: "Get stock price data from Supabase",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, TSLA)"
          },
          dataType: {
            type: "string",
            enum: ["current", "intraday", "daily"],
            description: "Type of data to fetch"
          }
        },
        required: ["symbol"]
      }
    }
  },
  {
    type: "function", 
    function: {
      name: "get_events",
      description: "Get market events and earnings from Supabase",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "Stock ticker to filter events for"
          },
          type: {
            type: "array",
            items: { type: "string" },
            description: "Event types to filter (earnings, fda, merger, etc.)"
          },
          upcoming: {
            type: "boolean",
            description: "Whether to get upcoming events (true) or past events (false)"
          },
          limit: {
            type: "number",
            description: "Number of events to return"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_institutional_data", 
      description: "Get institutional ownership data from MongoDB",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol"
          }
        },
        required: ["symbol"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_macro_data",
      description: "Get macro economic data, policy info, or market news from MongoDB",
      parameters: {
        type: "object", 
        properties: {
          category: {
            type: "string",
            enum: ["economic", "policy", "news"],
            description: "Type of macro data to fetch"
          }
        }
      }
    }
  }
];

// Function execution handler
async function executeFunction(name, args) {
  switch (name) {
    case 'get_stock_data':
      return await DataConnector.getStockData(args.symbol, args.dataType);
    case 'get_events':
      return await DataConnector.getEvents(args);
    case 'get_institutional_data':
      return await DataConnector.getInstitutionalData(args.symbol);
    case 'get_macro_data':
      return await DataConnector.getMacroData(args.category);
    default:
      throw new Error(`Unknown function: ${name}`);
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

    // Build context about user's portfolio
    const contextMessage = selectedTickers.length > 0 
      ? `The user is currently tracking these stocks: ${selectedTickers.join(', ')}.`
      : 'The user has not specified any stocks they are tracking.';

    // Prepare conversation for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Catalyst Copilot, an advanced AI assistant for a financial investment app. You help users understand stocks, market events, and make informed investment decisions.

You have access to multiple data sources through function calls:

SUPABASE DATA (Stock & Events):
- Current stock prices and quotes
- Intraday trading data
- Historical daily prices  
- Market events (earnings, FDA approvals, mergers, conferences, etc.)
- Company information

MONGODB DATA (Institutional & Macro):
- Institutional ownership data (who owns stocks, position changes)
- Macro economic indicators (GDP, inflation, unemployment)
- Government policy transcripts (Fed announcements, White House briefings)
- Market news and sentiment analysis

CAPABILITIES:
- Answer questions about any publicly traded stock
- Provide institutional ownership analysis
- Explain market events and their potential impact
- Discuss macro economic trends and policy implications
- Analyze trading patterns and price movements

GUIDELINES:
1. Always use function calls to get real data - never make up numbers
2. Be concise but comprehensive in your analysis
3. Reference specific data points with exact numbers and dates
4. Explain complex financial concepts in accessible terms
5. When discussing events, mention both the event details and AI insights about impact
6. For institutional data, highlight ownership percentages and recent changes
7. Connect macro trends to their potential market implications

${contextMessage}`
      },
      ...conversationHistory,
      {
        role: "user", 
        content: message
      }
    ];

    // Call OpenAI with function calling
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1500
    });

    let assistantMessage = completion.choices[0].message;
    const functionCalls = assistantMessage.tool_calls || [];

    // Execute function calls
    if (functionCalls.length > 0) {
      const functionResults = [];
      
      for (const call of functionCalls) {
        try {
          const args = JSON.parse(call.function.arguments);
          const result = await executeFunction(call.function.name, args);
          
          functionResults.push({
            tool_call_id: call.id,
            role: "tool",
            content: JSON.stringify(result)
          });
        } catch (error) {
          functionResults.push({
            tool_call_id: call.id, 
            role: "tool",
            content: JSON.stringify({ 
              success: false, 
              error: error.message 
            })
          });
        }
      }

      // Get final response with function results
      const finalCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          ...messages,
          assistantMessage,
          ...functionResults
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      assistantMessage = finalCompletion.choices[0].message;
    }

    res.json({
      response: assistantMessage.content,
      functionCalls: functionCalls.length,
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