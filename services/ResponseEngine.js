/**
 * AI-Native Response Engine
 * Intelligently formats and prioritizes data for AI consumption
 * Replaces hardcoded formatting logic with adaptive, context-aware formatting
 */

const openai = require('../config/openai');

class ResponseEngine {
  constructor() {
    // Data schema context - what fields are available in each collection
    this.dataSchemaContext = `
**AVAILABLE DATA FIELDS BY COLLECTION:**

**MongoDB Collections:**

**government_policy:**
- title, date, participants (array), url
- turns: array of {speaker, text} - full transcript
- Full content already in database

**sec_filings:**
- ticker, form_type, publication_date, url
- Content must be fetched from URL for deep analysis
- May contain images/charts

**news:**
- title, ticker, published_at, origin, url, content (may be truncated)
- Content may need fetching from URL for full article

**press_releases:**
- title, ticker, date/published_date, url, content/summary
- Content may need fetching from URL

**earnings_transcripts:**
- ticker, quarter, year, report_date, content (full transcript)
- Full content already in database

**price_targets:**
- ticker, date, analyst, action, rating_change, price_target_change
- No external content to fetch

**macro_economics:**
- title, date, country, category, description, url
- Description may be short - might need URL content

**ownership:**
- ticker, holder_name, shares, shares_change, total_position_value, file_date
- No external content

**hype:**
- ticker, sentiment, buzz, social_sentiment
- No external content

**Supabase Collections (Quantitative Data):**

**finnhub_quote_snapshots (Real-time Prices):**
- symbol, timestamp
- c (current price), o (open), h (high), l (low), pc (previous close)
- d (daily $ change), dp (daily % change)
- Use for current stock prices and daily performance

**one_minute_prices (Intraday Data):**
- symbol, timestamp, open, high, low, close, volume
- 1-minute OHLCV bars for intraday analysis
- Use for price action around specific events

**daily_prices (Historical Data):**
- symbol, timestamp, open, high, low, close, volume
- Daily OHLCV bars for multi-day/week/month analysis
- Use for historical price trends and patterns

**company_information (Company Profile):**
- symbol, name, exchange, country, currency
- sector, industry, market_cap, shares_outstanding
- ipo_date, website_url, logo_url, phone, address
- Use for company metadata and fundamentals
`;
  }

  /**
   * Generate contextual thinking message for current phase using AI
   */
  async generateThinkingMessage(phase, context) {
    // Build a natural language prompt based on the phase
    let prompt = '';
    
    switch(phase) {
      case 'plan_start':
        const collections = context.collections.map(c => this.getCollectionFriendlyName(c)).join(' and ');
        prompt = `Write a 3-5 word status message saying you're looking up ${collections}. Use professional language. Words like "exploring", "investigating", "analyzing", "examining" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid overly enthusiastic phrases like "Just found", "Diving into", "Grabbing". Avoid database jargon like "querying", "extracting", "processing". Examples: "Analyzing ${collections}..." or "Investigating ${collections}..."`;
        break;
        
      case 'plan_generated':
        const priority = context.plan.formattingPlan.filter(p => p.priority >= 4);
        if (priority.length > 0) {
          const source = this.getCollectionFriendlyName(priority[0].collection);
          prompt = `Write a 3-5 word status message saying you found relevant ${source}. Use professional but straightforward language. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid overly enthusiastic phrases like "Just found", "Got some". Examples: "Found relevant filing..." or "Located ${source}..."`;
        } else {
          prompt = `Write a 3-5 word status message saying you found ${context.plan.formattingPlan.length} sources. Use professional but straightforward language. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Example: "Found ${context.plan.formattingPlan.length} sources..."`;
        }
        break;
        
      case 'fetching_content':
        const friendly = this.getCollectionFriendlyName(context.collection);
        const countText = context.count === 1 ? 'the' : `${context.count}`;
        prompt = `Write a 3-5 word status message saying you're reading ${countText} ${friendly}. Use professional language. Words like "exploring", "investigating", "analyzing", "examining" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid overly enthusiastic phrases like "Diving into", "Checking out". Avoid database jargon like "querying", "extracting", "processing". Examples: "Analyzing ${countText} ${friendly}..." or "Examining ${countText} ${friendly}..."`;
        break;
        
      case 'formatting':
        const collectionName = this.getCollectionFriendlyName(context.collection);
        prompt = `Write a 4-6 word status message saying you're pulling details from ${collectionName}. Use professional language. Words like "exploring", "investigating", "analyzing" are good. NEVER use exclamation marks. ALWAYS end with "..." (ellipsis). Avoid overly enthusiastic phrases like "Grabbing", "Just getting". Avoid database jargon like "extracting", "processing", "querying". Examples: "Analyzing details from ${collectionName}..." or "Investigating ${collectionName}..."`;
        break;
        
      default:
        return null;
    }
    
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 15,  // Very short messages only
      });
      
      // Sanitize: remove quotes and the word "now"
      const raw = response.choices[0].message.content || '';
      const sanitized = raw.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
      return sanitized;
    } catch (error) {
      console.error('Thinking message generation failed, using fallback');
      // Fallback to simple hardcoded messages
      return this.getFallbackThinkingMessage(phase, context);
    }
  }
  
  /**
   * Fallback thinking messages if AI generation fails
   */
  getFallbackThinkingMessage(phase, context) {
    const messages = {
      'plan_start': () => {
        const count = context.collections?.length || 0;
        if (count === 0) return 'Looking things up...';
        if (count === 1) {
          const friendly = this.getCollectionFriendlyName(context.collections[0]);
          return `Checking ${friendly}...`;
        }
        return `Checking ${count} sources...`;
      },
      'plan_generated': () => {
        const priority = context.plan?.formattingPlan?.filter(p => p.priority >= 4) || [];
        if (priority.length > 0) {
          const source = this.getCollectionFriendlyName(priority[0].collection);
          return `Found relevant ${source}...`;
        }
        const count = context.plan?.formattingPlan?.length || 0;
        if (count === 0) return 'Looking things up...';
        return `Found ${count} sources...`;
      },
      'fetching_content': () => {
        const friendly = this.getCollectionFriendlyName(context.collection);
        const count = context.count || 0;
        if (count === 0) return `Checking ${friendly}...`;
        if (count === 1) {
          return `Reading the ${friendly}...`;
        }
        return `Reading ${count} ${friendly}...`;
      },
      'formatting': () => {
        const friendly = this.getCollectionFriendlyName(context.collection);
        return `Getting details from ${friendly}...`;
      }
    };
    
    return messages[phase] ? messages[phase]() : null;
  }

  /**
   * Generate intelligent formatting plan for query results
   */
  async generateFormattingPlan(queryResults, userMessage, queryIntent, sendThinking) {
    // Send contextual thinking message
    if (sendThinking) {
      const collections = queryResults.map(r => r.collection);
      const thinkingMsg = await this.generateThinkingMessage('plan_start', { collections });
      if (thinkingMsg) sendThinking('analyzing', thinkingMsg);
    }
    
    const prompt = `You are a data presentation optimizer. Based on the user's question and available data, decide how to format and present the information most effectively.

**User's Question:** "${userMessage}"
**Query Intent:** ${queryIntent.intent}
**Query Analysis Flags:**
- needsDeepAnalysis: ${queryIntent.needsDeepAnalysis || false}
- analysisKeywords: ${(queryIntent.analysisKeywords || []).join(', ')}

**Available Data Results:**
${JSON.stringify(queryResults.map(r => ({
  collection: r.collection,
  count: r.count,
  reasoning: r.reasoning,
  sampleFields: r.data[0] ? Object.keys(r.data[0]).slice(0, 10) : []
})), null, 2)}

${this.dataSchemaContext}

**Your Task:**
Determine the optimal way to present this data to answer the user's question. For each collection, decide:

1. **Priority** (1-5): How important is this data to answering the question?
2. **DetailLevel** (summary | moderate | detailed | full):
   - summary: Just titles/headlines (use for less relevant data)
   - moderate: Key fields + brief excerpt (default for most data)
   - detailed: All important fields + longer content
   - full: Everything including fetching external content
3. **FetchExternalContent** (true/false): Should we fetch full content from URLs?
4. **FieldsToShow** (array): Which specific fields are most relevant?
5. **MaxItems** (number): How many items to show (1-30)
6. **FormattingNotes** (string): Special formatting instructions

**Decision Rules:**
- If user asks to "analyze" or wants "details" → detailLevel: full, fetchExternalContent: true
- If user wants "highlights" or "summary" → detailLevel: moderate
- If user wants "list" or "recent" → detailLevel: summary
- SEC filings: default to full when analyzing, moderate for lists
- News: full only if specifically asked about article content
- Government policy: IMPORTANT - transcripts are very long! 
  * detailLevel: full is OK, but ALWAYS limit maxItems to 5-10 maximum to avoid token overflow
  * The system will intelligently filter to show only relevant turns from transcripts
- Price targets/ownership: moderate (no external content needed)

**CRITICAL TOKEN LIMITS:**
- Government policy transcripts are VERY long (often 50,000+ tokens per transcript)
- When using detailLevel: "full" for government_policy, NEVER set maxItems > 10
- Prefer maxItems: 3-5 for government_policy with full detail
- System will auto-filter to show only relevant portions of transcripts

**CRITICAL - RESPONSE STYLE RECOMMENDATION:**
Also provide a "responseStyle" recommendation that tells the AI how to structure and present the final response:

**Response Style Options:**
- **structured_analysis**: Use bold section headers, bullet points, clear organization (for SEC filings, earnings analysis)
- **chronological_narrative**: Timeline format with dates, sequential events (for government policy, roadmap questions)
- **comparison_format**: Side-by-side comparison with clear distinctions (for "compare X vs Y" questions)
- **executive_summary**: Brief, high-level overview with key takeaways (for "highlights" or "tldr" questions)
- **detailed_breakdown**: In-depth sections with subsections and thorough explanation (for "analyze" or "explain" questions)
- **list_format**: Numbered or bulleted list of items (for "list recent", "show me top 5")
- **conversational**: Natural flowing paragraphs with context (for general questions)

**Tone Options:**
- **analytical**: Professional, data-focused, objective
- **concise**: Brief, to-the-point, minimal elaboration
- **comprehensive**: Detailed, thorough, includes context
- **explanatory**: Educational, walks through concepts

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
      "formattingNotes": "User wants detailed SEC filing analysis - fetch full content and extract financial numbers"
    },
    {
      "collection": "news",
      "priority": 2,
      "detailLevel": "summary",
      "fetchExternalContent": false,
      "fieldsToShow": ["title", "published_at", "url"],
      "maxItems": 5,
      "formattingNotes": "Show headlines for context but don't fetch full articles"
    }
  ],
  "overallStrategy": "Lead with SEC filing deep dive, then show news headlines for market context",
  "responseStyle": {
    "format": "structured_analysis",
    "tone": "analytical",
    "instructions": "Use bold section headers for Financial Position, Operational Progress, and Risk Factors. Extract specific dollar amounts and metrics. Lead with most important insights."
  }
}

Return ONLY valid JSON.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(response.choices[0].message.content.trim());
      console.log('🎨 AI-Generated Formatting Plan:', JSON.stringify(plan, null, 2));
      
      // Send contextual thinking message about the plan
      if (sendThinking) {
        const thinkingMsg = await this.generateThinkingMessage('plan_generated', { plan });
        if (thinkingMsg) sendThinking('formatting', thinkingMsg);
      }
      
      return plan;
    } catch (error) {
      console.error('❌ Formatting plan generation failed:', error);
      // Fallback to simple plan
      return this.generateFallbackPlan(queryResults, queryIntent);
    }
  }

  /**
   * Fallback plan if AI formatting fails
   */
  generateFallbackPlan(queryResults, queryIntent) {
    const needsDeep = queryIntent.needsDeepAnalysis || false;
    
    return {
      formattingPlan: queryResults.map(result => ({
        collection: result.collection,
        priority: 3,
        detailLevel: needsDeep ? 'full' : 'moderate',
        fetchExternalContent: needsDeep && ['sec_filings', 'news', 'press_releases', 'macro_economics'].includes(result.collection),
        fieldsToShow: ['all'],
        maxItems: result.count > 10 ? 10 : result.count,
        formattingNotes: 'Using fallback formatting'
      })),
      overallStrategy: 'Show all data with default formatting'
    };
  }

  /**
   * Execute the formatting plan to build data context
   */
  async executeFormattingPlan(plan, queryResults, DataConnector, sendThinking, queryIntent = null) {
    let dataContext = "";
    const dataCards = [];
    const intelligenceMetadata = {
      totalSources: 0,
      secFilings: [],
      secFilingTypes: [],
      hasInstitutionalData: false,
      hasPolicyData: false
    };

    // Sort by priority (highest first)
    const sortedPlan = plan.formattingPlan.sort((a, b) => b.priority - a.priority);

    for (const formatSpec of sortedPlan) {
      const result = queryResults.find(r => r.collection === formatSpec.collection);
      if (!result || result.error) continue;

      console.log(`📋 Formatting ${formatSpec.collection} with ${formatSpec.detailLevel} detail (priority: ${formatSpec.priority})`);

      // Send contextual thinking message
      if (sendThinking) {
        const thinkingMsg = await this.generateThinkingMessage('formatting', {
          collection: formatSpec.collection,
          detailLevel: formatSpec.detailLevel
        });
        if (thinkingMsg) sendThinking('formatting', thinkingMsg);
      }

      // Apply formatting based on plan
      const formatted = await this.formatCollection(
        result,
        formatSpec,
        DataConnector,
        sendThinking,
        dataCards,
        intelligenceMetadata,
        queryIntent
      );

      if (formatted) {
        dataContext += formatted;
      }
    }

    return {
      dataContext,
      dataCards,
      intelligenceMetadata
    };
  }

  /**
   * Add chart markers to data context based on query intent
   */
  addChartMarkers(dataContext, queryIntent) {
    if (!queryIntent || !queryIntent.chartConfig) {
      return dataContext;
    }

    const { symbol, timeRange } = queryIntent.chartConfig;
    if (!symbol || !timeRange) {
      return dataContext;
    }

    // Insert VIEW_CHART marker at the end of the context
    const chartMarker = `\n\n[VIEW_CHART:${symbol}:${timeRange}]\n`;
    return dataContext + chartMarker;
  }

  /**
   * Format a specific collection based on formatting spec
   */
  async formatCollection(result, formatSpec, DataConnector, sendThinking, dataCards, intelligenceMetadata, queryIntent = null) {
    const { collection, detailLevel, fetchExternalContent, maxItems, formattingNotes } = formatSpec;
    
    let output = `\n\n═══ ${this.getCollectionTitle(collection)} (${result.data.length} items) ═══\n`;
    output += `Reasoning: ${result.reasoning}\n`;
    if (formattingNotes) {
      output += `Strategy: ${formattingNotes}\n`;
    }
    output += `\n`;

    const itemsToShow = result.data.slice(0, maxItems);

    // Fetch external content if needed - with contextual thinking message
    if (fetchExternalContent && itemsToShow.length <= 5) {
      if (sendThinking) {
        const contentType = {
          'sec_filings': 'SEC filing content',
          'news': 'news articles',
          'press_releases': 'press releases',
          'macro_economics': 'economic reports'
        }[collection] || 'content';
        
        const thinkingMsg = await this.generateThinkingMessage('fetching_content', {
          count: itemsToShow.length,
          contentType,
          collection: collection
        });
        if (thinkingMsg) sendThinking('retrieving', thinkingMsg);
      }
    }

    // Format based on collection type
    switch (collection) {
      case 'sec_filings':
        return await this.formatSecFilings(itemsToShow, detailLevel, fetchExternalContent, DataConnector, dataCards, intelligenceMetadata, output);
      
      case 'government_policy':
        return this.formatGovernmentPolicy(itemsToShow, detailLevel, output, queryIntent);
      
      case 'news':
        return await this.formatNews(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output, dataCards);
      
      case 'price_targets':
        return this.formatPriceTargets(itemsToShow, detailLevel, output);
      
      case 'earnings_transcripts':
        return this.formatEarningsTranscripts(itemsToShow, detailLevel, output);
      
      case 'press_releases':
        return await this.formatPressReleases(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output);
      
      case 'macro_economics':
        return await this.formatMacroEconomics(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output, dataCards);
      
      case 'ownership':
        return this.formatOwnership(itemsToShow, detailLevel, output);
      
      case 'hype':
        return this.formatHype(itemsToShow, detailLevel, output);
      
      // Supabase price data collections
      case 'finnhub_quote_snapshots':
        return this.formatQuoteSnapshots(itemsToShow, detailLevel, output);
      
      case 'one_minute_prices':
        // Skip intraday text analysis when a visual chart is being displayed
        // The chart already shows the intraday movement visually
        if (queryIntent?.needsChart && queryIntent?.chartConfig?.timeRange === '1D') {
          console.log(`⏭️  Skipping intraday text formatting - visual chart is being displayed`);
          return '';  // Return empty string to skip this section
        }
        return this.formatIntradayPrices(itemsToShow, detailLevel, output);
      
      case 'daily_prices':
        return this.formatDailyPrices(itemsToShow, detailLevel, output);
      
      case 'company_information':
        return this.formatCompanyInformation(itemsToShow, detailLevel, output);
      
      default:
        return output + `(Unsupported collection type)\n`;
    }
  }

  /**
   * Format SEC filings
   */
  async formatSecFilings(items, detailLevel, fetchExternal, DataConnector, dataCards, intelligenceMetadata, output) {
    for (let index = 0; index < items.length; index++) {
      const filing = items[index];
      const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
      
      output += `${index + 1}. ${filing.form_type} filed on ${date}\n`;
      output += `   Ticker: ${filing.ticker}\n`;
      if (filing.url) {
        output += `   URL: ${filing.url}\n`;
      }

      if (fetchExternal && filing.url && detailLevel === 'full') {
        try {
          const contentResult = await DataConnector.fetchSecFilingContent(filing.url, [], 25000);
          
          if (contentResult.success && contentResult.content) {
            output += `\n   ⚠️⚠️⚠️ CRITICAL EXTRACTION INSTRUCTIONS ⚠️⚠️⚠️\n`;
            output += `   YOU MUST FIND AND CITE THESE SPECIFIC NUMBERS FROM THE CONTENT BELOW:\n`;
            output += `   • Cash/cash equivalents: Look for "cash equivalents of $X" or "$X million as of"\n`;
            output += `   • Net loss: Look for "net loss of $X" or "Net loss $ (X,XXX)"\n`;
            output += `   • Investments: Look for "investments of $X" or "total investments"\n`;
            output += `   • Operating expenses: Look for "operating expenses" or "R&D expenses"\n`;
            output += `   • TABLE DATA: Numbers in "(in thousands)" tables - multiply by 1000 for actual value\n`;
            output += `   • Example: "15,634" in thousands = $15.6 million\n`;
            output += `   • Example: "(133,357)" = negative $133.4 million (loss)\n`;
            output += `   FAILURE TO EXTRACT NUMBERS = FAILED RESPONSE\n`;
            output += `   === ${filing.form_type} CONTENT ===\n${contentResult.content}\n   === END CONTENT ===\n`;
            
            intelligenceMetadata.secFilings.push({
              ticker: filing.ticker,
              formType: filing.form_type,
              date: filing.acceptance_datetime,
              content: contentResult.content.substring(0, 5000),
              url: filing.url
            });

            if (contentResult.images && contentResult.images.length > 0) {
              output += `\n   === IMAGES/CHARTS IN THIS FILING ===\n`;
              output += `   ⚠️ EACH IMAGE MUST HAVE A DESCRIPTION IN YOUR RESPONSE ⚠️\n`;
              output += `   DO NOT just drop [IMAGE_CARD:...] at the end - describe what each image shows!\n\n`;
              contentResult.images.slice(0, 5).forEach((img, idx) => {
                const imageId = `sec-image-${filing.ticker}-${index}-${idx}`;
                dataCards.push({
                  type: 'image',
                  data: {
                    id: imageId,
                    ticker: filing.ticker,
                    source: 'sec_filing',
                    title: img.alt || `Chart/Diagram from ${filing.form_type}`,
                    imageUrl: img.url,
                    context: img.context || null,
                    filingType: filing.form_type,
                    filingDate: date,
                    filingUrl: filing.url
                  }
                });
                output += `   IMAGE ${idx + 1}: ${img.alt || 'Financial Chart/Table'}\n`;
                if (img.context) {
                  output += `   What this image shows: "${img.context}"\n`;
                } else {
                  output += `   What this image shows: Likely a financial statement, cash flow table, or data visualization\n`;
                }
                output += `   REQUIRED: Write a sentence describing this image, then place: [IMAGE_CARD:${imageId}]\n`;
                output += `   Example: "The cash flow statement shows net cash used in operations of $X million [IMAGE_CARD:${imageId}]"\n\n`;
              });
              output += `   === END IMAGES ===\n`;
            }
          }
        } catch (error) {
          console.error(`Error fetching SEC content: ${error.message}`);
        }
      }

      output += `\n`;
    }

    intelligenceMetadata.secFilingTypes.push(...items.map(f => f.form_type));
    intelligenceMetadata.totalSources++;
    return output;
  }

  /**
   * Format government policy documents
   */
  formatGovernmentPolicy(items, detailLevel, output, queryContext = null) {
    // Smart filtering: extract keywords from query context to show only relevant turns
    let keywords = [];
    if (queryContext && queryContext.analysisKeywords) {
      keywords = queryContext.analysisKeywords;
    }
    
    items.forEach((doc, index) => {
      output += `${index + 1}. ${doc.title || 'Untitled'} - ${doc.date || 'No date'}\n`;
      if (doc.participants && doc.participants.length > 0) {
        output += `   Participants: ${doc.participants.join(', ')}\n`;
      }
      if (doc.url) {
        output += `   URL: ${doc.url}\n`;
      }

      if (detailLevel !== 'summary' && doc.turns && doc.turns.length > 0) {
        // If showing full detail, intelligently filter to relevant turns only
        let turnsToShow = doc.turns;
        
        if (detailLevel === 'full' && keywords.length > 0) {
          // Show only turns containing relevant keywords
          turnsToShow = doc.turns.filter(turn => 
            keywords.some(keyword => 
              turn.text.toLowerCase().includes(keyword.toLowerCase())
            )
          );
          
          // If no keyword matches, show first 10 turns as fallback
          if (turnsToShow.length === 0) {
            turnsToShow = doc.turns.slice(0, 10);
          } else {
            // Limit to 15 relevant turns per document to avoid token explosion
            turnsToShow = turnsToShow.slice(0, 15);
          }
        } else {
          // For moderate detail or no keywords, limit turns
          const maxTurns = detailLevel === 'full' ? 20 : 10;
          turnsToShow = doc.turns.slice(0, maxTurns);
        }
        
        output += `\n   === TRANSCRIPT (showing ${turnsToShow.length} of ${doc.turns.length} turns) ===\n`;
        turnsToShow.forEach(turn => {
          // Truncate very long turns (over 1000 chars)
          const truncatedText = turn.text.length > 1000 ? 
            turn.text.substring(0, 1000) + '... [truncated]' : 
            turn.text;
          output += `   ${turn.speaker}: ${truncatedText}\n`;
        });
        if (doc.turns.length > turnsToShow.length) {
          output += `   ... (${doc.turns.length - turnsToShow.length} more turns omitted)\n`;
        }
        output += `   === END TRANSCRIPT ===\n`;
      }
      output += `\n`;
    });

    return output;
  }

  /**
   * Format news articles
   */
  async formatNews(items, detailLevel, fetchExternal, DataConnector, output, dataCards) {
    for (let index = 0; index < items.length; index++) {
      const article = items[index];
      const date = article.published_at ? new Date(article.published_at).toLocaleDateString() : 'Unknown date';
      
      // Extract actual source from URL (prioritize domain over aggregator like "Yahoo")
      const domain = article.url ? this.extractDomain(article.url) : null;
      const actualSource = domain || article.origin || 'Unknown';
      
      output += `${index + 1}. ${article.title || 'Untitled'} - ${date}\n`;
      if (article.ticker) output += `   Ticker: ${article.ticker}\n`;
      output += `   Source: ${actualSource}\n`;

      // Create article card with image/logo for visual display
      if (article.url) {
        const articleId = `article-${article.ticker || 'news'}-${index}`;
        
        // Use Google's favicon service for site logo (fallback)
        const logoUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
        
        // ALWAYS try to fetch og:image for visual article preview (not gated by fetchExternal)
        // This ensures we get article images even when not fetching full content
        let imageUrl = article.image || null; // Start with stored image from MongoDB
        if (article.url && items.length <= 10 && !imageUrl) {
          try {
            const contentResult = await DataConnector.fetchWebContent(article.url, 8000);
            if (contentResult.success && contentResult.imageUrl) {
              imageUrl = contentResult.imageUrl;
            }
          } catch (error) {
            // Silently fail - will use logo fallback
          }
        }
        
        dataCards.push({
          type: 'article',
          data: {
            id: articleId,
            title: article.title || 'Untitled Article',
            url: article.url,
            source: actualSource,
            domain: domain,
            ticker: article.ticker,
            publishedAt: article.published_at,
            logoUrl: logoUrl,
            imageUrl: imageUrl,
            content: article.content ? article.content.substring(0, 200) : null
          }
        });
        
        output += `   [VIEW_ARTICLE:${articleId}]\n`;
      }

      // Show article content - ALWAYS prefer stored 'content' field from MongoDB
      if (article.content && detailLevel !== 'summary') {
        const contentLength = detailLevel === 'full' ? 5000 : (detailLevel === 'detailed' ? 1000 : 300);
        output += `   Content: ${article.content.substring(0, contentLength)}${article.content.length > contentLength ? '...' : ''}\n`;
      } else if (detailLevel === 'full' && fetchExternal && article.url && items.length <= 5) {
        // Only fetch from URL if content field is missing (fallback)
        try {
          const contentResult = await DataConnector.fetchWebContent(article.url, 8000);
          if (contentResult.success && contentResult.content) {
            output += `\n   === FULL ARTICLE ===\n${contentResult.content}\n   === END ARTICLE ===\n`;
          }
        } catch (error) {
          // Silently fail - no content available
        }
      }

      if (article.url) output += `   URL: ${article.url}\n`;
      output += `\n`;
    }

    return output;
  }

  /**
   * Format price targets
   */
  formatPriceTargets(items, detailLevel, output) {
    items.forEach((target, index) => {
      const date = target.date ? new Date(target.date).toLocaleDateString() : 'Unknown date';
      output += `${index + 1}. ${target.analyst || 'Unknown Analyst'} - ${date}\n`;
      if (target.action) output += `   Action: ${target.action}\n`;
      if (target.rating_change) output += `   Rating Change: ${target.rating_change}\n`;
      if (target.price_target_change) output += `   Price Target: ${target.price_target_change}\n`;
      output += `\n`;
    });
    return output;
  }

  /**
   * Format earnings transcripts
   */
  formatEarningsTranscripts(items, detailLevel, output) {
    const contentLength = detailLevel === 'full' ? 10000 : (detailLevel === 'detailed' ? 5000 : 2000);
    
    items.forEach((transcript, index) => {
      const date = transcript.report_date ? new Date(transcript.report_date).toLocaleDateString() : 'Unknown date';
      output += `${index + 1}. ${transcript.ticker} Q${transcript.quarter} ${transcript.year} - ${date}\n`;
      if (transcript.content) {
        output += `   Content: ${transcript.content.substring(0, contentLength)}${transcript.content.length > contentLength ? '...' : ''}\n`;
      }
      output += `\n`;
    });
    return output;
  }

  /**
   * Format press releases
   */
  async formatPressReleases(items, detailLevel, fetchExternal, DataConnector, output) {
    for (let index = 0; index < items.length; index++) {
      const press = items[index];
      const date = press.published_date ? new Date(press.published_date).toLocaleDateString() : (press.date ? new Date(press.date).toLocaleDateString() : 'Unknown date');
      
      output += `${index + 1}. ${press.title || 'Untitled'} - ${date}\n`;
      if (press.ticker) output += `   Ticker: ${press.ticker}\n`;

      if (fetchExternal && press.url && detailLevel === 'full' && items.length <= 5) {
        try {
          const contentResult = await DataConnector.fetchWebContent(press.url, 10000);
          if (contentResult.success && contentResult.content) {
            output += `\n   === FULL PRESS RELEASE ===\n${contentResult.content}\n   === END PRESS RELEASE ===\n`;
          } else if (press.content || press.summary) {
            output += `   ${press.content || press.summary}\n`;
          }
        } catch (error) {
          if (press.content || press.summary) {
            output += `   ${press.content || press.summary}\n`;
          }
        }
      } else if (press.content && detailLevel !== 'summary') {
        output += `   Content: ${press.content.substring(0, detailLevel === 'detailed' ? 2000 : 500)}...\n`;
      } else if (press.summary && detailLevel !== 'summary') {
        output += `   Summary: ${press.summary}\n`;
      }

      if (press.url) output += `   URL: ${press.url}\n`;
      output += `\n`;
    }
    return output;
  }

  /**
   * Format macro economics
   */
  async formatMacroEconomics(items, detailLevel, fetchExternal, DataConnector, output, dataCards) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const date = item.date ? new Date(item.date).toLocaleDateString() : 'Unknown date';
      
      // Build full URL from tradingeconomics.com base + relative path
      const fullUrl = item.url ? `https://tradingeconomics.com${item.url}` : null;
      
      output += `${index + 1}. ${item.title || 'Untitled'} - ${date}\n`;
      if (item.country) output += `   Country: ${item.country}\n`;
      if (item.category) output += `   Category: ${item.category}\n`;

      // Create article card for visual display
      if (fullUrl) {
        const articleId = `macro_${item._id || `${item.country}_${index}`}`;
        const domain = 'tradingeconomics.com';
        
        // Create VIEW_ARTICLE marker for inline rendering
        output += `   VIEW_ARTICLE[id=${articleId}|title=${item.title || 'Economic Report'}|url=${fullUrl}|source=Trading Economics|domain=${domain}|country=${item.country || ''}|publishedAt=${date}]\n`;
        
        // Add to dataCards array for rendering at message end
        dataCards.push({
          type: 'article',
          data: {
            id: articleId,
            title: item.title || 'Economic Report',
            url: fullUrl,
            source: 'Trading Economics',
            domain: domain,
            country: item.country,
            category: item.category,
            publishedAt: date,
            logoUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
            content: item.description
          }
        });
      }

      if (fetchExternal && fullUrl && detailLevel === 'full' && items.length <= 5) {
        try {
          const contentResult = await DataConnector.fetchWebContent(fullUrl, 8000);
          if (contentResult.success && contentResult.content) {
            output += `\n   === FULL REPORT ===\n${contentResult.content}\n   === END REPORT ===\n`;
          } else if (item.description) {
            output += `   Description: ${item.description}\n`;
          }
        } catch (error) {
          if (item.description) {
            output += `   Description: ${item.description}\n`;
          }
        }
      } else if (item.description && detailLevel !== 'summary') {
        const descLength = detailLevel === 'detailed' ? 500 : 200;
        output += `   Description: ${item.description.substring(0, descLength)}...\n`;
      }

      output += `\n`;
    }
    return output;
  }

  /**
   * Format ownership data
   */
  formatOwnership(items, detailLevel, output) {
    items.forEach((holding, index) => {
      const date = holding.file_date ? new Date(holding.file_date).toLocaleDateString() : 'Unknown date';
      output += `${index + 1}. ${holding.holder_name || 'Unknown Holder'} - ${date}\n`;
      output += `   Ticker: ${holding.ticker}\n`;
      if (holding.shares) output += `   Shares: ${holding.shares.toLocaleString()}\n`;
      if (holding.shares_change) output += `   Change: ${holding.shares_change > 0 ? '+' : ''}${holding.shares_change.toLocaleString()} shares\n`;
      if (holding.total_position_value) output += `   Value: $${holding.total_position_value.toLocaleString()}\n`;
      output += `\n`;
    });
    return output;
  }

  /**
   * Format hype/sentiment data
   */
  formatHype(items, detailLevel, output) {
    items.forEach((hype, index) => {
      output += `${index + 1}. ${hype.ticker} - ${hype.timestamp}\n`;
      if (hype.sentiment) {
        output += `   Bullish: ${hype.sentiment.bullishPercent}% | Bearish: ${hype.sentiment.bearishPercent}%\n`;
      }
      if (hype.buzz) {
        output += `   Weekly Articles: ${hype.buzz.articlesInLastWeek} | Buzz: ${hype.buzz.buzz}\n`;
      }
      if (hype.social_sentiment) {
        output += `   Social Score: ${hype.social_sentiment.score} | Mentions: ${hype.social_sentiment.mention}\n`;
      }
      output += `\n`;
    });
    return output;
  }

  /**
   * Extract domain from URL for logo/favicon
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user-friendly collection name for thinking messages (lowercase, natural)
   */
  getCollectionFriendlyName(collection) {
    const names = {
      'government_policy': 'government statements',
      'sec_filings': 'SEC filing',
      'news': 'news articles',
      'press_releases': 'press releases',
      'earnings_transcripts': 'earnings transcripts',
      'price_targets': 'analyst ratings',
      'macro_economics': 'economic data',
      'ownership': 'institutional holdings',
      'hype': 'sentiment data',
      'finnhub_quote_snapshots': 'current stock prices',
      'one_minute_prices': 'intraday price data',
      'daily_prices': 'daily price history',
      'company_information': 'company details'
    };
    return names[collection] || collection;
  }

  /**
   * Get user-friendly collection title
   */
  getCollectionTitle(collection) {
    const titles = {
      'government_policy': 'GOVERNMENT POLICY STATEMENTS',
      'sec_filings': 'SEC FILINGS',
      'news': 'NEWS ARTICLES',
      'press_releases': 'PRESS RELEASES',
      'earnings_transcripts': 'EARNINGS TRANSCRIPTS',
      'price_targets': 'ANALYST PRICE TARGETS',
      'macro_economics': 'ECONOMIC DATA',
      'ownership': 'INSTITUTIONAL OWNERSHIP',
      'hype': 'SENTIMENT DATA',
      'finnhub_quote_snapshots': 'CURRENT STOCK PRICES',
      'one_minute_prices': 'INTRADAY PRICE DATA',
      'daily_prices': 'DAILY PRICE HISTORY',
      'company_information': 'COMPANY INFORMATION'
    };
    return titles[collection] || collection.toUpperCase();
  }

  /**
   * Format Finnhub quote snapshots (real-time price data)
   * Fields: symbol, c (current), o (open), h (high), l (low), pc (previous close), d (change), dp (change %)
   */
  formatQuoteSnapshots(items, detailLevel, output) {
    items.forEach((quote, index) => {
      const changePrefix = quote.dp >= 0 ? '+' : '';
      const changeColor = quote.dp >= 0 ? '📈' : '📉';
      
      output += `${index + 1}. ${quote.symbol} - Current Price: $${quote.c?.toFixed(2) || 'N/A'}\n`;
      output += `   ${changeColor} Daily Change: ${changePrefix}${quote.dp?.toFixed(2) || 0}% ($${changePrefix}${quote.d?.toFixed(2) || 0})\n`;
      output += `   Open: $${quote.o?.toFixed(2) || 'N/A'} | High: $${quote.h?.toFixed(2) || 'N/A'} | Low: $${quote.l?.toFixed(2) || 'N/A'}\n`;
      output += `   Previous Close: $${quote.pc?.toFixed(2) || 'N/A'}\n`;
      if (quote.timestamp) {
        output += `   As of: ${new Date(quote.timestamp).toLocaleString()}\n`;
      }
      output += `\n`;
    });
    return output;
  }

  /**
   * Format intraday price bars (one_minute_prices)
   * Fields: symbol, timestamp, open, high, low, close, volume
   */
  formatIntradayPrices(items, detailLevel, output) {
    if (items.length === 0) return output;
    
    // Group by symbol
    const bySymbol = {};
    items.forEach(bar => {
      if (!bySymbol[bar.symbol]) bySymbol[bar.symbol] = [];
      bySymbol[bar.symbol].push(bar);
    });
    
    for (const symbol of Object.keys(bySymbol)) {
      const bars = bySymbol[symbol].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstBar = bars[0];
      const lastBar = bars[bars.length - 1];
      
      // Calculate session high/low/range
      const sessionHigh = Math.max(...bars.map(b => b.high));
      const sessionLow = Math.min(...bars.map(b => b.low));
      const totalVolume = bars.reduce((sum, b) => sum + (b.volume || 0), 0);
      
      const priceChange = lastBar.close - firstBar.open;
      const pctChange = ((priceChange / firstBar.open) * 100).toFixed(2);
      const changePrefix = priceChange >= 0 ? '+' : '';
      
      output += `**${symbol} Intraday Price Action**\n`;
      output += `   Time Range: ${new Date(firstBar.timestamp).toLocaleTimeString()} - ${new Date(lastBar.timestamp).toLocaleTimeString()}\n`;
      output += `   Open: $${firstBar.open?.toFixed(2)} → Close: $${lastBar.close?.toFixed(2)} (${changePrefix}${pctChange}%)\n`;
      output += `   Session High: $${sessionHigh.toFixed(2)} | Session Low: $${sessionLow.toFixed(2)}\n`;
      output += `   Range: $${(sessionHigh - sessionLow).toFixed(2)} | Volume: ${totalVolume.toLocaleString()}\n`;
      output += `\n`;
      
      // If detailed, show recent bars
      if (detailLevel === 'full' && bars.length <= 20) {
        output += `   Recent Bars:\n`;
        bars.slice(-10).forEach(bar => {
          output += `   ${new Date(bar.timestamp).toLocaleTimeString()}: O:$${bar.open?.toFixed(2)} H:$${bar.high?.toFixed(2)} L:$${bar.low?.toFixed(2)} C:$${bar.close?.toFixed(2)}\n`;
        });
        output += `\n`;
      }
    }
    return output;
  }

  /**
   * Format daily price history
   * Fields: symbol, timestamp, open, high, low, close, volume
   */
  formatDailyPrices(items, detailLevel, output) {
    if (items.length === 0) return output;
    
    // Group by symbol
    const bySymbol = {};
    items.forEach(bar => {
      if (!bySymbol[bar.symbol]) bySymbol[bar.symbol] = [];
      bySymbol[bar.symbol].push(bar);
    });
    
    for (const symbol of Object.keys(bySymbol)) {
      const bars = bySymbol[symbol].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstBar = bars[0];
      const lastBar = bars[bars.length - 1];
      
      const priceChange = lastBar.close - firstBar.open;
      const pctChange = ((priceChange / firstBar.open) * 100).toFixed(2);
      const changePrefix = priceChange >= 0 ? '+' : '';
      
      output += `**${symbol} Daily Price History** (${bars.length} days)\n`;
      output += `   Period: ${new Date(firstBar.timestamp).toLocaleDateString()} - ${new Date(lastBar.timestamp).toLocaleDateString()}\n`;
      output += `   Start: $${firstBar.open?.toFixed(2)} → End: $${lastBar.close?.toFixed(2)} (${changePrefix}${pctChange}%)\n`;
      
      // Calculate period high/low
      const periodHigh = Math.max(...bars.map(b => b.high));
      const periodLow = Math.min(...bars.map(b => b.low));
      output += `   Period High: $${periodHigh.toFixed(2)} | Period Low: $${periodLow.toFixed(2)}\n`;
      output += `\n`;
      
      // Show recent daily bars
      if (detailLevel === 'full' || detailLevel === 'moderate') {
        output += `   Recent Days:\n`;
        bars.slice(-5).forEach(bar => {
          const dayChange = bar.close - bar.open;
          const dayPct = ((dayChange / bar.open) * 100).toFixed(2);
          const dayPrefix = dayChange >= 0 ? '+' : '';
          output += `   ${new Date(bar.timestamp).toLocaleDateString()}: $${bar.close?.toFixed(2)} (${dayPrefix}${dayPct}%) | Vol: ${(bar.volume || 0).toLocaleString()}\n`;
        });
        output += `\n`;
      }
    }
    return output;
  }

  /**
   * Format company information
   * Fields: symbol, name, exchange, market_cap, shares_outstanding, country, sector, industry, etc.
   */
  formatCompanyInformation(items, detailLevel, output) {
    items.forEach((company, index) => {
      output += `${index + 1}. ${company.name} (${company.symbol})\n`;
      if (company.exchange) output += `   Exchange: ${company.exchange}\n`;
      if (company.sector) output += `   Sector: ${company.sector} | Industry: ${company.industry || 'N/A'}\n`;
      if (company.country) output += `   Country: ${company.country}\n`;
      if (company.market_cap) output += `   Market Cap: $${(company.market_cap / 1e9).toFixed(2)}B\n`;
      if (company.shares_outstanding) output += `   Shares Outstanding: ${(company.shares_outstanding / 1e6).toFixed(2)}M\n`;
      if (company.ipo_date) output += `   IPO Date: ${new Date(company.ipo_date).toLocaleDateString()}\n`;
      if (company.website_url) output += `   Website: ${company.website_url}\n`;
      output += `\n`;
    });
    return output;
  }
}

module.exports = new ResponseEngine();
