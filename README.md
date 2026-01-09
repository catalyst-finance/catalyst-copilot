# Catalyst Copilot

Advanced AI-powered financial assistant with real-time market data and streaming responses.

**Production URL:** `https://catalyst-copilot-2nndy.ondigitalocean.app`  
**Status:** ✅ Live on DigitalOcean App Platform

## Architecture

Catalyst Copilot provides comprehensive financial intelligence by combining:

- **Supabase (PostgreSQL)**: Real-time stock prices, market events, company data, press releases
- **MongoDB**: News articles, macro economics, policy transcripts, institutional ownership  
- **OpenAI GPT-4**: Advanced reasoning with AI-native query generation
- **Server-Sent Events (SSE)**: Real-time streaming responses with thinking phases
- **DigitalOcean App Platform**: Scalable infrastructure with auto-deployment

## Features

### Data Sources
- 📈 **Real-time Stock Data**: Current prices, session-aware baselines, intraday charts
- 📰 **News Articles**: Multi-source news aggregation with relevance scoring
- 📅 **Market Events**: Earnings, FDA approvals, mergers, conferences
- 📄 **Press Releases**: Official company announcements with metadata extraction
- 🌍 **Macro Analysis**: Economic indicators, policy transcripts, market sentiment
- 🎯 **Price Targets**: Analyst price targets from multiple firms

### AI Capabilities
- 🤖 **AI-Native Query Engine**: GPT-4 generates optimized database queries
- 💬 **Streaming Responses**: Real-time SSE with thinking phase updates
- 📊 **Multi-source Analysis**: Intelligently combines data from Supabase and MongoDB
- 🎨 **Rich Article Cards**: Automatic image extraction and metadata enrichment
- 💾 **Conversation Management**: Persistent chat history with user authentication
- 📍 **Timezone Awareness**: Accurate date/time handling for market events

## API Endpoints

### POST /chat
Main AI chat interface with Server-Sent Events (SSE) streaming.

**Request:**
```json
{
  "message": "Why is TSLA up today?",
  "conversationId": "uuid" | null,
  "conversationHistory": [],
  "timezone": "America/New_York"
}
```

**Response:** Server-Sent Events stream
```javascript
// Thinking phase updates
data: {"type":"thinking","phase":"query","content":"Analyzing TSLA price movement..."}

// Token usage tracking
data: {"type":"token_usage","tier":"premium","total":15420}

// Streaming response chunks
data: {"type":"content","content":"Tesla is up 3.2% today..."}

// Article cards
data: {"type":"data_card","data":{"type":"article","id":"article-TSLA-0"}}

// Final metadata
data: {"type":"done","conversationId":"uuid","messageId":"uuid"}
```

### GET /api/quote/:symbol
Get current stock quote with session-aware previous close.

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "TSLA",
    "close": 342.50,
    "previous_close": 338.20,
    "change": 4.30,
    "change_percent": 1.27,
    "session": "regular"
  }
}
```

### GET /api/price-targets/:symbol
Fetch analyst price targets from MongoDB.

**Query Parameters:** `limit` (default: 10, max: 50)

**Response:**
```json
{
  "success": true,
  "symbol": "TSLA",
  "priceTargets": [
    {
      "ticker": "TSLA",
      "date": "2026-01-02T00:00:00.000Z",
      "analyst": "Truist",
      "rating_change": "Hold",
      "price_target_change": "$444 → $439"
    }
  ],
  "count": 10,
  "cached": false
}
```

### GET /health
Health check with MongoDB connection status.

**Response:**
```json
{
  "status": "healthy",
  "mongodb": true,
  "timestamp": "2026-01-08T23:48:10.128Z"
}
```

### Authentication Endpoints
- `POST /auth/register` - Create new user account
- `POST /auth/login` - Authenticate user
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - End user session

### Conversation Management
- `GET /conversations` - List user's conversations
- `POST /conversations` - Create new conversation
- `GET /conversations/:id` - Get conversation details
- `DELETE /conversations/:id` - Delete conversation

### Watchlist Management
- `GET /watchlists` - List user's watchlists
- `POST /watchlists` - Create watchlist
- `PUT /watchlists/:id` - Update watchlist
- `DELETE /watchlists/:id` - Delete watchlist

## Environment Setup

1. Copy environment template:
```bash
cp .env.example .env
```

2. Configure your environment variables:
```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
MONGODB_URI=mongodb://user:pass@cluster.mongo.ondigitalocean.com:27017/db
PORT=3000
```

## AI-Native Query Engine

Instead of predefined function tools, Catalyst uses an **AI-Native Query Engine** where GPT-4 generates optimized database queries directly:

### Query Generation Process

1. **Intent Analysis**: GPT-4 analyzes user question and determines required data
2. **Query Plan**: Generates MongoDB aggregations and Supabase SQL queries
3. **Parallel Execution**: Runs all queries simultaneously for speed
4. **Context Formatting**: Formats results into structured context for response generation
5. **Streaming Response**: Generates answer with real-time thinking updates

### Data Collections

**Supabase (PostgreSQL):**
- `finnhub_quote_snapshots` - Real-time stock quotes
- `intraday_prices` - 5-minute interval price data
- `daily_prices` - Historical daily OHLCV
- `event_data` - Market events (earnings, FDA, conferences)
- `press_releases` - Official company announcements

**MongoDB:**
- `news` - Multi-source news articles
- `macro_economics` - Economic indicators
- `government_policy` - Policy transcripts
- `institutional_ownership` - 13F filings data
- `price_targets` - Analyst price targets

### Query Routing Intelligence

- News/articles → MongoDB `news` collection
- Price/quotes → Supabase `finnhub_quote_snapshots`
- Events/earnings → Supabase `event_data`
- Board changes/announcements → Supabase `press_releases`
- Macro/policy → MongoDB collections
- Price targets → MongoDB `price_targets`

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables in `.env`:
```bash
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
MONGODB_URI=mongodb://...
PORT=3000
```

3. Start the server:
```bash
npm start
# or for development with auto-reload
npm run dev
```

4. Test with curl (SSE stream):
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Why is TSLA up today?","timezone":"America/New_York"}' \
  --no-buffer
```

5. Test health check:
```bash
curl http://localhost:3000/health
```

6. Test price targets:
```bash
curl http://localhost:3000/api/price-targets/TSLA
```

## Production Deployment

**Platform:** DigitalOcean App Platform  
**Region:** NYC1  
**Instance:** 1 vCPU, 512MB RAM  
**Auto-deploy:** Enabled (GitHub main branch)

### Deployment Features

- **Auto-scaling**: Handles traffic spikes automatically
- **GitHub Integration**: Auto-deploys on push to main branch
- **Environment Variables**: Encrypted secrets management
- **Health Monitoring**: Built-in health checks every 10 seconds
- **CORS Configuration**: Figma domains whitelisted
- **Connection Pooling**: MongoDB (10 max), 30s timeouts

### Deployment Configuration

```yaml
services:
  - name: catalyst-copilot
    github:
      branch: main
      deploy_on_push: true
      repo: catalyst-finance/catalyst-copilot
    run_command: npm start
    http_port: 8080
    health_check:
      http_path: /health
      period_seconds: 10
    instance_size_slug: apps-s-1vcpu-0.5gb
```

### Monitoring

- **Health Endpoint**: `GET /health`
- **Runtime Logs**: DigitalOcean dashboard
- **Deployment History**: Automatic versioning
- **Error Tracking**: Console logs with phase tracking

## Frontend Integration

### Figma Make Integration

```typescript
const BACKEND_URL = 'https://catalyst-copilot-2nndy.ondigitalocean.app';

// SSE streaming chat
const eventSource = new EventSource(`${BACKEND_URL}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Why is TSLA up today?',
    conversationId: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'thinking':
      // Show thinking indicator
      console.log(`💭 ${data.content}`);
      break;
    case 'content':
      // Append to response
      responseText += data.content;
      break;
    case 'data_card':
      // Render article/chart card
      renderCard(data.data);
      break;
    case 'done':
      // Save conversation ID
      conversationId = data.conversationId;
      eventSource.close();
      break;
  }
};

// Fetch price targets
const priceTargets = await fetch(
  `${BACKEND_URL}/api/price-targets/TSLA?limit=10`
).then(r => r.json());

// Get stock quote
const quote = await fetch(
  `${BACKEND_URL}/api/quote/TSLA`
).then(r => r.json());
```

## Key Features

1. **Streaming Responses**: Real-time SSE with thinking phase visibility
2. **AI-Native Queries**: GPT-4 generates optimized database queries
3. **Multi-Database**: Intelligent routing between Supabase and MongoDB
4. **Rich Media**: Automatic image extraction and article cards
5. **Session Awareness**: Market session detection for accurate baselines
6. **Timezone Support**: Accurate date/time handling across regions
7. **Conversation History**: Persistent chat with user authentication
8. **Caching**: 5-minute cache for price targets and quotes
9. **CORS Ready**: Figma domain whitelisting included
10. **Production Tested**: Live and serving requests

## Project Structure

```
catalyst-copilot/
├── server.js                    # Main Express server
├── api-server.js               # Lightweight API-only server (optional)
├── config/
│   ├── database.js            # MongoDB & Supabase clients
│   ├── openai.js              # OpenAI client configuration
│   ├── cors.js                # CORS settings (Figma domains)
│   └── prompts/               # System prompts and schemas
├── routes/
│   ├── chat.routes.js         # Main AI chat endpoint (SSE)
│   ├── auth.routes.js         # User authentication
│   ├── conversation.routes.js # Conversation management
│   ├── watchlist.routes.js    # Watchlist CRUD
│   ├── quote.routes.js        # Stock quotes
│   └── price-targets.routes.js # Analyst price targets
├── services/
│   ├── QueryEngine.js         # AI-native query generation
│   ├── ContextEngine.js       # Data formatting & article cards
│   ├── IntelligenceEngine.js  # Response generation
│   ├── DataConnector.js       # Database query execution
│   ├── ConversationManager.js # Chat history management
│   ├── AuthManager.js         # User authentication
│   └── StreamProcessor.js     # SSE streaming handler
├── middleware/
│   └── auth.js                # JWT authentication
└── .do/
    └── app.yaml               # DigitalOcean app specification
```

## Documentation

- [Backend Price Targets API](BACKEND_PRICE_TARGETS_API.md) - Price targets endpoint
- [Database Schema](DATABASE_SCHEMA.md) - Data structure reference
- [Deployment Guide](DEPLOYMENT.md) - DigitalOcean deployment
- [Conversation Management](CONVERSATION_MANAGEMENT_GUIDE.md) - Chat history
- [Setup Guide](SETUP_GUIDE.md) - Environment setup

---

**Production URL:** https://catalyst-copilot-2nndy.ondigitalocean.app  
**Repository:** catalyst-finance/catalyst-copilot  
**Platform:** DigitalOcean App Platform (NYC1)