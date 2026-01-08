/**
 * AI-Native Response Engine
 * Intelligently formats and prioritizes data for AI consumption
 * Replaces hardcoded formatting logic with adaptive, context-aware formatting
 */

const openai = require('../config/openai');
const { RESPONSE_SCHEMA_CONTEXT, getCollectionTitle, getCollectionFriendlyName } = require('../config/prompts/schema-context');
const { generateThinkingMessage } = require('../config/thinking-messages');
const { getTokenBudget, getTierInfo } = require('../config/token-allocation');

/**
 * Universal formatting rules that apply to ALL responses
 * SEMANTIC ONLY - mechanical formatting handled by ResponseFormatter
 * 
 * Consolidated from system-prompt.js - all data presentation rules in one place
 */
const UNIVERSAL_FORMATTING_RULES = `
**RESPONSE GUIDELINES:**

1. **Analyze Before Mentioning**: Never reference a document without explaining its content. Extract specific numbers, dates, and facts.

2. **Correlate Data**: Connect news/filings to price movements: "The positive FDA news appears reflected in today's 8% gain."

3. **Price Data**: stock_quote_now.close = live price, previous_close = yesterday. Calculate % change from these.

4. **Citations**: Cite inline immediately after claims. NO "Sources:" sections at the end.

5. **Card Markers (CRITICAL)**:
   - **CHARTS**: Place [VIEW_CHART:...] FIRST, before price analysis text
   - **ARTICLES**: Place [VIEW_ARTICLE:...] AFTER the discussion paragraph for that article
   - **IMAGES**: [IMAGE_CARD:...] inline with SEC filing citations
   - **EVENTS**: [EVENT_CARD:...] at end of bullet describing that event

6. **Article Structure**: Each article gets Header → Paragraph(s) of analysis → [VIEW_ARTICLE:...] marker. NO numbered lists for articles.

7. **Preserve ALL Markers**: Every [VIEW_ARTICLE:...] and [IMAGE_CARD:...] from the data MUST appear in your response.
`;

/**
 * Response style options for AI to recommend  
 * Focus on content approach, not mechanical formatting
 */
const RESPONSE_STYLE_OPTIONS = `
**Response Style Options:**
- **structured_analysis**: Organized sections with clear headers (SEC filings, earnings analysis)
- **chronological_narrative**: Timeline format with dates (government policy, roadmap)
- **comparison_format**: Side-by-side comparison (compare X vs Y)
- **executive_summary**: Brief overview with key takeaways (highlights, tldr)
- **detailed_breakdown**: In-depth explanation with subsections (analyze, explain)
- **list_format**: Present as a list of items (list recent, show top 5)
- **conversational**: Natural flowing narrative (general questions)

**Tone Options:**
- **analytical**: Professional, data-focused, objective
- **concise**: Brief, to-the-point
- **comprehensive**: Detailed, thorough, includes context
- **explanatory**: Educational, walks through concepts`;

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

class ContextEngine {
  constructor() {
    // Use centralized schema context
    this.dataSchemaContext = RESPONSE_SCHEMA_CONTEXT;
  }

  /**
   * Generate contextual thinking message (delegates to shared service)
   */
  async generateThinkingMessage(phase, context) {
    return generateThinkingMessage(phase, context);
  }
  
  /**
   * Fallback thinking messages (uses shared service internally)
   */
  getFallbackThinkingMessage(phase, context) {
    // Shared service handles fallbacks
    return null;
  }

  /**
   * Generate formatting plan using fast heuristics instead of AI
   * This saves ~7 seconds compared to the AI-based approach
   */
  async generateFormattingPlan(queryResults, userMessage, queryIntent, sendThinking) {
    // Send contextual thinking message
    if (sendThinking) {
      const collections = queryResults.map(r => r.collection);
      const totalResults = queryResults.reduce((sum, r) => sum + (r.data?.length || 0), 0);
      const thinkingMsg = await this.generateThinkingMessage('plan_start', { 
        collections,
        totalResults,
        count: totalResults
      });
      if (thinkingMsg) sendThinking('analyzing', thinkingMsg);
    }
    
    // Use fast heuristics instead of AI call
    const plan = this.generateHeuristicPlan(queryResults, userMessage, queryIntent);
    
    console.log('🎨 Heuristic Formatting Plan:', JSON.stringify(plan, null, 2));
    
    // Prepend universal formatting rules to query-specific instructions
    if (plan.responseStyle) {
      if (plan.responseStyle.instructions) {
        plan.responseStyle.instructions = UNIVERSAL_FORMATTING_RULES + '\n\n' + plan.responseStyle.instructions;
      } else {
        plan.responseStyle.instructions = UNIVERSAL_FORMATTING_RULES;
      }
    }
    
    // Send contextual thinking message about the plan
    if (sendThinking) {
      const thinkingMsg = await this.generateThinkingMessage('plan_generated', { plan });
      if (thinkingMsg) sendThinking('formatting', thinkingMsg);
    }
    
    return plan;
  }

  /**
   * Fast heuristic-based formatting plan
   */
  generateHeuristicPlan(queryResults, userMessage, queryIntent) {
    const needsDeep = queryIntent.needsDeepAnalysis !== false; // Default true
    const msgLower = userMessage.toLowerCase();
    
    // Detect query patterns
    // Note: "last 10-Q" or "last 8-K" should NOT be list queries (they're SEC filing analysis)
    const isListQuery = /\b(list|show me|recent|latest|top \d+|last \d+(?!\s*-?[QqKk]))\b/i.test(userMessage);
    const isAnalysisQuery = /\b(why|analyze|explain|what happened|impact|cause|reason|details?|breakdown)\b/i.test(userMessage);
    const isCompareQuery = /\b(compare|vs|versus|difference|between)\b/i.test(userMessage);
    const isSummaryQuery = /\b(summary|highlights|overview|tldr|brief)\b/i.test(userMessage);
    
    // Determine response style based on query type
    let responseStyle = {
      format: 'structured_analysis',
      tone: 'analytical',
      instructions: ''
    };
    
    if (isCompareQuery) {
      responseStyle.format = 'comparison_format';
      responseStyle.instructions = 'Use side-by-side comparisons with clear distinctions.';
    } else if (isSummaryQuery) {
      responseStyle.format = 'executive_summary';
      responseStyle.instructions = 'Provide brief, high-level overview with key takeaways.';
    } else if (isListQuery && !isAnalysisQuery) {
      responseStyle.format = 'list_format';
      responseStyle.instructions = 'Use clear numbered or bulleted lists.';
    } else if (isAnalysisQuery) {
      responseStyle.format = 'detailed_breakdown';
      responseStyle.instructions = 'Provide in-depth analysis with sections and subsections.';
    }
    
    // Collection-specific config
    const collectionConfig = {
      sec_filings: {
        priority: isAnalysisQuery ? 5 : 3,
        detailLevel: needsDeep && !isListQuery ? 'full' : 'moderate',
        fetchExternalContent: needsDeep && !isListQuery,
        maxItems: isListQuery ? 10 : 3
      },
      news: {
        priority: /news|article|press/i.test(userMessage) ? 5 : 3,
        detailLevel: isAnalysisQuery ? 'detailed' : 'moderate',
        fetchExternalContent: false, // Metadata only for news (cards show articles)
        maxItems: isListQuery ? 15 : 8
      },
      government_policy: {
        priority: /fed|fomc|policy|rate|powell|inflation/i.test(userMessage) ? 5 : 3,
        detailLevel: needsDeep ? 'full' : 'moderate',
        fetchExternalContent: false,
        maxItems: Math.min(5, queryResults.find(r => r.collection === 'government_policy')?.count || 5) // Limit transcript items
      },
      price_targets: {
        priority: /target|analyst|rating|upgrade|downgrade/i.test(userMessage) ? 5 : 2,
        detailLevel: 'moderate',
        fetchExternalContent: false,
        maxItems: 10
      },
      press_releases: {
        priority: /press|release|announce/i.test(userMessage) ? 5 : 3,
        detailLevel: needsDeep ? 'detailed' : 'moderate',
        fetchExternalContent: false,
        maxItems: 8
      },
      institutional_ownership: {
        priority: /ownership|institutional|holdings|13f/i.test(userMessage) ? 5 : 2,
        detailLevel: 'moderate',
        fetchExternalContent: false,
        maxItems: 15
      },
      insider_trading: {
        priority: /insider|executive|buy|sell|trading/i.test(userMessage) ? 5 : 2,
        detailLevel: 'moderate',
        fetchExternalContent: false,
        maxItems: 15
      },
      earnings: {
        priority: /earning|quarter|revenue|profit|eps/i.test(userMessage) ? 5 : 3,
        detailLevel: needsDeep ? 'detailed' : 'moderate',
        fetchExternalContent: false,
        maxItems: 8
      },
      macro_economics: {
        priority: /economy|gdp|employment|inflation|economic/i.test(userMessage) ? 5 : 2,
        detailLevel: needsDeep ? 'detailed' : 'moderate',
        fetchExternalContent: needsDeep && !isListQuery,
        maxItems: 5
      }
    };
    
    const formattingPlan = queryResults.map(result => {
      const config = collectionConfig[result.collection] || {
        priority: 3,
        detailLevel: 'moderate',
        fetchExternalContent: false,
        maxItems: 10
      };
      
      return {
        collection: result.collection,
        priority: config.priority,
        detailLevel: config.detailLevel,
        fetchExternalContent: config.fetchExternalContent,
        fieldsToShow: ['all'],
        maxItems: Math.min(config.maxItems, result.count || config.maxItems),
        formattingNotes: `Heuristic: ${responseStyle.format}`
      };
    });
    
    // Sort by priority (highest first)
    formattingPlan.sort((a, b) => b.priority - a.priority);
    
    return {
      formattingPlan,
      overallStrategy: `Using ${responseStyle.format} style for this ${queryIntent.intent} query`,
      responseStyle
    };
  }

  /**
   * Fallback plan if formatting fails
   */
  generateFallbackPlan(queryResults, queryIntent) {
    const needsDeep = queryIntent.needsDeepAnalysis !== false; // Default true
    
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
          detailLevel: formatSpec.detailLevel,
          count: result.data?.length || 0,
          ticker: result.data && result.data[0]?.ticker
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
   * Frontend will handle fetching the chart data itself
   */
  async addChartMarkers(dataContext, queryIntent, dataCards, DataConnector) {
    if (!queryIntent || !queryIntent.chartConfig) {
      return dataContext;
    }

    const { symbol } = queryIntent.chartConfig;
    // Normalize timeRange to uppercase to match frontend expectations ('1D', '5D', '1M', etc.)
    const timeRange = queryIntent.chartConfig.timeRange?.toUpperCase();
    if (!symbol || !timeRange) {
      return dataContext;
    }

    console.log(`📊 Adding chart marker for ${symbol} (${timeRange})`);

    // Create lightweight chart card without data - frontend will fetch it
    // This keeps SSE payloads small and avoids timestamp serialization issues
    dataCards.push({
      type: 'chart',
      data: {
        id: `chart-${symbol}-${timeRange}`,
        symbol: symbol,
        timeRange: timeRange
      }
    });

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
          collection: collection,
          title: itemsToShow[0]?.title || itemsToShow[0]?.form_type || null
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
   * Format news articles - OPTIMIZED with parallel metadata fetching
   */
  async formatNews(items, detailLevel, fetchExternal, DataConnector, output, dataCards) {
    // Domains that block requests (403/paywall) - skip fetching metadata
    const BLOCKED_DOMAINS = ['seekingalpha.com', 'wsj.com', 'ft.com', 'barrons.com'];
    
    // Provider domain mapping for logo resolution
    const PROVIDER_DOMAINS = {
      "Barron's": 'barrons.com',
      'Zacks': 'zacks.com',
      'Simply Wall St': 'simplywall.st',
      'Benzinga': 'benzinga.com',
      'Motley Fool': 'fool.com',
      'The Motley Fool': 'fool.com',
      'InvestorPlace': 'investorplace.com',
      'Seeking Alpha': 'seekingalpha.com',
      'MarketWatch': 'marketwatch.com',
      'TheStreet': 'thestreet.com',
      'TipRanks': 'tipranks.com',
      '24/7 Wall St.': '247wallst.com',
      'Investor\'s Business Daily': 'investors.com',
      'IBD': 'investors.com'
    };

    // PHASE 1: Prepare article data and identify which need metadata fetches
    const articleData = items.map((article, index) => {
      const date = article.published_at ? new Date(article.published_at).toLocaleDateString() : 'Unknown date';
      const domain = article.url ? this.extractDomain(article.url) : null;
      
      // Determine actual source
      let actualSource = domain || article.origin || 'Unknown';
      if (domain === 'finance.yahoo.com') {
        if (article.source && article.source !== 'Yahoo Finance' && article.source !== 'finance.yahoo.com') {
          actualSource = article.source;
        } else if (article.title) {
          const dashPattern = article.title.match(/\s+[-–—]\s+([A-Z][A-Za-z\s&.']+)$/);
          if (dashPattern && dashPattern[1]) {
            const potentialSource = dashPattern[1].trim();
            if (potentialSource.length < 50 && !potentialSource.match(/\d{4}$/)) {
              actualSource = potentialSource;
            }
          }
        }
      }

      return {
        article,
        index,
        date,
        domain,
        actualSource,
        logoUrl: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null,
        imageUrl: article.image || null,
        extractedProvider: null,
        needsMetadataFetch: article.url && items.length <= 10 && !article.image && 
          domain && !BLOCKED_DOMAINS.some(blocked => domain.includes(blocked))
      };
    });

    // PHASE 2: Fetch metadata in PARALLEL for articles that need it
    const metadataPromises = articleData
      .filter(a => a.needsMetadataFetch)
      .map(async (a) => {
        try {
          const contentResult = await DataConnector.fetchWebContent(a.article.url, 8000, true);
          if (contentResult.success) {
            if (contentResult.imageUrl) a.imageUrl = contentResult.imageUrl;
            if (contentResult.providerName) {
              a.extractedProvider = contentResult.providerName;
              const providerDomain = PROVIDER_DOMAINS[contentResult.providerName];
              if (providerDomain) {
                a.logoUrl = `https://www.google.com/s2/favicons?domain=${providerDomain}&sz=128`;
              }
            }
          }
        } catch (error) {
          // Silently fail - will use fallback values
        }
        return a;
      });

    // Wait for ALL metadata fetches to complete in parallel
    await Promise.all(metadataPromises);

    // PHASE 3: Build output and dataCards sequentially (for correct ordering)
    for (const a of articleData) {
      const { article, index, domain } = a;
      
      if (article.url) {
        const articleId = `article-${article.ticker || 'news'}-${index}`;
        const displaySource = a.extractedProvider || a.actualSource;
        
        dataCards.push({
          type: 'article',
          data: {
            id: articleId,
            title: article.title || 'Untitled Article',
            url: article.url,
            source: displaySource,
            domain: domain,
            ticker: article.ticker,
            publishedAt: article.published_at,
            logoUrl: a.logoUrl,
            imageUrl: a.imageUrl,
            content: article.content ? article.content.substring(0, 200) : null
          }
        });
        
        output += `${index + 1}. [VIEW_ARTICLE:${articleId}]\n`;
      }

      if (article.content && detailLevel !== 'summary') {
        const contentLength = detailLevel === 'full' ? 5000 : (detailLevel === 'detailed' ? 1000 : 300);
        output += `   Content: ${article.content.substring(0, contentLength)}${article.content.length > contentLength ? '...' : ''}\n`;
      }

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

      // Press releases: rely on stored content/summary field only
      if (press.content && detailLevel !== 'summary') {
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
        
        // Add to dataCards array for rendering
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
        
        // Use standard VIEW_ARTICLE marker format (parsed by StreamProcessor)
        output += `   **Source:**\n`;
        output += `   [VIEW_ARTICLE:${articleId}]\n`;
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
   * Get user-friendly collection name (delegates to shared schema)
   */
  getCollectionFriendlyName(collection) {
    return getCollectionFriendlyName(collection);
  }

  /**
   * Get user-friendly collection title (delegates to shared schema)
   */
  getCollectionTitle(collection) {
    return getCollectionTitle(collection);
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

module.exports = new ContextEngine();
