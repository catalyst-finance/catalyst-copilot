/**
 * Formatting Rules for ResponseEngine
 * AI-driven formatting plan generation instructions
 * 
 * Version: 1.0
 */

/**
 * Response style options for AI to recommend
 */
const RESPONSE_STYLE_OPTIONS = `
**Response Style Options:**
- **structured_analysis**: Bold section headers with paragraphs for analysis; use bullets only for true lists (SEC filings, earnings)
- **chronological_narrative**: Timeline format with dates (government policy, roadmap)
- **comparison_format**: Side-by-side comparison (compare X vs Y)
- **executive_summary**: Brief overview with key takeaways (highlights, tldr)
- **detailed_breakdown**: In-depth sections with thorough explanation (analyze, explain)
- **list_format**: Numbered/bulleted list when presenting actual lists (list recent, show top 5)
- **conversational**: Natural flowing paragraphs (general questions)

**Tone Options:**
- **analytical**: Professional, data-focused, objective
- **concise**: Brief, to-the-point, minimal elaboration
- **comprehensive**: Detailed, thorough, includes context
- **explanatory**: Educational, walks through concepts`;

/**
 * Formatting standards all responses must follow
 */
const FORMATTING_STANDARDS = `
**FORMATTING STANDARDS (CRITICAL):**

1. **Section Headers**: Use markdown bold (** **) for all headers
   
2. **Spacing**:
   - ONE blank line before/after section headers
   - ONE blank line between content blocks
   - Never multiple consecutive blank lines
   
3. **Bullet Points vs Paragraphs (CRITICAL)**:
   - Use bullets ONLY for TRUE LISTS: multiple discrete items (3+ items ideal), key highlights, metrics, quick facts
   - Use paragraphs for narrative analysis, explanations, single points, or descriptions
   - NEVER use a bullet for a single descriptive paragraph - just write the paragraph
   - Complete thought per bullet when bullets are appropriate
   - Blank line before first bullet, after last bullet
   - NO blank lines between bullets in same list
   
   WRONG (single paragraph as bullet):
   • Regulatory Developments: This is a long paragraph with multiple sentences explaining one topic in narrative form. It continues with more analysis and implications.
   
   CORRECT (paragraph format):
   **Regulatory Developments**
   
   This is a paragraph with multiple sentences explaining one topic. It continues with more analysis and implications.
   
   CORRECT (true list with bullets):
   Key highlights from the filing:
   
   - Q1 revenue increased 15%
   - New product launch scheduled
   - CEO appointed to board
   
4. **Paragraphs (CRITICAL)**:
   - 2-5 related sentences per paragraph (NOT single sentences)
   - ONE blank line between paragraphs
   - NO blank lines within a paragraph
   
   WRONG:
   First sentence alone.
   
   Second sentence alone.
   
   CORRECT:
   First sentence begins the paragraph. Second sentence continues. Third completes the idea.

5. **Professional Structure**:
   - Lead with most important information
   - Group related information under clear headers
   - Use subsections to break up long sections`;

/**
 * Detail level decision criteria
 */
const DETAIL_LEVEL_RULES = `
**Detail Level Decisions:**

1. **Priority** (1-5): How important to answering the question?
2. **DetailLevel**:
   - summary: Just titles/headlines (less relevant data)
   - moderate: Key fields + brief excerpt (default)
   - detailed: All important fields + longer content
   - full: Everything including external content fetch
3. **FetchExternalContent**: Should we fetch full content from URLs?
4. **MaxItems**: How many items (1-30)

**CRITICAL PRINCIPLE - IF YOU PLAN TO REFERENCE IT, YOU MUST ANALYZE IT:**

For EVERY data source:
- Will the AI MENTION or REFERENCE this source? → fetchExternalContent: true, detailLevel: full
- Don't list documents without explaining their content

Ask: "Will the AI need to explain WHAT'S IN this source?"
- YES → fetchExternalContent: true, detailLevel: full
- NO (just need existence) → fetchExternalContent: false

**General Rules:**
- "analyze" or "details" → detailLevel: full, fetchExternalContent: true
- "highlights" or "summary" → detailLevel: moderate
- "list" or "recent" → detailLevel: summary
- Government policy transcripts are LONG - always limit maxItems to 5-10 max
- Price targets/ownership → moderate (no external content)`;

/**
 * Build the formatting plan prompt
 */
function buildFormattingPlanPrompt(userMessage, queryIntent, queryResultsSummary, schemaContext) {
  return `You are a data presentation optimizer. Based on the user's question and available data, decide how to format and present the information most effectively.

**User's Question:** "${userMessage}"
**Query Intent:** ${queryIntent.intent}
**Query Analysis Flags:**
- needsDeepAnalysis: ${queryIntent.needsDeepAnalysis || false}
- analysisKeywords: ${(queryIntent.analysisKeywords || []).join(', ')}

**Available Data Results:**
${JSON.stringify(queryResultsSummary, null, 2)}

${schemaContext}

**Your Task:**
Determine the optimal way to present this data. For each collection, decide:
1. Priority (1-5)
2. DetailLevel (summary | moderate | detailed | full)
3. FetchExternalContent (true/false)
4. FieldsToShow (array)
5. MaxItems (number)
6. FormattingNotes (string)

${DETAIL_LEVEL_RULES}

**CRITICAL TOKEN LIMITS:**
- Government policy transcripts are VERY long (often 50,000+ tokens)
- When using detailLevel: "full" for government_policy, NEVER set maxItems > 10
- Prefer maxItems: 3-5 for government_policy with full detail

${RESPONSE_STYLE_OPTIONS}

${FORMATTING_STANDARDS}

Return JSON:
{
  "formattingPlan": [
    {
      "collection": "sec_filings",
      "priority": 5,
      "detailLevel": "full",
      "fetchExternalContent": true,
      "fieldsToShow": ["form_type", "date", "url", "content"],
      "maxItems": 1,
      "formattingNotes": "User wants detailed SEC filing analysis"
    }
  ],
  "overallStrategy": "Lead with SEC filing analysis...",
  "responseStyle": {
    "format": "structured_analysis",
    "tone": "analytical",
    "instructions": "Use **bold headers** for sections..."
  }
}

Return ONLY valid JSON.`;
}

module.exports = {
  buildFormattingPlanPrompt,
  RESPONSE_STYLE_OPTIONS,
  FORMATTING_STANDARDS,
  DETAIL_LEVEL_RULES
};
