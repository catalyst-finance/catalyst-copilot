/**
 * Thinking Message Generator
 * Shared service for generating contextual AI status messages
 * 
 * Version: 1.0
 * Used by: QueryEngine.js, ResponseEngine.js
 */

const openai = require('./openai');
const { getCollectionFriendlyName } = require('./prompts/schema-context');

/**
 * Generate contextual thinking message using AI
 * @param {string} phase - The current processing phase
 * @param {object} context - Context for the thinking message
 * @returns {string|null} Generated thinking message
 */
async function generateThinkingMessage(phase, context = {}) {
  const prompt = buildPromptForPhase(phase, context);
  if (!prompt) return null;
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 15
    });
    
    // Sanitize: remove quotes and the word "now"
    const raw = response.choices[0].message.content || '';
    return raw.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
  } catch (error) {
    console.error('Thinking message generation failed, using fallback');
    return getFallbackMessage(phase, context);
  }
}

/**
 * Build prompt based on phase
 */
function buildPromptForPhase(phase, context) {
  switch (phase) {
    // Query Engine phases
    case 'query_start':
      return `Generate a 2-4 word thinking status for starting to analyze a financial question. Examples: "Analyzing question", "Processing query". Return ONLY the status text.`;
    
    case 'government_policy':
      const speaker = context.speaker || 'officials';
      const policyDate = context.date ? ` from ${context.date}` : '';
      return `Generate a 3-5 word thinking status for searching government statements from "${speaker}"${policyDate}. Examples: "Searching Trump Jan 5 remarks", "Finding Biden policy statements". Return ONLY the status text.`;
    
    case 'sec_filings':
      const ticker = context.ticker || 'company';
      const filingType = context.formType ? ` ${context.formType}` : '';
      return `Generate a 3-5 word thinking status for looking up${filingType} SEC filings for ${ticker}. Examples: "Checking AAPL 10-Q", "Finding TSLA 8-K filings". Return ONLY the status text.`;
    
    case 'news':
      const newsTicker = context.ticker ? ` for ${context.ticker}` : '';
      return `Generate a 3-5 word thinking status for searching news${newsTicker}. Examples: "Scanning TSLA news", "Finding recent headlines". Return ONLY the status text.`;
    
    case 'price_data':
      const priceTicker = context.ticker || (context.tickers && context.tickers.length > 0 ? context.tickers[0] : null);
      const priceContext = priceTicker ? ` for ${priceTicker}` : '';
      return `Generate a 3-5 word thinking status for getting stock prices${priceContext}. Examples: "Getting AAPL price", "Fetching market quotes". Return ONLY the status text.`;
    
    // Response Engine phases
    case 'plan_start':
      const collections = (context.collections || []).map(c => getCollectionFriendlyName(c)).join(', ');
      const count = context.totalResults || context.count;
      const countText = count ? ` (${count} items)` : '';
      return `Generate a 3-5 word thinking status for planning how to format ${collections || 'results'}${countText}. Examples: "Organizing 5 filings", "Planning SEC analysis". Return ONLY the status text.`;
    
    case 'plan_generated':
      const strategy = context.plan?.overallStrategy;
      const planItemCount = context.plan?.formattingPlan?.length;
      if (strategy && planItemCount) {
        return `Generate a 3-5 word thinking status for organizing ${planItemCount} data sources based on: "${strategy.substring(0, 50)}". Examples: "Structuring filing analysis", "Organizing price data". Return ONLY the status text.`;
      }
      return `Generate a 3-5 word thinking status for organizing analysis. Return ONLY the status text.`;
    
    case 'fetching_content':
      const collectionName = getCollectionFriendlyName(context.collection);
      const fetchItemCount = context.count || 1;
      const specificItem = context.title ? ` "${context.title.substring(0, 30)}..."` : '';
      return `Generate a 3-5 word thinking status for fetching ${fetchItemCount > 1 ? fetchItemCount : ''} ${collectionName}${specificItem}. Examples: "Reading AAPL 10-Q", "Loading Jan 5 transcript". Return ONLY the status text.`;
    
    case 'formatting':
      const formattingCollection = context.collection ? getCollectionFriendlyName(context.collection) : null;
      const formattingContext = formattingCollection ? ` ${formattingCollection}` : '';
      return `Generate a 3-5 word thinking status for formatting${formattingContext} response. Examples: "Formatting filing analysis", "Building price summary". Return ONLY the status text.`;
    
    default:
      return null;
  }
}

/**
 * Fallback messages if AI generation fails
 */
function getFallbackMessage(phase, context) {
  switch (phase) {
    case 'query_start':
      return 'Analyzing question';
    
    case 'government_policy':
      const speaker = context.speaker || 'government';
      const date = context.date ? ` ${context.date}` : '';
      return `Searching ${speaker}${date} statements`;
    
    case 'sec_filings':
      const ticker = context.ticker || 'company';
      const formType = context.formType ? ` ${context.formType}` : '';
      return `Checking ${ticker}${formType} filings`;
    
    case 'news':
      const newsTicker = context.ticker ? ` ${context.ticker}` : '';
      return `Scanning${newsTicker} news`;
    
    case 'price_data':
      const priceTicker = context.ticker || (context.tickers && context.tickers.length > 0 ? context.tickers[0] : null);
      return priceTicker ? `Getting ${priceTicker} price` : 'Getting prices';
    
    case 'plan_start':
      const count = context.totalResults || context.count;
      const countText = count ? ` ${count}` : '';
      return `Planning${countText} results`;
    
    case 'plan_generated':
      const planItemCount = context.plan?.formattingPlan?.length;
      return planItemCount ? `Organizing ${planItemCount} sources` : 'Organizing analysis';
    
    case 'fetching_content':
      const collectionName = getCollectionFriendlyName(context.collection || 'content');
      const fetchCount = context.count || 1;
      return fetchCount > 1 ? `Loading ${fetchCount} ${collectionName}` : `Loading ${collectionName}`;
    
    case 'formatting':
      const formattingCollection = context.collection ? getCollectionFriendlyName(context.collection) : null;
      return formattingCollection ? `Formatting ${formattingCollection}` : 'Formatting response';
    
    default:
      return 'Processing';
  }
}

module.exports = {
  generateThinkingMessage,
  getFallbackMessage
};
