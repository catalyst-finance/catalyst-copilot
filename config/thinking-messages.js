/**
 * Thinking Message Generator
 * Shared service for generating contextual AI status messages
 * 
 * PERFORMANCE NOTE:
 * - Fallback mode (USE_AI_FOR_THINKING=false): ~0ms latency, intelligent context-aware messages
 * - AI mode (USE_AI_FOR_THINKING=true): ~300ms per call, ~1-2s total latency per query
 * 
 * The fallback logic is highly intelligent - it composes natural messages from actual
 * context (tickers, counts, titles, dates). Most users won't notice a difference.
 * 
 * Cost impact of AI mode: ~$0.0002 per query (negligible, but latency matters more)
 * 
 * Version: 2.0
 * Used by: QueryEngine.js, ContextEngine.js
 */

const openai = require('./openai');
const { getCollectionFriendlyName } = require('./prompts/schema-context');

// Configuration: Use AI for thinking messages? (Set to false for better performance)
const USE_AI_FOR_THINKING = false;

/**
 * Generate contextual thinking message
 * Uses intelligent fallbacks by default for speed (~0ms vs ~300ms per AI call)
 * Set USE_AI_FOR_THINKING=true to enable AI generation (adds ~1-2s latency per query)
 * 
 * @param {string} phase - The current processing phase
 * @param {object} context - Context for the thinking message
 * @returns {string|null} Generated thinking message
 */
async function generateThinkingMessage(phase, context = {}) {
  // Performance optimization: Use intelligent fallbacks by default
  // Fallbacks are context-aware and compose messages from actual data
  if (!USE_AI_FOR_THINKING) {
    return getFallbackMessage(phase, context);
  }
  
  // AI generation (optional, adds latency)
  const prompt = buildPromptForPhase(phase, context);
  if (!prompt) return null;
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
      max_completion_tokens: 15  // Use max_completion_tokens (excludes prompt from limit)
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Thinking message generation failed, using fallback');
    return getFallbackMessage(phase, context);
  }
}

/**
 * Compose a natural message from context details
 */
function composeMessage(action, details) {
  const parts = [action];
  
  // Add specific details in natural order
  if (details.ticker) parts.push(details.ticker);
  if (details.formType) parts.push(details.formType);
  if (details.count && details.count > 1) parts.push(`(${details.count})`);
  if (details.collection) parts.push(details.collection);
  if (details.date) parts.push(details.date);
  if (details.speaker) parts.push(details.speaker);
  
  return parts.join(' ');
}

/**
 * Build prompt based on phase - let AI be creative with actual context
 */
function buildPromptForPhase(phase, context) {
  // Build a natural description of what we're doing with ACTUAL details
  let description = '';
  
  switch (phase) {
    case 'query_start':
      return `Write a brief 2-4 word status for starting to analyze a financial question. Be natural and professional. Return ONLY the status text, no quotes or punctuation at end.`;
    
    case 'government_policy':
      const speaker = context.speaker || 'government officials';
      const date = context.date || 'recent';
      description = `searching for ${date} statements from ${speaker}`;
      break;
    
    case 'sec_filings':
      const ticker = context.ticker || 'company';
      const formType = context.formType || 'SEC';
      description = `looking up ${formType} filings for ${ticker}`;
      break;
    
    case 'news':
      const newsTicker = context.ticker || 'companies';
      description = `scanning recent news about ${newsTicker}`;
      break;
    
    case 'price_data':
      const priceTicker = context.ticker || (context.tickers && context.tickers.length > 0 ? context.tickers[0] : 'stocks');
      description = `getting current price data for ${priceTicker}`;
      break;
    
    case 'plan_start':
      // Filter out stock price data collections
      const filteredCollections = (context.collections || []).filter(c => 
        c !== 'finnhub_quote_snapshots' && 
        c !== 'one_minute_prices' && 
        c !== 'daily_prices'
      );
      
      if (filteredCollections.length === 0) return null;
      
      const collections = filteredCollections.map(c => getCollectionFriendlyName(c)).join(' and ');
      const count = context.totalResults || context.count;
      description = count 
        ? `organizing ${count} items from ${collections}`
        : `planning how to present ${collections}`;
      break;
    
    case 'plan_generated':
      const strategy = context.plan?.overallStrategy;
      const itemCount = context.plan?.formattingPlan?.length;
      if (strategy) {
        description = `structuring ${itemCount || ''} sources: ${strategy.substring(0, 40)}`;
      } else {
        description = 'organizing the analysis';
      }
      break;
    
    case 'fetching_content':
      const collectionName = getCollectionFriendlyName(context.collection);
      const fetchCount = context.count || 1;
      const title = context.title ? context.title.substring(0, 30) : null;
      if (title) {
        description = `reading "${title}..." from ${collectionName}`;
      } else if (fetchCount > 1) {
        description = `loading ${fetchCount} ${collectionName}`;
      } else {
        description = `reading ${collectionName}`;
      }
      break;
    
    case 'formatting':
      // Filter out stock price data collections
      if (context.collection === 'finnhub_quote_snapshots' || 
          context.collection === 'one_minute_prices' || 
          context.collection === 'daily_prices') {
        return null;
      }
      
      const formatCollection = context.collection ? getCollectionFriendlyName(context.collection) : 'data';
      const formatCount = context.count || 0;
      const formatTicker = context.ticker;
      
      if (formatTicker && formatCount > 0) {
        description = `formatting ${formatCount} ${formatCollection} items for ${formatTicker}`;
      } else if (formatCount > 0) {
        description = `formatting ${formatCount} ${formatCollection} items`;
      } else {
        description = `formatting ${formatCollection}`;
      }
      break;
    
    default:
      return null;
  }
  
  if (!description) return null;
  
  return `Write a natural, specific 3-5 word status message for: ${description}. Be concise, professional, and specific. Use the actual details provided. Return ONLY the status text, no quotes or punctuation at end.`;
}

/**
 * Intelligent fallback messages - compose dynamically from context
 */
function getFallbackMessage(phase, context) {
  switch (phase) {
    case 'query_start':
      return 'Analyzing question';
    
    case 'government_policy': {
      const speaker = context.speaker || 'government';
      const date = context.date ? ` ${context.date}` : '';
      return `Searching ${speaker}${date}`;
    }
    
    case 'sec_filings': {
      const ticker = context.ticker || 'company';
      const formType = context.formType;
      return formType ? `Checking ${ticker} ${formType}` : `Checking ${ticker} filings`;
    }
    
    case 'news': {
      const ticker = context.ticker;
      return ticker ? `Scanning ${ticker} news` : 'Scanning news';
    }
    
    case 'price_data': {
      const ticker = context.ticker || (context.tickers?.length > 0 ? context.tickers[0] : null);
      return ticker ? `Getting ${ticker} price` : 'Getting prices';
    }
    
    case 'plan_start': {
      const count = context.totalResults || context.count;
      const collections = context.collections?.length > 0 
        ? getCollectionFriendlyName(context.collections[0])
        : 'results';
      
      // Filter out stock price data collections
      const collection = context.collections?.[0];
      if (collection === 'finnhub_quote_snapshots' || 
          collection === 'one_minute_prices' || 
          collection === 'daily_prices') {
        return null; // Skip message for price data
      }
      
      return count ? `Organizing ${count} ${collections}` : `Planning ${collections}`;
    }
    
    case 'plan_generated': {
      const itemCount = context.plan?.formattingPlan?.length;
      return itemCount ? `Structuring ${itemCount} sources` : 'Organizing analysis';
    }
    
    case 'fetching_content': {
      const collection = getCollectionFriendlyName(context.collection || 'content');
      const count = context.count || 1;
      const title = context.title?.substring(0, 20);
      
      if (title) return `Reading ${title}...`;
      if (count > 1) return `Loading ${count} ${collection}`;
      return `Reading ${collection}`;
    }
    
    case 'formatting': {
      const collection = context.collection ? getCollectionFriendlyName(context.collection) : null;
      const count = context.count || 0;
      const ticker = context.ticker;
      
      // Filter out stock price data collections
      if (context.collection === 'finnhub_quote_snapshots' || 
          context.collection === 'one_minute_prices' || 
          context.collection === 'daily_prices') {
        return null; // Skip message for price data
      }
      
      // News collection: the actual work is fetching metadata, not formatting
      if (context.collection === 'news') {
        if (ticker && count > 0) return `Loading ${count} ${ticker} articles`;
        if (count > 0) return `Loading ${count} articles`;
        return 'Loading articles';
      }
      
      if (ticker && count > 0) return `Formatting ${ticker} (${count})`;
      if (count > 0 && collection) return `Formatting ${count} ${collection}`;
      if (collection) return `Formatting ${collection}`;
      return 'Formatting response';
    }
    
    default:
      return 'Processing';
  }
}

module.exports = {
  generateThinkingMessage,
  getFallbackMessage,
  USE_AI_FOR_THINKING  // Export for visibility/debugging
};
