# Catalyst AI Agent

Advanced AI-powered financial assistant running on DigitalOcean Agent Platform with dual-database architecture.

## Architecture

This agent provides comprehensive financial intelligence by combining:

- **Supabase Database**: Real-time stock prices, market events, company data
- **MongoDB**: Institutional ownership data, macro economics, policy transcripts  
- **OpenAI GPT-4**: Advanced reasoning with function calling capabilities
- **DigitalOcean Agent Platform**: Scalable AI infrastructure with auto-scaling

## Features

### Data Sources
- 📈 **Real-time Stock Data**: Current prices, intraday charts, historical data
- 📅 **Market Events**: Earnings, FDA approvals, mergers, conferences with AI insights
- 🏛️ **Institutional Ownership**: Who owns what, position changes, ownership trends
- 🌍 **Macro Analysis**: Economic indicators, policy transcripts, market sentiment

### AI Capabilities
- 🤖 **Function Calling**: Intelligent data retrieval based on user questions
- 💬 **Conversational AI**: Natural language interaction with financial context
- 📊 **Multi-source Analysis**: Combines stock data with institutional and macro trends
- 🎯 **Portfolio Awareness**: Context-aware responses based on user's tracked stocks

## API Endpoints

### POST /chat
Main AI chat interface with function calling capabilities.

**Request:**
```json
{
  "message": "What's the institutional ownership for AAPL?",
  "conversationHistory": [...],
  "selectedTickers": ["AAPL", "TSLA"]
}
```

**Response:**
```json
{
  "response": "Based on the latest institutional ownership data...",
  "functionCalls": 2,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "mongodb": true,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

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

## Function Tools

The AI agent has access to these function tools:

### get_stock_data
- **Purpose**: Fetch stock price data from Supabase
- **Parameters**: `symbol` (required), `dataType` (current/intraday/daily)
- **Data Source**: Supabase tables (finnhub_quote_snapshots, intraday_prices, daily_prices)

### get_events  
- **Purpose**: Retrieve market events and earnings
- **Parameters**: `ticker`, `type[]`, `upcoming`, `limit`
- **Data Source**: Supabase event_data table

### get_institutional_data
- **Purpose**: Fetch institutional ownership information
- **Parameters**: `symbol` (required)  
- **Data Source**: MongoDB institutional_ownership collection

### get_macro_data
- **Purpose**: Get macro economic data and policy info
- **Parameters**: `category` (economic/policy/news)
- **Data Source**: MongoDB macro_economics, government_policy, market_news collections

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables in `.env`

3. Start the agent:
```bash
node agent.js
```

4. Test the API:
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are AAPL earnings this quarter?"}'
```

## DigitalOcean Agent Platform Deployment

This agent is designed for DigitalOcean Agent Platform with:
- **Auto-scaling**: Handles traffic spikes automatically
- **Native MongoDB**: Direct connection to DigitalOcean MongoDB
- **Multi-agent Workflows**: Can be extended with specialized agents
- **RAG Capabilities**: Vector search integration ready

### Deployment Configuration

The agent automatically configures for:
- MongoDB connection pooling (max 10 connections)
- 30-second timeouts for external calls
- CORS enabled for web app integration
- Health monitoring endpoints

## Integration with Catalyst App

Replace the Supabase Edge Function call in your mobile app:

**Before (Edge Function):**
```typescript
const { data } = await supabase.functions.invoke('index', {
  body: { message, conversationHistory }
})
```

**After (Agent Platform):**
```typescript
const response = await fetch('https://your-agent.do.app/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, conversationHistory, selectedTickers })
})
```

## Benefits over Edge Functions

1. **Direct MongoDB Access**: No proxy needed, native connectivity
2. **Advanced AI Features**: Multi-agent workflows, RAG, vector search
3. **Auto-scaling**: Handles traffic without cold starts
4. **Function Calling**: Intelligent data retrieval vs static responses
5. **Future-proof**: Platform designed for AI workloads

## Monitoring

- Health endpoint: `GET /health`
- Logs: DigitalOcean App Platform logs
- Metrics: Built-in Agent Platform monitoring
- Alerts: Configure based on health check failures

---

Built for future-proof AI capabilities with seamless data integration across Supabase and MongoDB.