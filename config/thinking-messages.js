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
      return `Generate a 2-4 word thinking status for searching government statements from "${speaker}". Examples: "Searching Trump remarks", "Finding policy statements". Return ONLY the status text.`;
    
    case 'sec_filings':
      const ticker = context.ticker || 'company';
      return `Generate a 2-4 word thinking status for looking up SEC filings for ${ticker}. Examples: "Checking SEC filings", "Finding ${ticker} reports". Return ONLY the status text.`;
    
    case 'news':
      return `Generate a 2-4 word thinking status for searching news. Examples: "Scanning news", "Finding headlines". Return ONLY the status text.`;
    
    case 'price_data':
      return `Generate a 2-4 word thinking status for getting stock prices. Examples: "Getting prices", "Fetching quotes". Return ONLY the status text.`;
    
    // Response Engine phases
    case 'plan_start':
      const collections = (context.collections || []).map(c => getCollectionFriendlyName(c)).join(', ');
      return `Generate a 2-4 word thinking status for planning how to format ${collections || 'results'}. Examples: "Planning response", "Organizing data". Return ONLY the status text.`;
    
    case 'plan_generated':
      const strategy = context.plan?.overallStrategy;
      if (strategy) {
        return `Generate a 2-4 word thinking status based on this formatting strategy: "${strategy.substring(0, 50)}". Examples: "Structuring analysis", "Preparing insights". Return ONLY the status text.`;
      }
      return `Generate a 2-4 word thinking status for organizing analysis. Return ONLY the status text.`;
    
    case 'fetching_content':
      const collectionName = getCollectionFriendlyName(context.collection);
      return `Generate a 2-4 word thinking status for fetching full content from ${collectionName}. Examples: "Reading filing", "Loading article". Return ONLY the status text.`;
    
    case 'formatting':
      return `Generate a 2-4 word thinking status for formatting the response. Examples: "Formatting response", "Building answer". Return ONLY the status text.`;
    
    default:
      return null;
  }
}

/**
 * Fallback messages if AI generation fails
 */
function getFallbackMessage(phase, context) {
  const fallbacks = {
    'query_start': 'Analyzing question',
    'government_policy': `Searching ${context.speaker || 'government'} statements`,
    'sec_filings': `Checking ${context.ticker || 'SEC'} filings`,
    'news': 'Scanning news',
    'price_data': 'Getting prices',
    'plan_start': 'Planning response',
    'plan_generated': 'Organizing analysis',
    'fetching_content': `Loading ${getCollectionFriendlyName(context.collection || 'content')}`,
    'formatting': 'Formatting response'
  };
  
  return fallbacks[phase] || 'Processing';
}

module.exports = {
  generateThinkingMessage,
  getFallbackMessage
};
