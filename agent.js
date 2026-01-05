const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
        type: dataType
      };
    } catch (error) {
      console.error(`Error fetching ${dataType} data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
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
        type: 'events'
      };
    } catch (error) {
      console.error('Error fetching events:', error);
      return {
        success: false,
        error: error.message,
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
        type: 'institutional'
      };
    } catch (error) {
      console.error(`Error fetching institutional data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        type: 'institutional'
      };
    }
  }
  
  static async getVolumeData(symbol, timeframe = 'current') {
    try {
      let query;
      let volumeData = { totalVolume: 0, volumeProfile: [] };
      
      switch (timeframe) {
        case 'intraday':
        case 'today':
          // Aggregate volume from intraday_prices for complete intraday picture
          const targetDate = new Date();
          const etOffset = -5 * 60;
          const etDate = new Date(targetDate.getTime() + (etOffset + targetDate.getTimezoneOffset()) * 60000);
          const dateStr = etDate.toISOString().split('T')[0];
          
          query = supabase
            .from('intraday_prices')
            .select('timestamp_et, volume')
            .eq('symbol', symbol)
            .gte('timestamp_et', `${dateStr}T00:00:00`)
            .lte('timestamp_et', `${dateStr}T23:59:59`)
            .order('timestamp_et', { ascending: true });
          
          const { data: intradayData, error: intradayError } = await query;
          if (intradayError) throw intradayError;
          
          if (intradayData && intradayData.length > 0) {
            volumeData.totalVolume = intradayData.reduce((sum, point) => sum + (point.volume || 0), 0);
            volumeData.volumeProfile = intradayData;
            volumeData.dataPoints = intradayData.length;
          }
          break;
          
        case 'current':
          // Get from finnhub_quote_snapshots for daily summary
          query = supabase
            .from('finnhub_quote_snapshots')
            .select('volume')
            .eq('symbol', symbol)
            .order('timestamp', { ascending: false })
            .limit(1);
          
          const { data: currentData, error: currentError } = await query;
          if (currentError) throw currentError;
          
          if (currentData && currentData.length > 0) {
            volumeData.totalVolume = currentData[0].volume || 0;
          }
          break;
      }
      
      return {
        success: true,
        data: volumeData,
        type: 'volume'
      };
    } catch (error) {
      console.error(`Error fetching volume data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        type: 'volume'
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
      
      // Limit to 30 recent items for comprehensive policy coverage (10 for other categories)
      const defaultLimit = category === 'policy' ? 30 : 10;
      const data = await collection.find(query)
        .sort({ inserted_at: -1 })
        .limit(filters.limit || defaultLimit)
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
          
          // Extract key quotes from turns (limit to 8 most relevant for comprehensive coverage)
          if (doc.turns && doc.turns.length > 0) {
            // For policy documents, extract turns that contain the search terms
            let relevantTurns = doc.turns;
            
            // If there's a textSearch, find turns containing those terms
            if (filters.textSearch) {
              const searchTerms = filters.textSearch.toLowerCase().split(/\s+/);
              
              // Score turns by how many search terms they contain
              const scoredTurns = doc.turns.map(turn => {
                const turnText = turn.text.toLowerCase();
                const score = searchTerms.filter(term => turnText.includes(term)).length;
                return { turn, score };
              }).filter(item => item.score > 0);
              
              // Sort by score (most relevant first)
              scoredTurns.sort((a, b) => b.score - a.score);
              relevantTurns = scoredTurns.map(item => item.turn);
            }
            
            // If speaker filter is specified and it's not Trump, filter by speaker
            // (Skip speaker filter for Trump since he doesn't speak in these transcripts)
            if (filters.speaker && filters.speaker.toLowerCase() !== 'trump') {
              relevantTurns = relevantTurns.filter(turn => 
                turn.speaker.toLowerCase().includes(filters.speaker.toLowerCase())
              );
            }
            
            // Take first 8 relevant turns for comprehensive coverage
            relevantTurns = relevantTurns.slice(0, 8);
            
            // Include FULL text (up to 1000 chars) instead of truncating at 300
            summary.quotes = relevantTurns.map(turn => {
              const fullText = turn.text.length > 1000 
                ? turn.text.substring(0, 1000) + '...' 
                : turn.text;
              return `${turn.speaker}: ${fullText}`;
            });
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
        type: `macro_${category}`
      };
    } catch (error) {
      console.error(`Error fetching macro data (${category}):`, error);
      return {
        success: false,
        error: error.message,
        type: `macro_${category}`
      };
    }
  }
  
  static async getSecFilings(symbol, formType = null, limit = 20) {
    try {
      await connectMongo();
      const db = mongoClient.db('raw_data');
      const collection = db.collection('sec_filings');
      
      // HARDCODED SCHEMA for sec_filings collection:
      //   - ticker (string): Stock symbol (uppercase)
      //   - form_type (string): "10-K", "10-Q", "8-K", "4", "S-1", etc.
      //   - publication_date (string): "2025-12-29"
      //   - report_date (string): "2025-12-26"
      //   - acceptance_datetime (string): "2025-12-29T22:00:08.000+00:00"
      //   - access_number (string): Filing access number
      //   - file_number (string): File number
      //   - url (string): Direct link to filing on SEC.gov
      //   - file_size (string): "5.29 KB"
      //   - source (string): "sec_filings"
      //   - enriched (boolean): Whether data is enriched
      //   - inserted_at (date): Timestamp
      
      let query = {
        ticker: symbol.toUpperCase()
      };
      
      if (formType) {
        query.form_type = formType;
      }
      
      const data = await collection.find(query)
        .sort({ acceptance_datetime: -1 })
        .limit(limit)
        .toArray();
      
      return {
        success: true,
        data: data || [],
        count: data ? data.length : 0,
        source: 'mongodb',
        type: 'sec_filings'
      };
    } catch (error) {
      console.error(`Error fetching SEC filings for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        source: 'mongodb',
        type: 'sec_filings'
      };
    }
  }
}

// Helper functions for conversation management
class ConversationManager {
  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  static estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  
  // Load conversation history with smart pruning to fit token budget
  static async loadConversationContext(conversationId, maxTokens = 4000) {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(30); // Last 30 messages
      
      if (error) throw error;
      if (!messages || messages.length === 0) return [];
      
      // Reverse to chronological order
      messages.reverse();
      
      // Prune to fit token budget (keep most recent)
      let totalTokens = 0;
      const prunedMessages = [];
      
      for (let i = messages.length - 1; i >= 0; i--) {
        const msgTokens = this.estimateTokens(messages[i].content);
        if (totalTokens + msgTokens > maxTokens) break;
        prunedMessages.unshift(messages[i]);
        totalTokens += msgTokens;
      }
      
      return prunedMessages;
    } catch (error) {
      console.error('Error loading conversation context:', error);
      return [];
    }
  }
  
  // Generate conversation title from first user message
  static generateTitle(firstMessage) {
    const title = firstMessage.substring(0, 50);
    return firstMessage.length > 50 ? title + '...' : title;
  }
}

// Authentication helpers
class AuthManager {
  static JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  static JWT_EXPIRES_IN = '7d';
  static REFRESH_TOKEN_EXPIRES_IN = '30d';
  
  // Hash password
  static async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }
  
  // Verify password
  static async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }
  
  // Generate JWT token
  static generateToken(userId, email) {
    return jwt.sign(
      { userId, email },
      this.JWT_SECRET,
      { expiresIn: this.JWT_EXPIRES_IN }
    );
  }
  
  // Generate refresh token
  static generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
  }
  
  // Verify JWT token
  static verifyToken(token) {
    try {
      return jwt.verify(token, this.JWT_SECRET);
    } catch (error) {
      return null;
    }
  }
  
  // Generate random token for email verification / password reset
  static generateRandomToken() {
    return crypto.randomBytes(32).toString('hex');
  }
}

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const decoded = AuthManager.verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  // Verify session exists and is not expired
  const { data: session } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('token', token)
    .eq('user_id', decoded.userId)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (!session) {
    return res.status(403).json({ error: 'Session expired or invalid' });
  }
  
  // Update last activity
  await supabase
    .from('user_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);
  
  req.user = { userId: decoded.userId, email: decoded.email };
  next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token) {
    const decoded = AuthManager.verifyToken(token);
    if (decoded) {
      req.user = { userId: decoded.userId, email: decoded.email };
    }
  }
  
  next();
};

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Register new user
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const passwordHash = await AuthManager.hashPassword(password);
    
    // Create user
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email: email.toLowerCase(),
        password_hash: passwordHash,
        full_name: fullName || null
      }])
      .select()
      .single();
    
    if (userError) throw userError;
    
    // Generate email verification token
    const verificationToken = AuthManager.generateRandomToken();
    await supabase
      .from('email_verification_tokens')
      .insert([{
        user_id: user.id,
        token: verificationToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }]);
    
    // Generate JWT and session
    const jwtToken = AuthManager.generateToken(user.id, user.email);
    const refreshToken = AuthManager.generateRefreshToken();
    
    await supabase
      .from('user_sessions')
      .insert([{
        user_id: user.id,
        token: jwtToken,
        refresh_token: refreshToken,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      }]);
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        emailVerified: user.email_verified
      },
      token: jwtToken,
      refreshToken,
      verificationToken // In production, send this via email instead
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();
    
    if (userError || !user) {
      // Record failed login attempt
      await supabase.rpc('record_failed_login', { 
        p_email: email.toLowerCase(), 
        p_ip_address: req.ip 
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked due to failed login attempts',
        lockedUntil: user.locked_until
      });
    }
    
    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }
    
    // Verify password
    const isValidPassword = await AuthManager.verifyPassword(password, user.password_hash);
    
    if (!isValidPassword) {
      // Record failed login attempt
      await supabase.rpc('record_failed_login', { 
        p_email: email.toLowerCase(), 
        p_ip_address: req.ip 
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Record successful login
    await supabase.rpc('record_user_login', {
      p_user_id: user.id,
      p_ip_address: req.ip,
      p_user_agent: req.headers['user-agent']
    });
    
    // Generate JWT and session
    const jwtToken = AuthManager.generateToken(user.id, user.email);
    const refreshToken = AuthManager.generateRefreshToken();
    
    await supabase
      .from('user_sessions')
      .insert([{
        user_id: user.id,
        token: jwtToken,
        refresh_token: refreshToken,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }]);
    
    // Get user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified,
        isPremium: user.is_premium,
        profile: profile || {}
      },
      token: jwtToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Logout
app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Delete session
    await supabase
      .from('user_sessions')
      .delete()
      .eq('token', token);
    
    // Create audit log
    await supabase
      .from('audit_logs')
      .insert([{
        user_id: req.user.userId,
        action: 'logout',
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Verify email
app.post('/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    
    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (tokenError || !tokenData) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    
    // Update user
    await supabase
      .from('users')
      .update({ 
        email_verified: true,
        email_verified_at: new Date().toISOString()
      })
      .eq('id', tokenData.user_id);
    
    // Delete used token
    await supabase
      .from('email_verification_tokens')
      .delete()
      .eq('id', tokenData.id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Request password reset
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Get user (don't reveal if user exists)
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    
    if (user) {
      // Generate reset token
      const resetToken = AuthManager.generateRandomToken();
      
      await supabase
        .from('password_reset_tokens')
        .insert([{
          user_id: user.id,
          token: resetToken,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
        }]);
      
      // In production, send this via email
      console.log('Password reset token:', resetToken);
    }
    
    // Always return success (don't reveal if user exists)
    res.json({ 
      success: true,
      message: 'If the email exists, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .is('used_at', null)
      .single();
    
    if (tokenError || !tokenData) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    // Hash new password
    const passwordHash = await AuthManager.hashPassword(newPassword);
    
    // Update user password
    await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', tokenData.user_id);
    
    // Mark token as used
    await supabase
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenData.id);
    
    // Invalidate all user sessions
    await supabase
      .from('user_sessions')
      .delete()
      .eq('user_id', tokenData.user_id);
    
    // Create audit log
    await supabase
      .from('audit_logs')
      .insert([{
        user_id: tokenData.user_id,
        action: 'password_reset',
        ip_address: req.ip
      }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get current user profile
app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error: userError } = await supabase
      .from('user_details')
      .select('*')
      .eq('id', req.user.userId)
      .single();
    
    if (userError) throw userError;
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Update user profile
app.patch('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, avatarUrl, notificationPreferences, riskTolerance, investmentGoals, preferredSectors } = req.body;
    
    // Update users table if fullName or avatarUrl provided
    if (fullName !== undefined || avatarUrl !== undefined) {
      const updates = {};
      if (fullName !== undefined) updates.full_name = fullName;
      if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
      
      await supabase
        .from('users')
        .update(updates)
        .eq('id', req.user.userId);
    }
    
    // Update user_profiles table
    const profileUpdates = {};
    if (notificationPreferences !== undefined) profileUpdates.notification_preferences = notificationPreferences;
    if (riskTolerance !== undefined) profileUpdates.risk_tolerance = riskTolerance;
    if (investmentGoals !== undefined) profileUpdates.investment_goals = investmentGoals;
    if (preferredSectors !== undefined) profileUpdates.preferred_sectors = preferredSectors;
    
    if (Object.keys(profileUpdates).length > 0) {
      await supabase
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', req.user.userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ============================================
// USER WATCHLIST ENDPOINTS
// ============================================

// Get user's watchlists
app.get('/watchlists', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_watchlists')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ watchlists: data || [] });
  } catch (error) {
    console.error('Get watchlists error:', error);
    res.status(500).json({ error: 'Failed to get watchlists' });
  }
});

// Create watchlist
app.post('/watchlists', authenticateToken, async (req, res) => {
  try {
    const { name, description, tickers, isDefault } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Watchlist name is required' });
    }
    
    const { data, error } = await supabase
      .from('user_watchlists')
      .insert([{
        user_id: req.user.userId,
        name,
        description: description || null,
        tickers: tickers || [],
        is_default: isDefault || false
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ watchlist: data });
  } catch (error) {
    console.error('Create watchlist error:', error);
    res.status(500).json({ error: 'Failed to create watchlist' });
  }
});

// Update watchlist
app.patch('/watchlists/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, tickers, isDefault } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (tickers !== undefined) updates.tickers = tickers;
    if (isDefault !== undefined) updates.is_default = isDefault;
    
    const { data, error } = await supabase
      .from('user_watchlists')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ watchlist: data });
  } catch (error) {
    console.error('Update watchlist error:', error);
    res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

// Delete watchlist
app.delete('/watchlists/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('user_watchlists')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete watchlist error:', error);
    res.status(500).json({ error: 'Failed to delete watchlist' });
  }
});

// Conversation management endpoints

// Create new conversation
app.post('/conversations', authenticateToken, async (req, res) => {
  try {
    const { metadata = {} } = req.body;
    
    const { data, error } = await supabase
      .from('conversations')
      .insert([{
        user_id: req.user.userId, // Get from JWT token
        metadata: metadata
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ conversation: data });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get user's conversations
app.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const { data, error } = await supabase
      .from('conversation_summaries')
      .select('*')
      .eq('user_id', req.user.userId) // Get from JWT token
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    
    res.json({ conversations: data || [] });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for a conversation
app.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    
    // Verify user owns this conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', id)
      .single();
    
    if (!conversation || conversation.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (error) throw error;
    
    res.json({ messages: data || [] });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Submit feedback for a message
app.post('/messages/:id/feedback', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, reason } = req.body;
    
    if (!feedback || !['like', 'dislike'].includes(feedback)) {
      return res.status(400).json({ error: 'Valid feedback (like/dislike) is required' });
    }
    
    // Verify user owns the conversation this message belongs to
    const { data: message } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', id)
      .single();
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', message.conversation_id)
      .single();
    
    if (!conversation || conversation.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { error } = await supabase
      .from('messages')
      .update({ 
        feedback, 
        feedback_reason: reason || null 
      })
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Main AI chat endpoint
app.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { 
      message, 
      conversationId = null, 
      conversationHistory = [], // Fallback to in-memory history if no conversationId
      selectedTickers = [] 
    } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user?.userId || null; // Get from JWT token if authenticated

    console.log('Processing message:', message);
    console.log('User ID:', userId);
    console.log('Conversation ID:', conversationId);
    console.log('User portfolio:', selectedTickers);
    
    // Verify conversation ownership if conversationId provided
    if (conversationId && userId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('user_id')
        .eq('id', conversationId)
        .single();
      
      if (!conversation || conversation.user_id !== userId) {
        return res.status(403).json({ error: 'Access denied to this conversation' });
      }
    }
    
    // Load conversation history from database if conversationId provided
    let loadedHistory = conversationHistory;
    if (conversationId) {
      loadedHistory = await ConversationManager.loadConversationContext(conversationId, 4000);
      console.log(`Loaded ${loadedHistory.length} messages from conversation ${conversationId}`);
    }

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
        max_tokens: 5000
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
    
    // FETCH SEC FILINGS DATA
    if (queryIntent.dataNeeded.includes('sec_filings') && tickersToQuery.length > 0) {
      for (const ticker of tickersToQuery.slice(0, 3)) {
        try {
          const secResult = await DataConnector.getSecFilings(ticker);
          if (secResult.success && secResult.data.length > 0) {
            dataContext += `\n\n${ticker} Recent SEC Filings:\n`;
            secResult.data.slice(0, 5).forEach((filing, i) => {
              const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
              const size = filing.file_size || 'N/A';
              dataContext += `${i + 1}. ${filing.form_type} filed on ${date} (${size})\n   URL: ${filing.url}\n`;
            });
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
        // Use date range for "last week", "last month" type queries
        macroFilters.date = {
          $gte: queryIntent.dateRange.start,
          $lte: queryIntent.dateRange.end
        };
      }
      if (category === 'policy') macroFilters.limit = 50;
      
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
            // Add quotes for policy documents
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
        
        // Add movers data to context for AI
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
          // Detect if user is specifically asking about volume
          const isVolumeQuery = /volume|traded|trading.*shares|shares.*traded/i.test(message);
          
          // STEP 1: Determine which price table to use based on time range
          let priceTable = 'intraday_prices'; // Default for today
          let chartTimeframe = 'intraday';
          
          if (queryIntent.dateRange) {
            const startDate = new Date(queryIntent.dateRange.start);
            const endDate = new Date(queryIntent.dateRange.end);
            const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            console.log(`Date range detected: ${daysDiff} days (${queryIntent.dateRange.start} to ${queryIntent.dateRange.end})`);
            
            // Smart table selection based on time range:
            // 1 day: intraday_prices (tick data)
            // 2-7 days: one_minute_prices (1-min bars)
            // 8-30 days: hourly_prices (hourly bars)
            // 30+ days: daily_prices (daily bars)
            
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
            
            console.log(`Selected price table: ${priceTable} (timeframe: ${chartTimeframe})`);
          }
          
          // STEP 2: Fetch current price
          console.log(`Fetching quote for ${ticker}`);
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            
            // STEP 3: Fetch company name
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
            
            // STEP 4: Fetch price history from appropriate table
            let priceHistory = [];
            let chartReference = null;
            
            if (priceTable === 'daily_prices') {
              // Use daily_prices for long-term charts (month or longer)
              const startDate = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const endDate = queryIntent.dateRange?.end || new Date().toISOString().split('T')[0];
              
              console.log(`Fetching daily prices for ${ticker} from ${startDate} to ${endDate}`);
              
              const { data: dailyData, error: dailyError } = await supabase
                .from('daily_prices')
                .select('date, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: true });
              
              if (dailyError) {
                console.error('Error fetching daily prices:', dailyError);
              } else if (dailyData && dailyData.length > 0) {
                priceHistory = dailyData.map(row => ({
                  timestamp: row.date,
                  open: row.open,
                  high: row.high,
                  low: row.low,
                  close: row.close,
                  volume: row.volume
                }));
                console.log(`Fetched ${priceHistory.length} daily price bars for ${ticker}`);
              }
            } else if (priceTable === 'hourly_prices') {
              // Use hourly_prices for 1-4 week charts
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              console.log(`Fetching hourly prices for ${ticker} from ${startTime} to ${endTime}`);
              
              const { data: hourlyData, error: hourlyError } = await supabase
                .from('hourly_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (hourlyError) {
                console.error('Error fetching hourly prices:', hourlyError);
              } else if (hourlyData && hourlyData.length > 0) {
                priceHistory = hourlyData;
                console.log(`Fetched ${priceHistory.length} hourly price bars for ${ticker}`);
              }
            } else if (priceTable === 'one_minute_prices') {
              // Use one_minute_prices for week-long charts
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              console.log(`Fetching 1-minute prices for ${ticker} from ${startTime} to ${endTime}`);
              
              const { data: minuteData, error: minuteError } = await supabase
                .from('one_minute_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (minuteError) {
                console.error('Error fetching 1-minute prices:', minuteError);
              } else if (minuteData && minuteData.length > 0) {
                priceHistory = minuteData;
                console.log(`Fetched ${priceHistory.length} 1-minute price bars for ${ticker}`);
              }
            } else {
              // Use intraday_prices for today's chart - provide reference for frontend
              const targetDate = new Date();
              const etOffset = -5 * 60; // Eastern Time offset in minutes
              const etDate = new Date(targetDate.getTime() + (etOffset + targetDate.getTimezoneOffset()) * 60000);
              const dateStr = etDate.toISOString().split('T')[0];
              
              console.log(`Preparing intraday chart reference for ${ticker} on ${dateStr}`);
              
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
            
            // STEP 5: Build data card
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
                // Include either chartReference (for intraday) or priceHistory (for historical)
                chartReference: chartReference,
                chartData: priceHistory.length > 0 ? priceHistory : null,
                chartTimeframe: chartTimeframe,
                priceTable: priceTable
              }
            });
            
            // Add stock card data to AI context
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
            
            // If user is asking about volume, fetch detailed volume data
            if (isVolumeQuery) {
              console.log(`Volume query detected - fetching detailed intraday volume for ${ticker}`);
              const volumeResult = await DataConnector.getVolumeData(ticker, 'intraday');
              
              if (volumeResult.success && volumeResult.data.totalVolume > 0) {
                dataContext += `\n- Trading Volume (Real-time Intraday): ${volumeResult.data.totalVolume.toLocaleString()} shares`;
                dataContext += `\n- Volume Data Points: ${volumeResult.data.dataPoints || 0} tick-by-tick records`;
              } else {
                // Fallback to daily volume if intraday not available
                dataContext += `\n- Trading Volume (Daily): ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
              }
            } else {
              // Regular price query - just show daily volume
              dataContext += `\n- Trading Volume: ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
            }
            
            dataContext += `\n\n**IMPORTANT: Use this exact price data in your response. Do not use any other price information.**`;
            
            console.log(`Generated stock card for ${ticker} using ${priceTable} (${priceHistory.length} data points)`);
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
        content: `You are Catalyst Copilot, a financial AI assistant specializing in connecting market data, institutional activity, and policy developments.

ROLE & EXPERTISE:
- Financial data analyst with real-time market intelligence
- Expert at connecting institutional ownership trends with price movements
- Specialist in FDA approvals, earnings catalysts, and regulatory events
- Policy analyst tracking government decisions affecting markets

DATA SOURCES AT YOUR DISPOSAL:

1. SUPABASE (Real-time Market Data):

   A. COMPANY INFORMATION (company_information)
      • symbol, name, description, logo, weburl
      • city, state, country, currency, exchange
      • gsector, gind, gsubind, finnhubIndustry
      • marketCapitalization, shareOutstanding, employeeTotal
      • ipo, ipo_et, ingested_at, ingested_at_et
   
   B. CURRENT STOCK QUOTES (finnhub_quote_snapshots)
      • symbol, timestamp, timestamp_et, market_date
      • close, change, change_percent, open, high, low
      • previous_close, volume (daily trading volume in shares)
      • source, ingested_at
      • USE: Current price, daily OHLC, percent change, trading volume
   
   C. INTRADAY PRICES (intraday_prices) - Tick-by-tick data
      • symbol, timestamp, timestamp_et
      • price, volume (per-tick trading volume)
      • source, ingested_at
      • USE: Detailed intraday chart rendering, minute-by-minute price action
      • VOLUME USE: Real-time intraday volume tracking, aggregate for total daily volume
   
   D. ONE MINUTE BARS (one_minute_prices)
      • symbol, timestamp, timestamp_et
      • open, high, low, close, volume (1-min aggregated volume)
      • source, created_at
      • VOLUME USE: Minute-by-minute volume analysis, identify volume spikes
   
   E. FIVE MINUTE BARS (five_minute_prices)
      • symbol, timestamp, timestamp_et
      • open, high, low, close, volume (5-min aggregated volume)
      • source, created_at
      • VOLUME USE: Short-term volume trends, institutional block trades
   
   F. HOURLY BARS (hourly_prices)
      • symbol, timestamp, timestamp_et
      • open, high, low, close, volume (hourly aggregated volume)
      • source, created_at
      • VOLUME USE: Intraday volume distribution, compare morning vs afternoon volume
   
   G. DAILY PRICES (daily_prices)
      • symbol, date, date_et
      • open, high, low, close, volume (full day volume)
      • source, created_at, updated_at
      • USE: Historical trend analysis, multi-day/week/month charts
      • VOLUME USE: Day-over-day volume comparison, identify high-volume days
   
   H. MARKET EVENTS (event_data)
      • PrimaryID, type, title, company, ticker, sector
      • actualDateTime, actualDateTime_et, time
      • impactRating, confidence, aiInsight
      • created_on, created_on_et, updated_on, updated_on_et
      • EVENT TYPES: earnings, fda, product, merger, legal, regulatory, investor_day, partnership, etc.
   
   I. CURRENT QUOTES VIEW (stock_quote_now) - Single latest quote per symbol
      • symbol, timestamp, timestamp_et
      • close, volume
      • source, ingested_at
   
   J. WATCHLIST (watchlist)
      • symbol, is_active

2. MONGODB (Historical Context):
   
   A. INSTITUTIONAL OWNERSHIP (institutional_ownership collection)
      • ticker, date
      • institutional_ownership.value (percentage)
      • institutional_ownership.total_institutional_shares (shares, holders)
      • institutional_ownership.increased_positions (shares, holders)
      • institutional_ownership.decreased_positions (shares, holders)
      • institutional_ownership.held_positions (shares, holders)
      • institutional_holdings.holders[] (owner, shares, marketValue, percent)
      • USE: Smart money flow analysis, position changes, top holder identification
   
   B. GOVERNMENT POLICY (government_policy collection)
      • date, url, title
      • participants[] (array of speaker names)
      • turns[] (speaker, text)
      • inserted_at
      • USE: Policy transcript search, speaker quotes, administration priorities
   
   C. MACRO ECONOMICS (macro_economics collection)
      • date, title, description, url
      • author, country, category
      • importance (1-3 scale)
      • inserted_at
      • USE: Economic indicator analysis, country-specific trends, market sentiment

ANALYSIS FRAMEWORK:
When analyzing a stock, always consider these four pillars:

1. PRICE ACTION: Recent performance, volatility patterns, key support/resistance levels
2. CATALYSTS: Upcoming events that could drive significant price movement
3. INSTITUTIONAL FLOW: Are smart money investors accumulating or distributing?
4. MACRO CONTEXT: Policy changes, economic trends, sector rotation affecting the stock

EXAMPLE RESPONSES (Learn from these):

Q: "How did Tesla trade today?"
A: "Tesla (TSLA) closed at $395.08, down $8.91 (-2.21%). The stock showed significant intraday volatility, reaching a high of $428.94 before pulling back to a low of $394.74. Notably, institutional activity from Q4 showed 45 holders decreasing positions while 40 increased, suggesting mixed sentiment among smart money."

Q: "What did Trump say about critical minerals?"
A: "In a November 13th White House briefing, Kevin Hassett outlined Trump administration priorities on critical minerals: 'We're focused on securing domestic supply chains for lithium and rare earths' and announced 'new tariff exemptions for battery components from allied nations.' This policy shift could benefit EV battery manufacturers and mining companies.
Source: [transcript URL]"

Q: "What are the biggest movers in my watchlist?"
A: "Your top movers today: 1) NVDA +3.2% on AI chip demand, 2) TSLA -2.2% on profit-taking, 3) AAPL +1.1% ahead of earnings. NVDA leads with institutional buying (52 holders increasing positions Q4), while TSLA shows distribution (45 holders decreasing)."

RESPONSE GUIDELINES:
• Lead with the most important insight or answer
• Connect multiple data points to tell a cohesive story
• Cite specific numbers, dates, percentages, and sources
• Flag contradictions or unusual patterns when they appear
• Keep responses under 150 words unless discussing multiple events
• When event cards are shown, mention ALL events briefly - users will see every card
• Use professional but conversational tone - avoid jargon unless necessary

DATA INTERPRETATION RULES:
• Institutional Ownership: >50% buying = bullish sentiment, >50% selling = bearish
• Event Timing: Mention days until upcoming catalysts
• Price Context: Compare current price to 52-week high/low when relevant
• Policy Impact: Connect government decisions to specific stocks/sectors affected
• Trading Volume - Multiple Sources Available:
  - Real-time intraday: intraday_prices.volume (tick-by-tick, most accurate for ongoing trading)
  - 1-minute bars: one_minute_prices.volume (minute-by-minute granularity)
  - 5-minute bars: five_minute_prices.volume (short-term trends)
  - Hourly bars: hourly_prices.volume (morning vs afternoon comparison)
  - Daily summary: finnhub_quote_snapshots.volume (end-of-day total)
  - Historical daily: daily_prices.volume (day-over-day comparison)
  - When user asks about "today's volume" or "current trading volume", use intraday_prices aggregated volume
  - When user asks about "volume compared to yesterday", use daily_prices for historical comparison

CRITICAL CONSTRAINTS:
1. ONLY use data provided in Supabase and MongoDB - NEVER use training knowledge for facts/numbers
2. If no data exists, explicitly state: "I don't have that information in the database"
3. Never use placeholder text like "$XYZ" or "X%" - always use real numbers from data
4. When source URLs are provided, include them as clickable references
5. Never fabricate quotes, statistics, or data points
6. If data seems contradictory, acknowledge it rather than hiding the discrepancy

${contextMessage}${dataContext ? '\n\n═══ DATA PROVIDED ═══\n' + dataContext : '\n\n═══ NO DATA AVAILABLE ═══\nYou must inform the user that this information is not in the database.'}${eventCardsContext}`
      },
      ...loadedHistory || [],
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
      max_tokens: 5000 // Increased token budget for detailed responses
    });

    const assistantMessage = completion.choices[0].message;
    
    // Save messages to database if conversationId provided
    let finalConversationId = conversationId;
    let newConversation = null;
    
    if (userId) {
      try {
        // Create new conversation if needed
        if (!conversationId) {
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
        }
        
        // Save user message and assistant response
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
            content: assistantMessage.content,
            data_cards: dataCards.length > 0 ? dataCards : null,
            token_count: completion.usage?.total_tokens || ConversationManager.estimateTokens(assistantMessage.content),
            metadata: {
              model: completion.model,
              finish_reason: completion.choices[0].finish_reason
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
        // Don't fail the request if saving fails - user still gets response
      }
    }

    res.json({
      response: assistantMessage.content,
      dataCards,
      eventData,
      conversationId: finalConversationId,
      newConversation: newConversation,
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