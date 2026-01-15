/**
 * Catalyst Copilot - Main Server Entry Point
 * Financial AI Agent with real-time market data and streaming responses
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { connectMongo, isMongoConnected } = require('./config/database');
const corsOptions = require('./config/cors');

// Import routes
const authRoutes = require('./routes/auth.routes');
const watchlistRoutes = require('./routes/watchlist.routes');
const conversationRoutes = require('./routes/conversation.routes');
const chatRoutes = require('./routes/chat.routes');
const quoteRoutes = require('./routes/quote.routes');
const priceTargetsRoutes = require('./routes/price-targets.routes');
const mongodbRoutes = require('./routes/mongodb.routes');
const { handleChatWebSocket } = require('./routes/websocket.routes');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws/chat'
});

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json());

// WebSocket connection handler
wss.on('connection', handleChatWebSocket);

console.log('🔌 WebSocket server initialized on /ws/chat');

// Mount routes
app.use('/auth', authRoutes);
app.use('/watchlists', watchlistRoutes);
app.use('/conversations', conversationRoutes);
app.use('/chat', chatRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/price-targets', priceTargetsRoutes);
app.use('/api/mongodb', mongodbRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    mongodb: isMongoConnected(),
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Catalyst Copilot API',
    version: '1.0.0',
    description: 'Financial AI Agent with real-time market intelligence',
    endpoints: {
      health: '/health',
      auth: '/auth/*',
      watchlists: '/watchlists/*',
      conversations: '/conversations/*',
      chat: '/chat',
      quote: '/api/quote/:symbol',
      priceTargets: '/api/price-targets/:symbol',
      mongodb: '/api/mongodb/:collection'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize and start server
async function start() {
  try {
    // Connect to MongoDB on startup
    await connectMongo();
    
    server.listen(port, () => {
      console.log(`🚀 Catalyst AI Agent running on port ${port}`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${port}/ws/chat`);
      console.log(`📊 Connected to Supabase: ${!!process.env.SUPABASE_URL}`);
      console.log(`🗄️  Connected to MongoDB: ${isMongoConnected()}`);
      console.log(`🤖 OpenAI API configured: ${!!process.env.OPENAI_API_KEY}`);
    });
  } catch (error) {
    console.error('Failed to start agent:', error);
    process.exit(1);
  }
}

start();
