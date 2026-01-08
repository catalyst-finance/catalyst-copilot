/**
 * Catalyst API Server - Lightweight Data Endpoints
 * Separate service for API endpoints (price targets, quotes, etc.)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectMongo, isMongoConnected } = require('./config/database');
const corsOptions = require('./config/cors');

// Import API routes only (no AI/chat routes)
const priceTargetsRoutes = require('./routes/price-targets.routes');
const quoteRoutes = require('./routes/quote.routes');

// Initialize Express app
const app = express();
const port = process.env.PORT || 8080;

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json());

// Mount API routes
app.use('/api/price-targets', priceTargetsRoutes);
app.use('/api/quote', quoteRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'catalyst-api',
    mongodb: isMongoConnected(),
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Catalyst API Service',
    version: '1.0.0',
    description: 'Lightweight API endpoints for market data',
    endpoints: {
      health: '/health',
      priceTargets: '/api/price-targets/:symbol',
      quote: '/api/quote/:symbol'
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
    
    app.listen(port, () => {
      console.log(`🚀 Catalyst API Service running on port ${port}`);
      console.log(`🗄️  Connected to MongoDB: ${isMongoConnected()}`);
    });
  } catch (error) {
    console.error('Failed to start API service:', error);
    process.exit(1);
  }
}

start();
