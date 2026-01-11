/**
 * Generic MongoDB Query API
 * Allows frontend to query any MongoDB collection with flexible filters
 * 
 * Security: Whitelist of allowed collections only
 * Performance: 5-minute in-memory caching
 */

const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');

// Initialize MongoDB client
const mongoClient = new MongoClient(process.env.MONGODB_URI);
const db = mongoClient.db('raw_data');

// In-memory cache with 5-minute TTL
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Whitelist of allowed collections (security)
const ALLOWED_COLLECTIONS = [
  'government_policy',
  'sec_filings',
  'ownership',
  'macro_economics',
  'news',
  'press_releases',
  'price_targets',
  'earnings_transcripts',
  'hype',
  'insider_trading',
  'institutional_ownership'
];

/**
 * GET /api/mongodb/:collection
 * Query any MongoDB collection with flexible filters
 * 
 * Path Parameters:
 *   collection - Collection name (must be in whitelist)
 * 
 * Query Parameters:
 *   ticker - Filter by ticker symbol (optional)
 *   limit - Maximum number of results (default: 20, max: 100)
 *   sort - Sort field (default: varies by collection)
 *   order - Sort order: 'asc' or 'desc' (default: 'desc')
 *   date_gte - Filter by date >= (ISO date string)
 *   date_lte - Filter by date <= (ISO date string)
 *   search - Text search in title/content fields (optional)
 * 
 * Example:
 *   /api/mongodb/news?ticker=TSLA&limit=10&sort=published_at&order=desc
 *   /api/mongodb/price_targets?ticker=AAPL&date_gte=2025-01-01
 */
router.get('/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const {
      ticker,
      limit = 20,
      sort,
      order = 'desc',
      date_gte,
      date_lte,
      search
    } = req.query;

    // Validate collection name
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid collection name',
        allowed: ALLOWED_COLLECTIONS
      });
    }

    // Validate and cap limit
    const parsedLimit = Math.min(parseInt(limit) || 20, 100);

    // Build cache key
    const cacheKey = JSON.stringify({ collection, ticker, limit: parsedLimit, sort, order, date_gte, date_lte, search });

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({
        ...cached.data,
        cached: true
      });
    }

    // Build MongoDB query
    const query = {};

    // Add ticker filter
    if (ticker) {
      query.ticker = ticker.toUpperCase();
    }

    // Add date range filters
    if (date_gte || date_lte) {
      query.$and = query.$and || [];
      
      // Determine date field based on collection
      const dateField = getDateField(collection);
      
      if (date_gte) {
        const dateFilter = {};
        dateFilter[dateField] = { $gte: new Date(date_gte) };
        query.$and.push(dateFilter);
      }
      
      if (date_lte) {
        const dateFilter = {};
        dateFilter[dateField] = { $lte: new Date(date_lte) };
        query.$and.push(dateFilter);
      }
    }

    // Add text search filter
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      query.$or = [
        { title: searchRegex },
        { content: searchRegex },
        { description: searchRegex }
      ];
    }

    // Determine sort field
    const sortField = sort || getDefaultSortField(collection);
    const sortOrder = order === 'asc' ? 1 : -1;

    // Execute query
    const mongoCollection = db.collection(collection);
    const results = await mongoCollection
      .find(query)
      .sort({ [sortField]: sortOrder })
      .limit(parsedLimit)
      .toArray();

    // Prepare response
    const responseData = {
      success: true,
      collection,
      query: query,
      results,
      count: results.length,
      cached: false
    };

    // Cache the response
    cache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });

    // Clean old cache entries (simple cleanup)
    if (cache.size > 1000) {
      const keysToDelete = [];
      for (const [key, value] of cache.entries()) {
        if (Date.now() - value.timestamp > CACHE_TTL) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => cache.delete(key));
    }

    return res.json(responseData);

  } catch (error) {
    console.error('MongoDB query error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/mongodb/:collection/:id
 * Get a specific document by ID
 */
router.get('/:collection/:id', async (req, res) => {
  try {
    const { collection, id } = req.params;

    // Validate collection
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid collection name'
      });
    }

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID'
      });
    }

    // Query document
    const mongoCollection = db.collection(collection);
    const document = await mongoCollection.findOne({ _id: new ObjectId(id) });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    return res.json({
      success: true,
      collection,
      document
    });

  } catch (error) {
    console.error('MongoDB document fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Helper: Get date field name for a collection
 */
function getDateField(collection) {
  const dateFields = {
    government_policy: 'date',
    sec_filings: 'publication_date',
    news: 'published_at',
    press_releases: 'date',
    price_targets: 'date',
    earnings_transcripts: 'report_date',
    macro_economics: 'date',
    ownership: 'file_date',
    hype: 'timestamp',
    insider_trading: 'transaction_date',
    institutional_ownership: 'filing_date'
  };
  return dateFields[collection] || 'date';
}

/**
 * Helper: Get default sort field for a collection
 */
function getDefaultSortField(collection) {
  const sortFields = {
    government_policy: 'date',
    sec_filings: 'publication_date',
    news: 'published_at',
    press_releases: 'date',
    price_targets: 'date',
    earnings_transcripts: 'report_date',
    macro_economics: 'date',
    ownership: 'file_date',
    hype: 'timestamp',
    insider_trading: 'transaction_date',
    institutional_ownership: 'filing_date'
  };
  return sortFields[collection] || 'inserted_at';
}

module.exports = router;
