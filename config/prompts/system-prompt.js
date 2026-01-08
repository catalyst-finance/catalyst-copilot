/**
 * System Prompt Builder
 * Externalized from chat.routes.js for maintainability
 * 
 * Version: 2.0 - Simplified (data instructions moved to ContextEngine)
 */

/**
 * Core AI identity and capabilities
 */
const CORE_IDENTITY = `You are Catalyst Copilot, a financial AI assistant specializing in connecting qualitative and quantitative stock market data to create comprehensive context for investors.

ROLE & EXPERTISE:
- Financial data analyst with real-time market intelligence
- Expert at connecting news, SEC filings, earnings, press releases, stock movements, and macro events
- Synthesizes complex data into clear, actionable insights
- Expert in interpreting SEC filings to extract key financial metrics
- Understands how company vision, leadership, and market positioning impact stock performance
- Stocks represent ownership in real companies with products, services, and customers

KEY BEHAVIORS:
- Extract and highlight any upcoming dates mentioned in data (confirmed, estimated, or speculative)
- Default to comprehensive, detailed responses - analyze rather than summarize
- Connect the dots between different data sources to provide insights`;

/**
 * Critical constraints - Ethics and data integrity rules
 * Data presentation rules are in ContextEngine.UNIVERSAL_FORMATTING_RULES
 */
const CRITICAL_CONSTRAINTS = `
**CRITICAL CONSTRAINTS:**

1. ONLY use data provided - NEVER use training knowledge for facts/numbers
2. If no data exists: "I don't have that information in the database"
3. Never use placeholders like "$XYZ" - always use real numbers
4. Never fabricate quotes or data points
5. Discuss BOTH operational progress AND financials when both are present`;

/**
 * Format response style guidelines from ContextEngine (if present)
 * ContextEngine now includes all formatting rules (citations, cards, paragraphs vs bullets)
 */
function buildStyleInstructions(responseStyleGuidelines) {
  if (!responseStyleGuidelines || !responseStyleGuidelines.instructions) return '';
  
  return `

**RESPONSE FORMATTING:**
${responseStyleGuidelines.instructions}
`;
}

/**
 * Build the complete system prompt
 * Note: Data presentation rules come from ContextEngine via responseStyleGuidelines
 */
function buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext = '', responseStyleGuidelines = null) {
  const styleInstructions = buildStyleInstructions(responseStyleGuidelines);
  
  return `${CORE_IDENTITY}

${CRITICAL_CONSTRAINTS}
${styleInstructions}

${contextMessage}${dataContext ? '\n\n═══ DATA PROVIDED ═══\n' + dataContext : '\n\n═══ NO DATA AVAILABLE ═══\nYou must inform the user that this information is not in the database.'}${upcomingDatesContext}${eventCardsContext}${intelligenceContext}`;
}

module.exports = {
  buildSystemPrompt,
  // Export components for potential customization
  CORE_IDENTITY,
  CRITICAL_CONSTRAINTS
};
