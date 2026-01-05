/**
 * Database Configuration
 * MongoDB and Supabase client initialization
 */

const { MongoClient } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// MongoDB client setup
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  family: 4,
});

let mongoConnected = false;

// Connect to MongoDB
async function connectMongo() {
  if (!mongoConnected) {
    try {
      await mongoClient.connect();
      await mongoClient.db().admin().ping();
      mongoConnected = true;
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }
  return mongoClient;
}

function isMongoConnected() {
  return mongoConnected;
}

module.exports = {
  supabase,
  mongoClient,
  connectMongo,
  isMongoConnected
};
