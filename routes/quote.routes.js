/**
 * Quote Routes
 * Provides stock quote data with session-aware baseline calculations
 */

const express = require('express');
const router = express.Router();
const DataConnector = require('../services/DataConnector');

/**
 * GET /api/quote/:symbol
 * Get current quote with session-aware previous close
 * Handles pre-market, regular, and post-market sessions automatically
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol parameter is required'
      });
    }
    
    // Use DataConnector which already handles session-aware baseline logic
    const result = await DataConnector.getQuoteWithPreviousClose(symbol.toUpperCase());
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    // Return in a format compatible with frontend expectations
    res.json({
      success: true,
      data: {
        symbol: result.data.symbol,
        close: result.data.currentPrice,
        previous_close: result.data.previousClose,
        open: result.data.open,
        high: result.data.high,
        low: result.data.low,
        change: result.data.change,
        change_percent: result.data.changePercent,
        volume: result.data.volume,
        session: result.data.session,
        timestamp: result.data.timestamp
      }
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
