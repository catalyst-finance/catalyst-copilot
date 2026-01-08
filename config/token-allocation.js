/**
 * AI-Driven Token Allocation System
 * Uses GPT-4o-mini to intelligently allocate token budgets based on query complexity
 * 
 * Benefits: Adaptive budgets, optimal token usage, context-aware allocation
 */

const openai = require('./openai');

/**
 * AI-driven token budget allocation
 * Analyzes query context and dynamically allocates tokens
 * 
 * @param {Object} queryPlan - The query plan from QueryEngine
 * @param {string} userMessage - The user's original question
 * @returns {Promise<Object>} Token allocation with reasoning
 */
async function allocateTokenBudget(queryPlan, userMessage) {
  const prompt = `You are a token allocation optimizer for an AI financial research assistant. Analyze this query and allocate optimal token budgets.

**User Question:** "${userMessage}"

**Query Plan Summary:**
- Number of data sources: ${queryPlan.queries?.length || 0}
- Collections: ${(queryPlan.queries || []).map(q => q.collection).join(', ')}
- Deep analysis required: ${queryPlan.needsDeepAnalysis !== false}
- Needs chart: ${queryPlan.needsChart || false}
- Analysis keywords: ${(queryPlan.analysisKeywords || []).join(', ')}

**Token Budget Guidelines:**

**Response Tokens** (AI's answer to user):
- 1,000-2,000: Simple lookup (price, date, single fact)
- 3,000-5,000: Brief summary (headlines, basic list)
- 6,000-9,000: Standard analysis (moderate depth, few sources)
- 10,000-14,000: Detailed analysis (multiple sources, deeper dive)
- 15,000-20,000: Comprehensive analysis (extensive sources, full deep dive)

**Plan Tokens** (formatting plan generation):
- 500-800: Simple queries with 1-2 sources
- 1,000-1,500: Standard queries with 3-5 sources
- 1,800-2,500: Complex queries with 6+ sources

**Query Tokens** (database query generation):
- 800-1,200: Basic queries (1-2 data sources)
- 1,300-1,500: Standard queries (3-5 data sources)

**Allocation Principles:**
1. Simple queries (price, quick fact) → minimal tokens
2. Deep analysis with SEC filings → higher response tokens (12K-16K)
3. Multiple data sources → increase plan tokens
4. Broad analysis across collections → balanced allocation
5. Always leave 15-20% buffer for safety

Return JSON:
{
  "responseTokens": 8000,
  "planTokens": 1500,
  "queryTokens": 1200,
  "tier": "standard",
  "reasoning": "Standard analysis with moderate depth - 3 sources, no deep filing analysis"
}

Return ONLY valid JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_completion_tokens: 300,
      response_format: { type: "json_object" }
    });

    const allocation = JSON.parse(response.choices[0].message.content.trim());
    console.log(`🎯 AI Token Allocation: ${allocation.tier} tier - ${allocation.responseTokens}/${allocation.planTokens}/${allocation.queryTokens} tokens`);
    console.log(`   Reasoning: ${allocation.reasoning}`);
    
    return allocation;
  } catch (error) {
    console.error('❌ AI token allocation failed, using fallback:', error);
    return getFallbackAllocation(queryPlan);
  }
}

/**
 * Fallback allocation if AI fails
 */
function getFallbackAllocation(queryPlan) {
  const numQueries = queryPlan.queries?.length || 0;
  const needsDeep = queryPlan.needsDeepAnalysis !== false;
  
  if (numQueries <= 1 && !needsDeep) {
    return { responseTokens: 2000, planTokens: 600, queryTokens: 1000, tier: 'minimal', reasoning: 'Fallback: simple query' };
  } else if (numQueries <= 3 && !needsDeep) {
    return { responseTokens: 5000, planTokens: 1200, queryTokens: 1200, tier: 'brief', reasoning: 'Fallback: basic query' };
  } else if (needsDeep && numQueries <= 3) {
    return { responseTokens: 12000, planTokens: 2000, queryTokens: 1500, tier: 'detailed', reasoning: 'Fallback: deep analysis' };
  } else {
    return { responseTokens: 8000, planTokens: 1500, queryTokens: 1500, tier: 'standard', reasoning: 'Fallback: standard' };
  }
}

/**
 * Get token budget for a specific component (backward compatibility)
 * 
 * @param {Object|string} tierOrAllocation - Either allocation object or tier string
 * @param {string} component - Component name: 'response', 'plan', or 'query'
 * @returns {number} Token limit
 */
function getTokenBudget(tierOrAllocation, component) {
  // If passed an allocation object, extract the value
  if (typeof tierOrAllocation === 'object' && tierOrAllocation !== null) {
    switch (component) {
      case 'response': return tierOrAllocation.responseTokens;
      case 'plan': return tierOrAllocation.planTokens;
      case 'query': return tierOrAllocation.queryTokens;
      default: return tierOrAllocation.responseTokens;
    }
  }
  
  // Legacy tier-based fallback
  const tierDefaults = {
    minimal: { responseTokens: 2000, planTokens: 600, queryTokens: 1000 },
    brief: { responseTokens: 5000, planTokens: 1200, queryTokens: 1200 },
    standard: { responseTokens: 8000, planTokens: 1500, queryTokens: 1500 },
    detailed: { responseTokens: 12000, planTokens: 2000, queryTokens: 1500 },
    comprehensive: { responseTokens: 16000, planTokens: 2500, queryTokens: 1500 }
  };
  
  const tier = tierDefaults[tierOrAllocation] || tierDefaults.standard;
  switch (component) {
    case 'response': return tier.responseTokens;
    case 'plan': return tier.planTokens;
    case 'query': return tier.queryTokens;
    default: return tier.responseTokens;
  }
}

/**
 * Get tier information for logging (backward compatibility)
 */
function getTierInfo(tierOrAllocation) {
  if (typeof tierOrAllocation === 'object' && tierOrAllocation !== null) {
    return {
      tier: tierOrAllocation.tier,
      description: tierOrAllocation.reasoning,
      level: tierOrAllocation.tier === 'minimal' ? 1 : tierOrAllocation.tier === 'brief' ? 2 : tierOrAllocation.tier === 'standard' ? 3 : tierOrAllocation.tier === 'detailed' ? 4 : 5
    };
  }
  
  const tierDefaults = {
    minimal: { level: 1, description: 'Simple lookup' },
    brief: { level: 2, description: 'Basic query' },
    standard: { level: 3, description: 'Standard analysis' },
    detailed: { level: 4, description: 'Detailed analysis' },
    comprehensive: { level: 5, description: 'Comprehensive analysis' }
  };
  
  return tierDefaults[tierOrAllocation] || tierDefaults.standard;
}

/**
 * Calculate estimated cost
 * gpt-4o pricing: $2.50 input / $10 output per 1M tokens
 */
function estimateCost(allocation, inputTokens = 5000) {
  const outputTokens = typeof allocation === 'object' ? allocation.responseTokens : getTokenBudget(allocation, 'response');
  
  const inputCost = (inputTokens / 1000000) * 2.50;
  const outputCost = (outputTokens / 1000000) * 10.00;
  const totalCost = inputCost + outputCost;
  
  return {
    tier: typeof allocation === 'object' ? allocation.tier : allocation,
    inputTokens,
    outputTokens,
    inputCost: inputCost.toFixed(4),
    outputCost: outputCost.toFixed(4),
    totalCost: totalCost.toFixed(4)
  };
}

module.exports = {
  allocateTokenBudget,
  getTokenBudget,
  getTierInfo,
  estimateCost
};
