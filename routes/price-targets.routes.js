/**
 * Price Targets Routes
 * Provides analyst price targets from MongoDB
 * Used by frontend to display price target lines on charts
 */

const express = require('express');
const router = express.Router();
const { mongoClient } = require('../config/database');

// Simple in-memory cache (5 minute TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/price-targets/:symbol
 * Fetch analyst price targets for a given stock symbol
 * 
 * Query Parameters:
 * - limit: Maximum number of price targets to return (default: 10, max: 50)
 * 
 * Response:
 * {
 *   symbol: "TSLA",
 *   priceTargets: [{
 *     _id, symbol, analyst_firm, analyst_name, price_target,
 *     rating, published_date, action, previous_target, updated_at
 *   }],
 *   cached: false,
 *   count: 5
 * }
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    // Validate symbol format (1-5 uppercase letters)
    if (!symbol || !/^[A-Z]{1,5}$/i.test(symbol)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid symbol format. Must be 1-5 letters.'
      });
    }
    
    const upperSymbol = symbol.toUpperCase();
    const cacheKey = `${upperSymbol}:${limit}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({
        ...cached.data,
        cached: true
      });
    }
    
    // Query MongoDB for price targets
    const db = mongoClient.db('raw_data');
    const priceTargetsCollection = db.collection('price_targets');
    
    const priceTargets = await priceTargetsCollection
      .find({ ticker: upperSymbol })
      .sort({ date: -1 }) // Most recent first
      .limit(limit)
      .toArray();
    
    // Prepare response
    const response = {
      success: true,
      symbol: upperSymbol,
      priceTargets: priceTargets,
      count: priceTargets.length,
      cached: false
    };
    
    // Return 404 if no targets found (but still valid response structure)
    if (priceTargets.length === 0) {
      return res.status(404).json({
        ...response,
        message: 'No price targets found for this symbol'
      });
    }
    
    // Cache the successful result
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries (simple cleanup every 100 requests)
    if (Math.random() < 0.01) {
      const now = Date.now();
      for (const [key, value] of cache.entries()) {
        if (now - value.timestamp >= CACHE_TTL) {
          cache.delete(key);
        }
      }
    }
    
    return res.json(response);
    
  } catch (error) {
    console.error('❌ Error fetching price targets:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to fetch price targets'
    });
  }
});

/**
 * GET /api/price-targets/:symbol/latest
 * Get only the most recent price target for a symbol
 */
router.get('/:symbol/latest', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    if (!symbol || !/^[A-Z]{1,5}$/i.test(symbol)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid symbol format'
      });
    }
    
    const upperSymbol = symbol.toUpperCase();
    const cacheKey = `latest:${upperSymbol}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({
        ...cached.data,
        cached: true
      });
    }
    
    // Query MongoDB
    const db = mongoClient.db('raw_data');
    const priceTargetsCollection = db.collection('price_targets');
    
    const latestTarget = await priceTargetsCollection
      .findOne(
        { ticker: upperSymbol },
        { sort: { date: -1 } }
      );
    
    if (!latestTarget) {
      return res.status(404).json({
        success: false,
        symbol: upperSymbol,
        message: 'No price targets found for this symbol'
      });
    }
    
    const response = {
      success: true,
      symbol: upperSymbol,
      priceTarget: latestTarget,
      cached: false
    };
    
    // Cache the result
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    return res.json(response);
    
  } catch (error) {
    console.error('❌ Error fetching latest price target:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
