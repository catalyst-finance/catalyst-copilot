/**
 * DataConnector Service
 * Handles all data fetching from Supabase and MongoDB databases
 */

const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const https = require('https');
const { supabase, mongoClient, connectMongo } = require('../config/database');

// Increase max header size for HTTP requests (Yahoo Finance sends very large headers)
// Default is 8KB, we increase to 512KB to handle Yahoo Finance and similar sites
const httpAgent = new http.Agent({ maxHeaderSize: 524288 }); // 512KB
const httpsAgent = new https.Agent({ maxHeaderSize: 524288 }); // 512KB

class DataConnector {
  /**
   * Get current real-time quote from stock_quote_now table
   * @param {string} symbol - Stock ticker symbol
   * @returns {Object} Current quote with close, timestamp, volume, session
   */
  static async getCurrentQuote(symbol) {
    try {
      const { data, error } = await supabase
        .from('stock_quote_now')
        .select('*')
        .eq('symbol', symbol)
        .single();
      
      if (error) {
        console.error(`Error fetching current quote for ${symbol}:`, error);
        return { success: false, error: error.message, data: null };
      }
      
      return { success: true, data };
    } catch (error) {
      console.error(`Error in getCurrentQuote for ${symbol}:`, error);
      return { success: false, error: error.message, data: null };
    }
  }

  /**
   * Get current quote with previous close and calculated change
   * Combines stock_quote_now (current price) with finnhub_quote_snapshots (previous close, open, high, low)
   * @param {string} symbol - Stock ticker symbol
   * @returns {Object} Full quote with current price, change, changePercent, open, high, low, previousClose
   */
  static async getQuoteWithPreviousClose(symbol) {
    try {
      // Fetch current price from stock_quote_now
      const currentResult = await this.getCurrentQuote(symbol);
      
      // Determine the correct baseline for comparison based on current session
      // For pre-market: use previous day's post-market close (if available) or regular close
      // For regular/after-hours: use previous day's regular close
      const currentSession = currentResult.data?.session;
      
      let baselineClose = null;
      let open = null;
      let high = null;
      let low = null;
      
      if (currentSession === 'pre-market') {
        // For pre-market, get the most recent post-market close from yesterday
        const { data: postMarketData } = await supabase
          .from('finnhub_quote_snapshots')
          .select('close, open, high, low, session')
          .eq('symbol', symbol)
          .eq('session', 'post-market')
          .order('timestamp', { ascending: false })
          .limit(1)
          .single();
        
        if (postMarketData) {
          // Use post-market close as baseline for pre-market comparison
          baselineClose = postMarketData.close;
          console.log(`📊 Using post-market close as baseline for pre-market: $${baselineClose?.toFixed(2)}`);
        } else {
          // Fall back to regular session close if no post-market data
          const { data: regularData } = await supabase
            .from('finnhub_quote_snapshots')
            .select('close, open, high, low, previous_close')
            .eq('symbol', symbol)
            .eq('session', 'regular')
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();
          
          baselineClose = regularData?.close || regularData?.previous_close;
          open = regularData?.open;
          high = regularData?.high;
          low = regularData?.low;
        }
      } else {
        // For regular/after-hours, use the standard previous_close from finnhub
        const { data: snapshotData, error: snapshotError } = await supabase
          .from('finnhub_quote_snapshots')
          .select('symbol, timestamp, close, open, high, low, previous_close, change, change_percent, volume, session')
          .eq('symbol', symbol)
          .order('timestamp', { ascending: false })
          .limit(1)
          .single();
        
        if (snapshotError) {
          console.error(`Error fetching finnhub_quote_snapshots for ${symbol}:`, snapshotError.message);
        }
        
        baselineClose = snapshotData?.previous_close;
        open = snapshotData?.open;
        high = snapshotData?.high;
        low = snapshotData?.low;
      }
      
      if (!currentResult.success && !baselineClose) {
        return { success: false, error: 'Failed to fetch quote data', data: null };
      }
      
      // Use current price from stock_quote_now if available
      const currentPrice = currentResult.data?.close;
      
      // Calculate change and percent change from baseline
      let change = null;
      let changePercent = null;
      if (currentPrice && baselineClose) {
        change = currentPrice - baselineClose;
        changePercent = ((change / baselineClose) * 100);
      }
      
      const quote = {
        symbol: symbol,
        currentPrice: currentPrice,
        previousClose: baselineClose,
        open: open,
        high: high,
        low: low,
        change: change,
        changePercent: changePercent,
        volume: currentResult.data?.volume,
        session: currentSession,
        timestamp: currentResult.data?.timestamp,
        source: 'stock_quote_now'
      };
      
      console.log(`📊 Quote for ${symbol}: $${currentPrice?.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent?.toFixed(2)}%) [baseline: $${baselineClose?.toFixed(2)}] session: ${currentSession}`);
      
      return { success: true, data: quote };
    } catch (error) {
      console.error(`Error in getQuoteWithPreviousClose for ${symbol}:`, error);
      return { success: false, error: error.message, data: null };
    }
  }

  /**
   * Get stock data from Supabase
   * @param {string} symbol - Stock ticker symbol
   * @param {string} dataType - 'current', 'intraday', or 'daily'
   */
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
  
  /**
   * Get events from Supabase
   * @param {Object} filters - Query filters
   */
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
  
  /**
   * Get institutional ownership data from MongoDB
   * @param {string} symbol - Stock ticker symbol
   */
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
  
  /**
   * Get volume data from Supabase
   * @param {string} symbol - Stock ticker symbol
   * @param {string} timeframe - 'current', 'intraday', or 'today'
   */
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
  
  /**
   * Get macro/economic data from MongoDB
   * @param {string} category - 'general', 'policy', or 'economic'
   * @param {Object} filters - Query filters
   */
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
            // Use OR logic - match ANY of the search terms, not ALL
            const termConditions = searchTerms.map(term => ({
              $or: [
                { title: { $regex: term, $options: 'i' } },
                { 'turns.text': { $regex: term, $options: 'i' } }
              ]
            }));
            
            // Combine all term conditions with OR, not AND
            andConditions.push({ $or: termConditions });
          }
        }
      } else {
        // For economic and news: use macro_economics collection
        collection = db.collection('macro_economics');
        
        if (filters.textSearch) {
          const searchTerms = filters.textSearch.toLowerCase().split(/\s+/).filter(term => 
            term.length > 2 && !['the', 'and', 'for', 'with', 'from', 'about'].includes(term)
          );
          
          if (searchTerms.length > 0) {
            const termConditions = searchTerms.map(term => ({
              $or: [
                { title: { $regex: term, $options: 'i' } },
                { description: { $regex: term, $options: 'i' } },
                { country: { $regex: term, $options: 'i' } },
                { author: { $regex: term, $options: 'i' } },
                { category: { $regex: term, $options: 'i' } }
              ]
            }));
            
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
      const sortField = filters.sort || { inserted_at: -1 };
      const data = await collection.find(query)
        .sort(sortField)
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
          
          // CRITICAL: Include raw turns array for company extraction
          if (doc.turns) summary.turns = doc.turns;
          
          // Extract key quotes from turns (limit to 8 most relevant)
          if (doc.turns && doc.turns.length > 0) {
            let relevantTurns = doc.turns;
            
            if (filters.textSearch) {
              const searchTerms = filters.textSearch.toLowerCase().split(/\s+/);
              
              const scoredTurns = doc.turns.map(turn => {
                const turnText = turn.text.toLowerCase();
                const score = searchTerms.filter(term => turnText.includes(term)).length;
                return { turn, score };
              }).filter(item => item.score > 0);
              
              scoredTurns.sort((a, b) => b.score - a.score);
              relevantTurns = scoredTurns.map(item => item.turn);
            }
            
            if (filters.speaker && filters.speaker.toLowerCase() !== 'trump') {
              relevantTurns = relevantTurns.filter(turn => 
                turn.speaker.toLowerCase().includes(filters.speaker.toLowerCase())
              );
            }
            
            relevantTurns = relevantTurns.slice(0, 8);
            
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
  
  /**
   * Fetch and parse SEC filing content from URL
   * @param {string} url - SEC filing URL
   * @param {string[]} keywords - Keywords to extract relevant sections
   * @param {number} maxLength - Maximum content length
   */
  static async fetchSecFilingContent(url, keywords = [], maxLength = 15000) {
    try {
      console.log(`Fetching SEC filing content from: ${url}`);
      if (keywords.length > 0) {
        console.log(`Looking for keywords: ${keywords.join(', ')}`);
      }
      
      // Fetch the HTML/XML content
      const response = await axios.get(url, {
        timeout: 15000, // 15 second timeout
        headers: {
          'User-Agent': 'Catalyst Copilot Financial Analysis Tool contact@catalyst.finance'
        },
        httpAgent: httpAgent,
        httpsAgent: httpsAgent
      });
      
      const html = response.data;
      
      // Parse HTML and extract text content
      const $ = cheerio.load(html);
      
      // Extract image URLs from the filing (charts, tables, diagrams)
      const imageUrls = [];
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      
      $('img').each((i, el) => {
        let src = $(el).attr('src');
        if (src) {
          // Convert relative URLs to absolute
          if (!src.startsWith('http')) {
            src = baseUrl + src;
          }
          // Filter out tiny images (likely icons) and keep substantive ones
          const alt = $(el).attr('alt') || '';
          const width = parseInt($(el).attr('width')) || 0;
          const height = parseInt($(el).attr('height')) || 0;
          
          // Keep images that are likely charts/tables (larger images or with meaningful alt text)
          if (width > 200 || height > 100 || alt.length > 5 || src.includes('img')) {
            imageUrls.push({
              url: src,
              alt: alt,
              context: $(el).parent().text().substring(0, 100).trim()
            });
          }
        }
      });
      
      console.log(`Found ${imageUrls.length} images in SEC filing`);
      
      // Remove script and style tags
      $('script, style, noscript').remove();
      
      // Extract text content
      let text = $('body').text() || $.text();
      
      // Clean up whitespace
      text = text
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\n\s*\n/g, '\n') // Remove empty lines
        .trim();
      
      // If keywords provided, extract relevant sections
      let relevantContent = text;
      if (keywords.length > 0) {
        // Split into sentences
        const sentences = text.split(/(?<=[.!?])\s+/);
        
        // Find sentences containing keywords (case-insensitive)
        const keywordRegex = new RegExp(keywords.join('|'), 'gi');
        const relevantSentences = [];
        const contextWindow = 2; // Include 2 sentences before and after keyword match
        
        for (let i = 0; i < sentences.length; i++) {
          if (keywordRegex.test(sentences[i])) {
            // Add context sentences
            const start = Math.max(0, i - contextWindow);
            const end = Math.min(sentences.length, i + contextWindow + 1);
            for (let j = start; j < end; j++) {
              if (!relevantSentences.includes(sentences[j])) {
                relevantSentences.push(sentences[j]);
              }
            }
          }
        }
        
        if (relevantSentences.length > 0) {
          relevantContent = relevantSentences.join(' ');
          console.log(`Found ${relevantSentences.length} relevant sentences with keywords`);
        } else {
          console.log('No keyword matches found, using full text');
          relevantContent = text;
        }
      }
      
      // Truncate to maxLength to avoid token overflow
      if (relevantContent.length > maxLength) {
        relevantContent = relevantContent.substring(0, maxLength) + '... [truncated for length]';
      }
      
      console.log(`Fetched ${relevantContent.length} characters of content`);
      
      return {
        success: true,
        content: relevantContent,
        contentLength: relevantContent.length,
        keywordMatches: keywords.length > 0,
        images: imageUrls // Return extracted image URLs
      };
    } catch (error) {
      console.error(`Error fetching SEC filing content from ${url}:`, error.message);
      return {
        success: false,
        error: error.message,
        content: null,
        images: []
      };
    }
  }
  
  /**
   * Fetch and parse web content from any URL (news articles, press releases, etc.)
   * @param {string} url - Web page URL
   * @param {number} maxLength - Maximum content length
   * @param {boolean} metadataOnly - If true, only extract og:image and provider name (no article content)
   */
  static async fetchWebContent(url, maxLength = 10000, metadataOnly = true) {
    try {
      console.log(`🌐 Fetching web content from: ${url}`);
      
      // Skip certain domains that block scraping or have paywalls
      const blockedDomains = ['wsj.com', 'ft.com', 'bloomberg.com', 'barrons.com', 'reuters.com'];
      const urlLower = url.toLowerCase();
      if (blockedDomains.some(domain => urlLower.includes(domain))) {
        console.log(`   ❌ Skipping blocked domain: ${url}`);
        return {
          success: false,
          error: 'Domain blocks automated access',
          content: null
        };
      }
      
      console.log(`📡 Making axios request with maxHeaderSize: 65536, timeout: 10000ms`);
      console.log(`   Node.js maxHttpHeaderSize: ${require('http').maxHeaderSize || 'default (8KB)'}`);
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
        maxHeaderSize: 65536, // 64KB - Yahoo Finance has extremely large headers (>32KB!)
        maxRedirects: 5
      });
      
      console.log(`✅ Response received: ${response.status} ${response.statusText}`);
      console.log(`   Response headers count: ${Object.keys(response.headers).length}`);
      console.log(`   Content-Type: ${response.headers['content-type']}`);
      console.log(`   Content-Length: ${response.headers['content-length'] || 'chunked'}`);
      
      // Calculate approximate header size
      const headerSize = Object.entries(response.headers)
        .reduce((size, [key, value]) => size + key.length + String(value).length + 4, 0);
      console.log(`   Approximate header size: ${headerSize} bytes (${(headerSize/1024).toFixed(2)} KB)`);
      
      // Show largest headers
      const sortedHeaders = Object.entries(response.headers)
        .map(([key, value]) => ({ key, size: key.length + String(value).length }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 5);
      console.log(`   Top 5 largest headers:`, sortedHeaders.map(h => `${h.key} (${h.size}b)`).join(', '));
      
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Extract og:image BEFORE removing elements
      let imageUrl = null;
      const ogImage = $('meta[property="og:image"]').attr('content') || 
                     $('meta[name="og:image"]').attr('content') ||
                     $('meta[property="twitter:image"]').attr('content');
      if (ogImage) {
        imageUrl = ogImage;
        console.log(`   📸 Found og:image: ${imageUrl.substring(0, 100)}${imageUrl.length > 100 ? '...' : ''}`);
      }
      
      // Extract provider/source from Yahoo Finance articles BEFORE removing elements
      // Yahoo uses a provider-logo element with aria-label, title, or alt containing the source name
      let providerName = null;
      if (url.includes('yahoo.com')) {
        // Try multiple selectors for Yahoo Finance provider info
        const providerLogo = $('.provider-logo');
        if (providerLogo.length) {
          providerName = providerLogo.attr('alt') || providerLogo.attr('title');
        }
        // Also try the parent link with aria-label
        if (!providerName) {
          const providerLink = $('a[data-ylk*="logo-provider"]');
          if (providerLink.length) {
            providerName = providerLink.attr('aria-label') || providerLink.attr('title');
          }
        }
        // Try extracting from data-ylk attribute (slk:SourceName)
        if (!providerName) {
          const dataYlk = $('a[data-ylk*="slk:"]').attr('data-ylk');
          if (dataYlk) {
            const slkMatch = dataYlk.match(/slk:([^;]+)/);
            if (slkMatch) {
              providerName = slkMatch[1];
            }
          }
        }
        if (providerName) {
          console.log(`   📰 Found Yahoo provider: ${providerName}`);
        }
      }
      
      // Only extract article content if metadataOnly is false
      let content = null;
      
      if (!metadataOnly) {
        // Remove unwanted elements
        $('script, style, noscript, nav, header, footer, aside, .ad, .advertisement, .sidebar').remove();
        
        // Try to find the main article content
        content = '';
        
        // Common article content selectors
        const articleSelectors = [
          'article',
          '[role="main"]',
          '.article-content',
          '.article-body',
          '.post-content',
          '.entry-content',
          '.story-body',
          'main',
          '.content'
        ];
        
        for (const selector of articleSelectors) {
          const element = $(selector);
          if (element.length && element.text().trim().length > 200) {
            content = element.text();
            break;
          }
        }
        
        // Fallback to body text
        if (!content || content.length < 200) {
          content = $('body').text();
        }
        
        // Clean up whitespace
        content = content
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n')
          .trim();
        
        // Truncate to maxLength
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '... [truncated]';
        }
        
        console.log(`   Fetched ${content.length} characters of content`);
      } else {
        console.log(`   Metadata only mode - skipping content extraction`);
      }
      
      return {
        success: true,
        content: content,
        contentLength: content ? content.length : 0,
        imageUrl: imageUrl, // og:image URL if found
        providerName: providerName // Original content provider for Yahoo articles
      };
    } catch (error) {
      console.error(`❌ Error fetching web content from ${url}`);
      console.error(`   Error type: ${error.constructor.name}`);
      console.error(`   Error message: ${error.message}`);
      console.error(`   Error code: ${error.code || 'N/A'}`);
      
      // For axios errors, show response details
      if (error.response) {
        console.error(`   HTTP Status: ${error.response.status} ${error.response.statusText}`);
        console.error(`   Response headers count: ${Object.keys(error.response.headers || {}).length}`);
      }
      
      // For network/parsing errors, show more details
      if (error.code) {
        console.error(`   Network code: ${error.code}`);
      }
      
      // Check if it's specifically a header overflow
      if (error.message && error.message.includes('Header overflow')) {
        console.error(`   🚨 HEADER OVERFLOW DETECTED`);
        console.error(`   Current Node.js maxHttpHeaderSize: ${require('http').maxHeaderSize || 'default (8KB)'}`);
        console.error(`   Axios maxHeaderSize config: 65536 bytes (64KB)`);
        console.error(`   💡 Yahoo Finance headers exceed even this limit - may need to increase further or use alternative method`);
      }
      
      return {
        success: false,
        error: error.message,
        content: null
      };
    }
  }
  
  /**
   * Get SEC filings from MongoDB
   * @param {string} symbol - Stock ticker symbol
   * @param {string|string[]} formType - Form type(s) to filter
   * @param {Object} dateRange - Date range with start and end
   * @param {number} limit - Maximum results
   */
  static async getSecFilings(symbol, formType = null, dateRange = null, limit = 20) {
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
      //   - summary (string): AI-generated summary if enriched
      //   - key_points (array): Important points from filing if enriched
      //   - inserted_at (date): Timestamp
      
      let query = {
        ticker: symbol.toUpperCase()
      };
      
      // Support both single form type and array of form types
      if (formType) {
        if (Array.isArray(formType)) {
          query.form_type = { $in: formType };
        } else {
          query.form_type = formType;
        }
      }
      
      // Add date range filtering if provided
      if (dateRange && dateRange.start && dateRange.end) {
        // Convert string dates to MongoDB Date objects
        const startDate = new Date(dateRange.start + 'T00:00:00.000Z');
        const endDate = new Date(dateRange.end + 'T23:59:59.999Z');
        
        query.acceptance_datetime = {
          $gte: startDate,
          $lte: endDate
        };
        console.log(`Filtering SEC filings from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      }
      
      console.log(`MongoDB query for SEC filings:`, JSON.stringify(query, null, 2));
      
      const data = await collection.find(query)
        .sort({ acceptance_datetime: -1 })
        .limit(limit)
        .toArray();
      
      console.log(`Found ${data ? data.length : 0} SEC filings for ${symbol}`);
      
      if (!data || data.length === 0) {
        return {
          success: true,
          data: [],
          count: 0,
          message: `No SEC filings found for ${symbol}${formType ? ` of type ${Array.isArray(formType) ? formType.join(', ') : formType}` : ''}${dateRange ? ` between ${dateRange.start} and ${dateRange.end}` : ''}`,
          source: 'mongodb',
          type: 'sec_filings'
        };
      }
      
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

  /**
   * Execute a raw MongoDB query on any collection
   * Used by AI-Native Query Engine for flexible querying
   */
  static async executeRawQuery(collectionName, query, sort = {}, limit = 30) {
    try {
      const db = mongoClient.db('raw_data');
      const collection = db.collection(collectionName);
      
      console.log(`🔍 Raw query on ${collectionName}:`, JSON.stringify(query, null, 2));
      
      let cursor = collection.find(query);
      
      if (Object.keys(sort).length > 0) {
        cursor = cursor.sort(sort);
      }
      
      cursor = cursor.limit(limit);
      
      const data = await cursor.toArray();
      
      console.log(`   Found ${data.length} documents in ${collectionName}`);
      
      return {
        success: true,
        data: data || [],
        count: data.length,
        source: 'mongodb',
        collection: collectionName
      };
    } catch (error) {
      console.error(`Error executing raw query on ${collectionName}:`, error);
      return {
        success: false,
        data: [],
        error: error.message,
        source: 'mongodb',
        collection: collectionName
      };
    }
  }
}

module.exports = DataConnector;
