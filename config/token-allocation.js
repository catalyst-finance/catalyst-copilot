/**
 * Token Allocation System
 * Dynamic token budgets based on query complexity
 * 
 * Industry-standard approach: Tiered allocation with AI-selected tier
 * Benefits: Predictable costs, easy monitoring, 40-60% savings on simple queries
 */

/**
 * Complexity tiers with token budgets
 */
const COMPLEXITY_TIERS = {
  minimal: {
    level: 1,
    description: 'Simple lookup (stock price, quick fact)',
    responseTokens: 1000,
    planTokens: 500,
    queryTokens: 800
  },
  brief: {
    level: 2,
    description: 'Basic query (news headlines, filing list)',
    responseTokens: 4000,
    planTokens: 1000,
    queryTokens: 1200
  },
  standard: {
    level: 3,
    description: 'Standard analysis (moderate data, thematic)',
    responseTokens: 8000,
    planTokens: 1500,
    queryTokens: 1500
  },
  detailed: {
    level: 4,
    description: 'Detailed analysis (multiple sources, deep dive)',
    responseTokens: 12000,
    planTokens: 2000,
    queryTokens: 1500
  },
  comprehensive: {
    level: 5,
    description: 'Comprehensive analysis (extensive sources, deep analysis)',
    responseTokens: 16000,
    planTokens: 2500,
    queryTokens: 1500
  }
};

/**
 * Calculate complexity tier based on query characteristics
 * 
 * @param {Object} queryPlan - The query plan from QueryEngine
 * @returns {string} Tier name: 'minimal', 'brief', 'standard', 'detailed', or 'comprehensive'
 */
function calculateComplexityTier(queryPlan) {
  let score = 0;
  
  // Factor 1: Number of data sources (queries)
  const numQueries = queryPlan.queries?.length || 0;
  if (numQueries === 0) score += 0;
  else if (numQueries === 1) score += 1;
  else if (numQueries <= 3) score += 2;
  else if (numQueries <= 5) score += 3;
  else score += 4;
  
  // Factor 2: Deep analysis flag (strong signal for complexity)
  if (queryPlan.needsDeepAnalysis) {
    score += 3;
  }
  
  // Factor 3: Content fetching requirements
  const hasContentFetch = queryPlan.queries?.some(q => 
    ['news', 'sec_filings', 'government_policy', 'economic_data'].includes(q.collection)
  );
  if (hasContentFetch && queryPlan.needsDeepAnalysis) {
    score += 2;
  }
  
  // Factor 4: Chart requirements (adds visualization complexity)
  if (queryPlan.needsChart) {
    score += 1;
  }
  
  // Factor 5: Multiple collections (indicates broad analysis)
  const uniqueCollections = new Set(queryPlan.queries?.map(q => q.collection) || []).size;
  if (uniqueCollections >= 4) score += 2;
  else if (uniqueCollections >= 3) score += 1;
  
  // Map score to tier
  if (score <= 2) return 'minimal';
  if (score <= 4) return 'brief';
  if (score <= 7) return 'standard';
  if (score <= 10) return 'detailed';
  return 'comprehensive';
}

/**
 * Get token budget for a specific component based on tier
 * 
 * @param {string} tier - Complexity tier name
 * @param {string} component - Component name: 'response', 'plan', or 'query'
 * @returns {number} Token limit
 */
function getTokenBudget(tier, component) {
  const tierConfig = COMPLEXITY_TIERS[tier] || COMPLEXITY_TIERS.standard;
  
  switch (component) {
    case 'response':
      return tierConfig.responseTokens;
    case 'plan':
      return tierConfig.planTokens;
    case 'query':
      return tierConfig.queryTokens;
    default:
      return tierConfig.responseTokens;
  }
}

/**
 * Get tier information for logging/debugging
 * 
 * @param {string} tier - Complexity tier name
 * @returns {Object} Tier configuration
 */
function getTierInfo(tier) {
  return COMPLEXITY_TIERS[tier] || COMPLEXITY_TIERS.standard;
}

/**
 * Calculate estimated cost for a tier
 * gpt-4o pricing (as of 2026): $2.50 input / $10 output per 1M tokens
 * 
 * @param {string} tier - Complexity tier name
 * @param {number} inputTokens - Estimated input tokens
 * @returns {Object} Cost breakdown
 */
function estimateCost(tier, inputTokens = 5000) {
  const outputTokens = getTokenBudget(tier, 'response');
  
  const inputCost = (inputTokens / 1000000) * 2.50;
  const outputCost = (outputTokens / 1000000) * 10.00;
  const totalCost = inputCost + outputCost;
  
  return {
    tier,
    inputTokens,
    outputTokens,
    inputCost: inputCost.toFixed(4),
    outputCost: outputCost.toFixed(4),
    totalCost: totalCost.toFixed(4)
  };
}

module.exports = {
  COMPLEXITY_TIERS,
  calculateComplexityTier,
  getTokenBudget,
  getTierInfo,
  estimateCost
};
