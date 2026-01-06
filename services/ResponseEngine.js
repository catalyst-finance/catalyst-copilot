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
`;
  }

  /**
   * Generate contextual thinking message for current phase
   */
  generateThinkingMessage(phase, context) {
    const messages = {
      'plan_start': () => {
        const collections = context.collections.join(', ');
        return `Analyzing ${context.collections.length} data source(s): ${collections}`;
      },
      'plan_generated': () => {
        const priority = context.plan.formattingPlan.filter(p => p.priority >= 4);
        if (priority.length > 0) {
          const sources = priority.map(p => this.getCollectionTitle(p.collection)).join(' and ');
          return `Prioritizing ${sources} for detailed analysis`;
        }
        return `Determining optimal presentation for ${context.plan.formattingPlan.length} sources`;
      },
      'fetching_content': () => {
        return `Fetching ${context.contentType} from ${context.count} ${context.collection}`;
      },
      'formatting': () => {
        return `Formatting ${context.collection} with ${context.detailLevel} detail`;
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
      const thinkingMsg = this.generateThinkingMessage('plan_start', { collections });
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
- Government policy: always show full (content is in database)
- Price targets/ownership: moderate (no external content needed)

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
        const thinkingMsg = this.generateThinkingMessage('plan_generated', { plan });
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
  async executeFormattingPlan(plan, queryResults, DataConnector, sendThinking) {
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
        const thinkingMsg = this.generateThinkingMessage('formatting', {
          collection: this.getCollectionTitle(formatSpec.collection),
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
        intelligenceMetadata
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
   * Format a specific collection based on formatting spec
   */
  async formatCollection(result, formatSpec, DataConnector, sendThinking, dataCards, intelligenceMetadata) {
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
        
        const thinkingMsg = this.generateThinkingMessage('fetching_content', {
          count: itemsToShow.length,
          contentType,
          collection: this.getCollectionTitle(collection)
        });
        if (thinkingMsg) sendThinking('retrieving', thinkingMsg);
      }
    }

    // Format based on collection type
    switch (collection) {
      case 'sec_filings':
        return await this.formatSecFilings(itemsToShow, detailLevel, fetchExternalContent, DataConnector, dataCards, intelligenceMetadata, output);
      
      case 'government_policy':
        return this.formatGovernmentPolicy(itemsToShow, detailLevel, output);
      
      case 'news':
        return await this.formatNews(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output);
      
      case 'price_targets':
        return this.formatPriceTargets(itemsToShow, detailLevel, output);
      
      case 'earnings_transcripts':
        return this.formatEarningsTranscripts(itemsToShow, detailLevel, output);
      
      case 'press_releases':
        return await this.formatPressReleases(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output);
      
      case 'macro_economics':
        return await this.formatMacroEconomics(itemsToShow, detailLevel, fetchExternalContent, DataConnector, output);
      
      case 'ownership':
        return this.formatOwnership(itemsToShow, detailLevel, output);
      
      case 'hype':
        return this.formatHype(itemsToShow, detailLevel, output);
      
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
                output += `   IMAGE ${idx + 1}: ${img.alt || 'Chart/Diagram'}\n`;
                if (img.context) {
                  output += `   Context (text near image): "${img.context}"\n`;
                }
                output += `   [IMAGE_CARD:${imageId}] - Use this marker AFTER discussing this image's content\n\n`;
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
  formatGovernmentPolicy(items, detailLevel, output) {
    items.forEach((doc, index) => {
      output += `${index + 1}. ${doc.title || 'Untitled'} - ${doc.date || 'No date'}\n`;
      if (doc.participants && doc.participants.length > 0) {
        output += `   Participants: ${doc.participants.join(', ')}\n`;
      }
      if (doc.url) {
        output += `   URL: ${doc.url}\n`;
      }

      if (detailLevel !== 'summary' && doc.turns && doc.turns.length > 0) {
        const maxTurns = detailLevel === 'full' ? doc.turns.length : Math.min(20, doc.turns.length);
        output += `\n   === TRANSCRIPT ===\n`;
        doc.turns.slice(0, maxTurns).forEach(turn => {
          output += `   ${turn.speaker}: ${turn.text}\n`;
        });
        if (doc.turns.length > maxTurns) {
          output += `   ... (${doc.turns.length - maxTurns} more turns omitted)\n`;
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
  async formatNews(items, detailLevel, fetchExternal, DataConnector, output) {
    for (let index = 0; index < items.length; index++) {
      const article = items[index];
      const date = article.published_at ? new Date(article.published_at).toLocaleDateString() : 'Unknown date';
      
      output += `${index + 1}. ${article.title || 'Untitled'} - ${date}\n`;
      if (article.ticker) output += `   Ticker: ${article.ticker}\n`;
      if (article.origin) output += `   Source: ${article.origin}\n`;

      if (fetchExternal && article.url && detailLevel === 'full' && items.length <= 5) {
        try {
          const contentResult = await DataConnector.fetchWebContent(article.url, 8000);
          if (contentResult.success && contentResult.content) {
            output += `\n   === FULL ARTICLE ===\n${contentResult.content}\n   === END ARTICLE ===\n`;
          } else if (article.content) {
            output += `   Content: ${article.content.substring(0, detailLevel === 'detailed' ? 1000 : 300)}...\n`;
          }
        } catch (error) {
          if (article.content) {
            output += `   Content: ${article.content.substring(0, detailLevel === 'detailed' ? 1000 : 300)}...\n`;
          }
        }
      } else if (article.content && detailLevel !== 'summary') {
        const contentLength = detailLevel === 'detailed' ? 1000 : 300;
        output += `   Content: ${article.content.substring(0, contentLength)}...\n`;
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
  async formatMacroEconomics(items, detailLevel, fetchExternal, DataConnector, output) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const date = item.date ? new Date(item.date).toLocaleDateString() : 'Unknown date';
      
      output += `${index + 1}. ${item.title || 'Untitled'} - ${date}\n`;
      if (item.country) output += `   Country: ${item.country}\n`;
      if (item.category) output += `   Category: ${item.category}\n`;

      if (fetchExternal && item.url && detailLevel === 'full' && items.length <= 5) {
        try {
          const contentResult = await DataConnector.fetchWebContent(item.url, 8000);
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

      if (item.url) output += `   URL: ${item.url}\n`;
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
      'hype': 'SENTIMENT DATA'
    };
    return titles[collection] || collection.toUpperCase();
  }
}

module.exports = new ResponseEngine();
