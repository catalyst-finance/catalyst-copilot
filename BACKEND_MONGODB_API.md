# Backend MongoDB Generic Query API

## Overview

This document describes the production backend API endpoint for querying any MongoDB collection with flexible filters. The endpoint is deployed on DigitalOcean and serves the Figma Make frontend and other applications.

**Production URL:** `https://catalyst-copilot-2nndy.ondigitalocean.app`

**Status:** ✅ Live and operational

## Backend Endpoint Specification

### Route: `/api/mongodb/:collection`

**Method:** `GET`

**Path Parameters:**
- `collection` (required): Collection name - must be from allowed list

**Query Parameters:**
- `ticker` (optional): Filter by stock ticker symbol (e.g., "TSLA", "AAPL")
- `limit` (optional): Maximum number of results (default: 20, max: 100)
- `sort` (optional): Field to sort by (defaults vary by collection)
- `order` (optional): Sort order - "asc" or "desc" (default: "desc")
- `date_gte` (optional): Filter by date >= (ISO date string, e.g., "2025-01-01")
- `date_lte` (optional): Filter by date <= (ISO date string)
- `search` (optional): Text search in title/content fields

**Allowed Collections:**
- `government_policy` - Political statements, policy speeches
- `sec_filings` - SEC filings (10-K, 10-Q, 8-K, etc.)
- `ownership` - 13F institutional holdings
- `macro_economics` - Economic indicators and global news
- `news` - Company news articles
- `press_releases` - Company press releases
- `price_targets` - Analyst price targets and ratings
- `earnings_transcripts` - Earnings call transcripts
- `hype` - Social sentiment and buzz metrics
- `insider_trading` - Insider trading transactions
- `institutional_ownership` - Institutional ownership data

**Response Format:**
```json
{
  "success": true,
  "collection": "news",
  "query": {
    "ticker": "TSLA"
  },
  "results": [
    {
      "_id": "6958a36a935ffb26b163248d",
      "ticker": "TSLA",
      "title": "Tesla Announces Q4 2025 Results",
      "content": "...",
      "published_at": "2026-01-05T10:30:00.000Z",
      "url": "https://...",
      "source": "news"
    }
  ],
  "count": 10,
  "cached": false
}
```

**Error Responses:**

400 Bad Request (invalid collection):
```json
{
  "success": false,
  "error": "Invalid collection name",
  "allowed": [
    "government_policy",
    "sec_filings",
    "..."
  ]
}
```

500 Internal Server Error:
```json
{
  "success": false,
  "error": "Internal server error"
}
```

### Route: `/api/mongodb/:collection/:id`

**Method:** `GET`

**Path Parameters:**
- `collection` (required): Collection name
- `id` (required): MongoDB document ObjectId

**Response Format:**
```json
{
  "success": true,
  "collection": "news",
  "document": {
    "_id": "6958a36a935ffb26b163248d",
    "ticker": "TSLA",
    "title": "...",
    "..."
  }
}
```

## Usage Examples

### Fetch Recent News for a Ticker
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/news?ticker=TSLA&limit=10"
```

### Fetch Price Targets with Date Range
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/price_targets?ticker=AAPL&date_gte=2025-01-01&limit=20"
```

### Search Government Policy Statements
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/government_policy?search=tariff&limit=15"
```

### Fetch SEC Filings (Sorted by Date)
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/sec_filings?ticker=TSLA&sort=publication_date&order=desc&limit=5"
```

### Get Specific Document by ID
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/news/6958a36a935ffb26b163248d"
```

### Fetch Earnings Transcripts
```bash
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/earnings_transcripts?ticker=AAPL&limit=3"
```

## Frontend Integration

### JavaScript/Fetch Example
```javascript
const BACKEND_URL = 'https://catalyst-copilot-2nndy.ondigitalocean.app';

// Fetch news for TSLA
async function fetchNews(ticker, limit = 10) {
  const response = await fetch(
    `${BACKEND_URL}/api/mongodb/news?ticker=${ticker}&limit=${limit}`
  );
  const data = await response.json();
  
  if (data.success) {
    return data.results;
  } else {
    throw new Error(data.error);
  }
}

// Fetch price targets with date range
async function fetchPriceTargets(ticker, dateFrom) {
  const response = await fetch(
    `${BACKEND_URL}/api/mongodb/price_targets?ticker=${ticker}&date_gte=${dateFrom}&limit=20`
  );
  const data = await response.json();
  return data.results;
}

// Search government policy
async function searchPolicy(keyword) {
  const response = await fetch(
    `${BACKEND_URL}/api/mongodb/government_policy?search=${encodeURIComponent(keyword)}&limit=10`
  );
  const data = await response.json();
  return data.results;
}

// Get specific document
async function getDocument(collection, id) {
  const response = await fetch(
    `${BACKEND_URL}/api/mongodb/${collection}/${id}`
  );
  const data = await response.json();
  return data.document;
}
```

## Collection-Specific Details

### Date Fields by Collection
Each collection uses a different field name for dates:
- `government_policy` - `date`
- `sec_filings` - `publication_date`
- `news` - `published_at`
- `press_releases` - `date`
- `price_targets` - `date`
- `earnings_transcripts` - `report_date`
- `macro_economics` - `date`
- `ownership` - `file_date`
- `hype` - `timestamp`
- `insider_trading` - `transaction_date`
- `institutional_ownership` - `filing_date`

The API automatically handles these differences - you only need to use `date_gte` and `date_lte`.

### Default Sort Fields
Each collection has a sensible default sort field:
- `government_policy` - sorted by `date`
- `sec_filings` - sorted by `publication_date`
- `news` - sorted by `published_at`
- `price_targets` - sorted by `date`
- `earnings_transcripts` - sorted by `report_date`

All default to descending order (newest first).

## Caching

✅ **Implemented:** 5-minute in-memory caching

```json
{
  "success": true,
  "collection": "news",
  "results": [...],
  "count": 10,
  "cached": true  // Indicates response served from cache
}
```

Cache is keyed by: collection + all query parameters

Cache cleanup runs automatically when cache size exceeds 1000 entries.

## Security

✅ **Collection Whitelist:** Only pre-approved collections can be queried
```javascript
const ALLOWED_COLLECTIONS = [
  'government_policy',
  'sec_filings',
  'ownership',
  // ... etc
];
```

✅ **Result Limits:** Maximum 100 results per request (default: 20)

✅ **Input Validation:** Collection names and ObjectIds validated before query

✅ **CORS:** Restricted to Figma domains (see BACKEND_PRICE_TARGETS_API.md)

✅ **Error Handling:** Internal errors masked in production

## Performance Considerations

**Indexes Required:**
```javascript
// MongoDB indexes for optimal performance
db.news.createIndex({ ticker: 1, published_at: -1 });
db.sec_filings.createIndex({ ticker: 1, publication_date: -1 });
db.price_targets.createIndex({ ticker: 1, date: -1 });
db.press_releases.createIndex({ ticker: 1, date: -1 });
db.government_policy.createIndex({ date: -1 });
db.earnings_transcripts.createIndex({ ticker: 1, report_date: -1 });
```

**Caching Strategy:**
- 5-minute TTL for all queries
- Automatic cache cleanup at 1000+ entries
- Cache key includes all query parameters

**Response Size:**
- Limit parameter caps results (max: 100)
- Large text fields (transcripts) returned in full
- Consider pagination for large result sets

## Deployment

**Platform:** DigitalOcean App Platform  
**Service:** catalyst-copilot (Web Service)  
**File:** `routes/mongodb.routes.js`  
**MongoDB:** MongoDB Atlas (`raw_data` database)

**Environment Variables:**
- `MONGODB_URI` - MongoDB connection string (encrypted)
- `NODE_ENV` - "production" (hides error details)

**Auto-deploy:** Enabled from GitHub main branch

## Testing

```bash
# Test news endpoint
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/news?ticker=TSLA&limit=5"

# Test price targets
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/price_targets?ticker=AAPL&limit=10"

# Test with date filter
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/sec_filings?ticker=TSLA&date_gte=2025-01-01"

# Test search
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/government_policy?search=inflation"

# Test invalid collection (should fail)
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/invalid_collection"

# Test specific document
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/api/mongodb/news/6958a36a935ffb26b163248d"

# Check health
curl "https://catalyst-copilot-2nndy.ondigitalocean.app/health"
```

## Common Use Cases

### 1. Building a News Feed
```javascript
// Get latest 20 news articles for a ticker
const news = await fetch(
  `${BACKEND_URL}/api/mongodb/news?ticker=TSLA&limit=20&order=desc`
).then(r => r.json());
```

### 2. Displaying Analyst Ratings
```javascript
// Get recent analyst ratings
const ratings = await fetch(
  `${BACKEND_URL}/api/mongodb/price_targets?ticker=AAPL&limit=10`
).then(r => r.json());
```

### 3. SEC Filings Timeline
```javascript
// Get recent SEC filings for a ticker
const filings = await fetch(
  `${BACKEND_URL}/api/mongodb/sec_filings?ticker=TSLA&limit=15&sort=publication_date`
).then(r => r.json());
```

### 4. Government Policy Search
```javascript
// Search for tariff-related statements
const policies = await fetch(
  `${BACKEND_URL}/api/mongodb/government_policy?search=tariff&limit=10`
).then(r => r.json());
```

### 5. Earnings Call History
```javascript
// Get recent earnings transcripts
const transcripts = await fetch(
  `${BACKEND_URL}/api/mongodb/earnings_transcripts?ticker=AAPL&limit=5`
).then(r => r.json());
```

## Comparison with Specific Endpoints

| Feature | `/api/mongodb/:collection` | `/api/price-targets/:symbol` |
|---------|---------------------------|------------------------------|
| Flexibility | Query any collection | Price targets only |
| Filtering | ticker, dates, search | ticker only |
| Sorting | Customizable | Fixed (date desc) |
| Limit | 1-100 (default: 20) | Default: 10 |
| Caching | 5 minutes | 5 minutes |
| Use Case | General querying | Specialized price targets |

**Recommendation:** Use `/api/mongodb/price_targets` for price target queries (same as specialized endpoint), use `/api/mongodb/:collection` for all other collections.
