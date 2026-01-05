// DigitalOcean Function for MongoDB Access
// FREE: 90,000 requests/month

import { MongoClient } from 'mongodb';

// MongoDB client setup with connection pooling
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && cachedClient) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 30000,
  });

  await client.connect();
  const db = client.db('raw_data');
  
  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function main(args) {
  const { action, symbol, category } = args;

  try {
    const { db } = await connectToDatabase();

    switch (action) {
      case 'institutional': {
        const collection = db.collection('institutional_ownership');
        const data = await collection.find({
          ticker: symbol.toUpperCase()
        }).sort({ date: -1 }).limit(10).toArray();

        return {
          statusCode: 200,
          body: {
            success: true,
            data: data || [],
            source: 'mongodb',
            type: 'institutional'
          }
        };
      }

      case 'macro': {
        let collectionName;
        switch (category) {
          case 'economic':
            collectionName = 'macro_economics';
            break;
          case 'policy':
            collectionName = 'government_policy';
            break;
          case 'news':
            collectionName = 'market_news';
            break;
          default:
            collectionName = 'macro_economics';
        }

        const collection = db.collection(collectionName);
        const data = await collection.find({})
          .sort({ inserted_at: -1 })
          .limit(20)
          .toArray();

        return {
          statusCode: 200,
          body: {
            success: true,
            data: data || [],
            source: 'mongodb',
            type: `macro_${category || 'general'}`
          }
        };
      }

      default:
        return {
          statusCode: 400,
          body: {
            success: false,
            error: `Unknown action: ${action}`
          }
        };
    }

  } catch (error) {
    console.error('MongoDB error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message,
        source: 'mongodb'
      }
    };
  }
}
