# Backend Price Targets API Setup

## Overview

This document describes the production backend API endpoint for fetching analyst price targets from MongoDB. The endpoint is deployed on DigitalOcean and serves the Figma Make frontend.

**Production URL:** `https://catalyst-copilot-2nndy.ondigitalocean.app`

**Status:** ✅ Live and operational

## Backend Endpoint Specification

### Route: `/api/price-targets/:symbol`

**Method:** `GET`

**URL Parameters:**
- `symbol` (required): Stock ticker symbol (e.g., "TSLA", "AAPL")

**Query Parameters:**
- `limit` (optional): Maximum number of price targets to return (default: 10)

**Response Format:**
```json
{
  "success": true,
  "symbol": "TSLA",
  "priceTargets": [
    {
      "_id": "6958a36a935ffb26b163248d",
      "ticker": "TSLA",
      "date": "2026-01-02T00:00:00.000Z",
      "analyst": "Truist",
      "action": "Reiterated",
      "rating_change": "Hold",
      "price_target_change": "$444 → $439",
      "source": "price_targets",
      "enriched": false,
      "inserted_at": "2026-01-03T05:04:42.462Z"
    }
  ],
  "count": 10,
  "cached": false
}
```

**Error Responses:**

404 Not Found (still returns success=true with empty array):
```json
{
  "success": true,
  "symbol": "AAPL",
  "priceTargets": [],
  "count": 0,
  "cached": false,
  "message": "No price targets found for this symbol"
}
```

400 Bad Request (invalid symbol):
```json
{
  "success": false,
  "error": "Invalid symbol format. Must be 1-5 letters."
}
```

500 Internal Server Error:
```json
{
  "success": false,
  "error": "Internal server error"
}
```

## Implementation Example (Node.js/Express)

```javascript
import express from 'express';
import { MongoClient } from 'mongodb';

const router = express.Router();

// MongoDB connection (adjust credentials and URL for your setup)
const mongoClient = new MongoClient(process.env.MONGODB_URL);
const db = mongoClient.db('raw_data');
const priceTargetsCollection = db.collection('price_targets');

/**
 * GET /api/price-targets/:symbol
 * Fetch analyst price targets for a given stock symbol
 */
router.get('/price-targets/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    // Validate symbol
    if (!symbol || !/^[A-Z]{1,5}$/.test(symbol.toUpperCase())) {
      return res.status(400).json({
        error: 'Invalid symbol format'
      });
    }
    
    // Query MongoDB for price targets
    const priceTargets = await priceTargetsCollection
      .find({ 
        ticker: symbol.toUpperCase() 
      })
      .sort({ date: -1 }) // Most recent first
      .limit(limit)
      .toArray();
    
    // Return results
    if (priceTargets.length === 0) {
      return res.status(404).json({
        symbol: symbol.toUpperCase(),
        priceTargets: [],
        message: 'No price targets found for this symbol'
      });
    }
    
    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      priceTargets: priceTargets
    });
    
  } catch (error) {
    console.error('Error fetching price targets:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;
```

## MongoDB Collection Schema

The `price_targets` collection in the `raw_data` database has documents with the following structure:

```javascript
{
  "_id": ObjectId("6958a36a935ffb26b163248d"),
  "ticker": "TSLA",                    // Stock ticker (uppercase)
  "date": ISODate("2026-01-02T00:00:00.000Z"),     // Target publication date
  "analyst": "Truist",                 // Analyst firm name
  "action": "Reiterated",              // Reiterated/Downgrade/Upgrade/Initiates
  "rating_change": "Hold",             // Current rating or rating change
  "price_target_change": "$444 → $439", // Price target with change indication
  "source": "price_targets",           // Data source identifier
  "enriched": false,                    // Whether additional data has been added
  "inserted_at": ISODate("2026-01-03T05:04:42.462Z") // Database insertion timestamp
}
```

## Recommended Indexes

For optimal performance, create the following indexes on the `price_targets` collection:

```javascript
// Compound index for ticker + date (most common query)
db.price_targets.createIndex(
  { ticker: 1, date: -1 }
);

// Single index on ticker for simple lookups
db.price_targets.createIndex({ ticker: 1 });
```

## Production Implementation

**Deployment:** DigitalOcean App Platform  
**Service:** catalyst-copilot (Web Service)  
**Repository:** catalyst-finance/catalyst-copilot (main branch)  
**File:** `routes/price-targets.routes.js`

Integrated into existing backend server:

```javascript
// server.js
const priceTargetsRoutes = require('./routes/price-targets.routes');
app.use('/api/price-targets', priceTargetsRoutes);
```

**Features:**
- 5-minute in-memory caching
- Input validation (1-5 letter symbols)
- Rate limiting ready
- Comprehensive error handling

## CORS Configuration

Configured to allow Figma Make frontend requests:

```javascript
// config/cors.js
const corsOptions = {
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://www.figma.com',
      'https://figma.com'
    ];
    
    // Allow any *.figma.site subdomain (Figma Make preview)
    if (!origin || allowedOrigins.includes(origin) || 
        (origin && origin.endsWith('.figma.site'))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
```

## Environment Variables

Configured in DigitalOcean App Platform:

```bash
# MongoDB connection
MONGODB_URI=<encrypted-value>

# Supabase (for other features)
SUPABASE_URL=<encrypted-value>
SUPABASE_SERVICE_ROLE_KEY=<encrypted-value>

# OpenAI (for AI copilot features)
OPENAI_API_KEY=<encrypted-value>
```

## Frontend Configuration

For Figma Make frontend, use:

```javascript
const BACKEND_URL = 'https://catalyst-copilot-2nndy.ondigitalocean.app';

// Fetch price targets
const response = await fetch(`${BACKEND_URL}/api/price-targets/TSLA?limit=10`);
const data = await response.json();
```

## Testing

Test the production endpoint:

```bash
# Fetch price targets for TSLA (default limit 10)
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/price-targets/TSLA"

# Fetch price targets with custom limit
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/price-targets/TSLA?limit=5"

# Fetch latest price target only
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/price-targets/TSLA/latest"

# Check health
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/health"
```

## Caching

✅ **Implemented:** 5-minute in-memory caching

```javascript
// routes/price-targets.routes.js
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache check
const cached = cache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return res.json({
    ...cached.data,
    cached: true
  });
}

// Response includes cached flag
{
  "success": true,
  "symbol": "TSLA",
  "priceTargets": [...],
  "count": 10,
  "cached": false  // true if served from cache
}
```

## Security Considerations

✅ **Input Validation:** Symbol format validated (1-5 letters only)
```javascript
if (!symbol || !/^[A-Z]{1,5}$/i.test(symbol)) {
  return res.status(400).json({ error: 'Invalid symbol format' });
}
```

✅ **Error Handling:** Internal errors hidden in production
```javascript
res.status(500).json({
  error: 'Internal server error',
  message: process.env.NODE_ENV === 'development' ? err.message : undefined
});
```

⏳ **Rate Limiting:** Ready to implement if needed

✅ **CORS:** Restricted to Figma domains only

## Deployment Status

✅ **Live:** https://catalyst-copilot-2nndy.ondigitalocean.app/api/price-targets/:symbol

**Platform:** DigitalOcean App Platform  
**Region:** NYC1  
**Service:** catalyst-copilot (Web Service)  
**Instance:** 1 vCPU, 512MB RAM  
**Auto-deploy:** Enabled (GitHub main branch)  

**Deployment History:**
- 2026-01-08: Initial deployment with price targets endpoint
- 2026-01-08: Fixed schema mismatch (ticker/date fields)
- 2026-01-08: Added caching and validation

**Health Check:** `/health` endpoint returns MongoDB connection status

## Chart Display

Once the backend endpoint is set up and deployed, the frontend will automatically:
1. Fetch price targets when a chart is loaded (not in mini mode)
2. Display them as horizontal dashed lines on the chart:
   - **Green** lines for targets above current price
   - **Red** lines for targets below current price
3. Show the price value on the right side
4. Show the analyst firm name on the left side (first target only)

The lines are styled with:
- 60% opacity
- 4px dash, 4px gap pattern
- 1.5px stroke width
- Auto-hide if outside visible y-axis range