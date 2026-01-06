/**
 * Chat Routes
 * Main AI chat endpoint with streaming support
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const openai = require('../config/openai');
const DataConnector = require('../services/DataConnector');
const ConversationManager = require('../services/ConversationManager');
const IntelligenceEngine = require('../services/IntelligenceEngine');
const QueryEngine = require('../services/QueryEngine');
const ResponseEngine = require('../services/ResponseEngine');
const { optionalAuth } = require('../middleware/auth');

// Main AI chat endpoint
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { 
      message, 
      conversationId = null, 
      conversationHistory = []
    } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user?.userId || null;

    console.log('Processing message:', message);
    console.log('User ID:', userId);
    console.log('Conversation ID:', conversationId);
    
    // SET UP SSE IMMEDIATELY - Start streaming right away
    const origin = req.headers.origin;
    if (origin && (origin.endsWith('.figma.site') || origin === 'https://www.figma.com' || origin === 'https://figma.com')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Cache-Control, Connection');
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    console.log('📡 SSE headers sent immediately - streaming enabled');
    
    // Helper function to send thinking updates
    const sendThinking = (phase, content) => {
      res.write(`data: ${JSON.stringify({ type: 'thinking', phase, content })}\n\n`);
      console.log(`💭 Thinking: ${content}`);
    };
    
    // Verify conversation ownership if conversationId provided
    if (conversationId && userId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('user_id')
        .eq('id', conversationId)
        .single();
      
      if (!conversation || conversation.user_id !== userId) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Access denied to this conversation' })}\n\n`);
        return res.end();
      }
    }
    
    // Load conversation history from database if conversationId provided
    let loadedHistory = conversationHistory;
    if (conversationId) {
      loadedHistory = await ConversationManager.loadConversationContext(conversationId, 4000);
      console.log(`Loaded ${loadedHistory.length} messages from conversation ${conversationId}`);
    }

    // ===== AI-NATIVE QUERY ENGINE =====
    console.log('🤖 Using AI-Native Query Engine...');
    
    // AI-generated thinking message for question analysis phase
    try {
      const initialThinking = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Write a 3-5 word status message saying you're analyzing the user's question. Start with a verb. Examples: 'Reading your question...' or 'Understanding your request...'" }],
        temperature: 0.3,
        max_tokens: 15
      });
      // sanitize: remove quotes and the word 'now'
      const rawInit = initialThinking.choices[0].message.content || '';
      const sanitizedInit = rawInit.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
      sendThinking('analyzing', sanitizedInit || 'Analyzing your question...');
    } catch (error) {
      sendThinking('analyzing', 'Analyzing your question...');
    }
    
    let queryIntent;
    let queryResults = [];
    
    try {
      // AI generates the queries directly (with contextual thinking messages)
      const queryPlan = await QueryEngine.generateQueries(
        message, 
        [],
        sendThinking  // Pass thinking function for context-aware messages
      );
      console.log('📋 Query Plan:', JSON.stringify(queryPlan, null, 2));
      
      // Execute the AI-generated queries
      queryResults = await QueryEngine.executeQueries(queryPlan, DataConnector);
      console.log(`✅ Retrieved data from ${queryResults.length} source(s)`);
      
      // Store intent for later use
      queryIntent = {
        intent: queryPlan.intent,
        extractCompaniesFromTranscripts: queryPlan.extractCompanies,
        needsChart: queryPlan.needsChart,
        needsDeepAnalysis: queryPlan.needsDeepAnalysis || false,
        analysisKeywords: queryPlan.analysisKeywords || [],
        tickers: queryPlan.tickers || [],
        queries: queryPlan.queries,
        chartConfig: queryPlan.chartConfig || null  // Pass chartConfig for VIEW_CHART marker
      };
      
    } catch (error) {
      console.error('❌ AI Query Engine failed:', error);
      // Fallback to empty results
      queryIntent = { intent: 'general', tickers: [] };
      queryResults = [];
    }

    // STEP 2: BUILD DATA CONTEXT FROM RESULTS
    
    // Feature flag: Use AI-driven ResponseEngine or legacy hardcoded formatting
    const USE_AI_FORMATTING = true;  // Toggle to false to use legacy formatting
    
    let dataContext = "";
    const dataCards = [];
    const eventData = {};
    let upcomingDatesContext = "";
    let responseStyleGuidelines = null;  // AI-recommended response style
    
    // Intelligence metadata tracking
    let intelligenceMetadata = {
      totalSources: 0,
      sourceFreshness: [],
      dataCompleteness: { hasExpectedData: false, hasPartialData: false },
      tickers: [],
      secFilingTypes: [],
      hasInstitutionalData: false,
      hasPolicyData: false,
      hasEvents: false,
      upcomingEvents: 0,
      institutionalDataDate: null,
      temporalData: {},
      anomalies: [],
      crossRefData: {},
      sentimentData: [],
      secFilings: [],
      entityRelationships: null
    };
    
    // Convert AI query results to data context
    if (queryResults.length > 0) {
      console.log('📝 Building data context from AI query results...');
      
      // === AI-DRIVEN FORMATTING (NEW) ===
      if (USE_AI_FORMATTING) {
        console.log('🎨 Using AI-Native Response Engine...');
        
        try {
          // AI generates intelligent formatting plan (with contextual thinking messages)
          const formattingPlan = await ResponseEngine.generateFormattingPlan(
            queryResults,
            message,
            queryIntent,
            sendThinking  // Pass thinking function for context-aware messages
          );
          
          // Execute the AI-generated formatting plan
          const formatted = await ResponseEngine.executeFormattingPlan(
            formattingPlan,
            queryResults,
            DataConnector,
            sendThinking,
            queryIntent  // Pass query intent with analysisKeywords for smart filtering
          );
          
          dataContext = formatted.dataContext;
          dataCards.push(...formatted.dataCards);
          intelligenceMetadata = { ...intelligenceMetadata, ...formatted.intelligenceMetadata };
          
          // Add VIEW_CHART markers if chartConfig is present
          if (queryIntent.chartConfig) {
            dataContext = ResponseEngine.addChartMarkers(dataContext, queryIntent);
            console.log(`📈 Added chart marker for ${queryIntent.chartConfig.symbol}`);
          }
          
          // Store AI-recommended response style
          if (formattingPlan.responseStyle) {
            responseStyleGuidelines = formattingPlan.responseStyle;
            console.log('📐 Response Style:', responseStyleGuidelines.format, '-', responseStyleGuidelines.tone);
          }
          
          console.log(`✅ AI formatting complete - ${intelligenceMetadata.totalSources} sources`);
        } catch (error) {
          console.error('❌ AI formatting failed, falling back to legacy:', error);
          // Fall through to legacy formatting below
        }
      }
      
      // === LEGACY HARDCODED FORMATTING (FALLBACK) ===
      if (!USE_AI_FORMATTING || dataContext === "") {
        console.log('📝 Using legacy hardcoded formatting...');
      
      for (const result of queryResults) {
        if (result.error) {
          console.error(`Error in ${result.collection}:`, result.error);
          continue;
        }
        
        if (result.collection === 'government_policy' && result.data.length > 0) {
          dataContext += `\n\n═══ GOVERNMENT POLICY STATEMENTS (${result.data.length} documents) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          result.data.forEach((doc, index) => {
            dataContext += `${index + 1}. ${doc.title || 'Untitled'} - ${doc.date || 'No date'}\n`;
            if (doc.participants && doc.participants.length > 0) {
              dataContext += `   Speakers: ${doc.participants.join(', ')}\n`;
            }
            if (doc.source) {
              dataContext += `   Source: ${doc.source}\n`;
            }
            if (doc.url) {
              dataContext += `   URL: ${doc.url}\n`;
            }
            
            // Extract transcript text if available
            if (doc.turns && doc.turns.length > 0) {
              const transcript = doc.turns.map(turn => `${turn.speaker}: ${turn.text}`).join('\n');
              dataContext += `\n   === TRANSCRIPT ===\n${transcript.substring(0, 5000)}\n   === END TRANSCRIPT ===\n\n`;
            }
          });
          
          intelligenceMetadata.hasPolicyData = true;
          intelligenceMetadata.totalSources++;
          
          // Extract companies if requested
          if (queryIntent.extractCompaniesFromTranscripts) {
            console.log('🔍 Extracting companies from transcripts...');
            sendThinking('analyzing', 'Scanning transcripts for company mentions...');
            
            const transcripts = result.data
              .filter(doc => doc.turns && doc.turns.length > 0)
              .map(doc => doc.turns.map(t => t.text).join(' '))
              .join(' ');
            
            if (transcripts.length > 0) {
              try {
                const companyExtractionPrompt = `Extract ALL publicly traded company names from this government policy transcript.

Transcript excerpt (first 8000 chars):
${transcripts.substring(0, 8000)}

Look for companies like: Chevron, ExxonMobil, BP, Shell, Tesla, Apple, Microsoft, Amazon, Google, Meta, NVIDIA, etc.

Return JSON: {"companies": ["CompanyName1", "CompanyName2"]}`;

                const companyResponse = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [{ role: "user", content: companyExtractionPrompt }],
                  temperature: 0.3,
                  max_tokens: 500,
                  response_format: { type: "json_object" }
                });
                
                const { companies } = JSON.parse(companyResponse.choices[0].message.content.trim());
                
                if (companies && companies.length > 0) {
                  dataContext += `\n\n═══ COMPANIES MENTIONED ═══\n`;
                  dataContext += `Extracted ${companies.length} company name(s): ${companies.join(', ')}\n\n`;
                  
                  // Look up ticker symbols
                  for (const companyName of companies) {
                    try {
                      const tickerResponse = await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [{ role: "user", content: `What is the stock ticker symbol for ${companyName}? Return just the ticker symbol.` }],
                        temperature: 0.1,
                        max_tokens: 20
                      });
                      
                      const ticker = tickerResponse.choices[0].message.content.trim().replace(/[^A-Z]/g, '');
                      if (ticker.length >= 1 && ticker.length <= 5) {
                        dataContext += `- ${companyName} (${ticker})\n`;
                        console.log(`✅ ${companyName} → ${ticker}`);
                      }
                    } catch (error) {
                      console.error(`Error looking up ticker for ${companyName}:`, error);
                    }
                  }
                }
              } catch (error) {
                console.error('Error extracting companies:', error);
              }
            }
          }
        }
        
        // Handle other collection types
        if (result.collection === 'price_targets' && result.data.length > 0) {
          dataContext += `\n\n═══ ANALYST PRICE TARGETS (${result.data.length} ratings) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          result.data.forEach((target, index) => {
            const date = target.date ? new Date(target.date).toLocaleDateString() : 'Unknown date';
            dataContext += `${index + 1}. ${target.analyst || 'Unknown Analyst'} - ${date}\n`;
            if (target.action) {
              dataContext += `   Action: ${target.action}\n`;
            }
            if (target.rating_change) {
              dataContext += `   Rating Change: ${target.rating_change}\n`;
            }
            if (target.price_target_change) {
              dataContext += `   Price Target: ${target.price_target_change}\n`;
            }
            dataContext += `\n`;
          });
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'news' && result.data.length > 0) {
          dataContext += `\n\n═══ NEWS ARTICLES (${result.data.length} articles) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          // Check if we need deep analysis (fetch full article content)
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          
          if (needsDeepAnalysis && result.data.length <= 5) {
            sendThinking('retrieving', `Reading ${result.data.length} news article${result.data.length > 1 ? 's' : ''}...`);
            console.log('📰 Deep analysis requested - fetching full news article content...');
          }
          
          for (let index = 0; index < result.data.length; index++) {
            const article = result.data[index];
            const date = article.published_at ? new Date(article.published_at).toLocaleDateString() : 'Unknown date';
            dataContext += `${index + 1}. ${article.title || 'Untitled'} - ${date}\n`;
            if (article.ticker) {
              dataContext += `   Ticker: ${article.ticker}\n`;
            }
            if (article.origin) {
              dataContext += `   Source: ${article.origin}\n`;
            }
            
            // If deep analysis requested and we have a URL, fetch full content
            if (needsDeepAnalysis && article.url && result.data.length <= 5) {
              try {
                const contentResult = await DataConnector.fetchWebContent(article.url, 8000);
                if (contentResult.success && contentResult.content) {
                  dataContext += `\n   === FULL ARTICLE ===\n${contentResult.content}\n   === END ARTICLE ===\n`;
                  console.log(`   ✅ Fetched ${contentResult.contentLength} chars from ${article.origin || 'news source'}`);
                } else if (article.content) {
                  // Fallback to stored content
                  dataContext += `   Content: ${article.content.substring(0, 1000)}...\n`;
                }
              } catch (error) {
                console.error(`   ❌ Error fetching article: ${error.message}`);
                if (article.content) {
                  dataContext += `   Content: ${article.content.substring(0, 1000)}...\n`;
                }
              }
            } else if (article.content) {
              dataContext += `   Content: ${article.content.substring(0, 300)}...\n`;
            }
            
            if (article.url) {
              dataContext += `   URL: ${article.url}\n`;
            }
            dataContext += `\n`;
          }
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'earnings_transcripts' && result.data.length > 0) {
          dataContext += `\n\n═══ EARNINGS TRANSCRIPTS (${result.data.length} transcripts) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          // Earnings transcripts already have full content stored, but show more for deep analysis
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          const contentLength = needsDeepAnalysis ? 10000 : 2000;
          
          result.data.forEach((transcript, index) => {
            const date = transcript.report_date ? new Date(transcript.report_date).toLocaleDateString() : 'Unknown date';
            dataContext += `${index + 1}. ${transcript.ticker} Q${transcript.quarter} ${transcript.year} - ${date}\n`;
            if (transcript.content) {
              dataContext += `   Content: ${transcript.content.substring(0, contentLength)}${transcript.content.length > contentLength ? '...' : ''}\n`;
            }
            dataContext += `\n`;
          });
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'macro_economics' && result.data.length > 0) {
          dataContext += `\n\n═══ ECONOMIC DATA (${result.data.length} items) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          // Check if we need deep analysis (fetch full content from URL)
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          
          if (needsDeepAnalysis && result.data.length <= 5) {
            sendThinking('retrieving', `Reviewing ${result.data.length} economic report${result.data.length > 1 ? 's' : ''}...`);
            console.log('📊 Deep analysis requested - fetching full economic data content...');
          }
          
          for (let index = 0; index < result.data.length; index++) {
            const item = result.data[index];
            const date = item.date ? new Date(item.date).toLocaleDateString() : 'Unknown date';
            
            // Build full URL from tradingeconomics.com base + relative path
            const fullUrl = item.url ? `https://tradingeconomics.com${item.url}` : null;
            
            dataContext += `${index + 1}. ${item.title || 'Untitled'} - ${date}\n`;
            if (item.country) {
              dataContext += `   Country: ${item.country}\n`;
            }
            if (item.category) {
              dataContext += `   Category: ${item.category}\n`;
            }
            
            // If deep analysis requested and we have a URL, fetch full content
            if (needsDeepAnalysis && fullUrl && result.data.length <= 5) {
              try {
                const contentResult = await DataConnector.fetchWebContent(fullUrl, 8000);
                if (contentResult.success && contentResult.content) {
                  dataContext += `\n   === FULL REPORT ===\n${contentResult.content}\n   === END REPORT ===\n`;
                  console.log(`   ✅ Fetched ${contentResult.contentLength} chars from economic source`);
                } else if (item.description) {
                  dataContext += `   Description: ${item.description}\n`;
                }
              } catch (error) {
                console.error(`   ❌ Error fetching economic content: ${error.message}`);
                if (item.description) {
                  dataContext += `   Description: ${item.description}\n`;
                }
              }
            } else if (item.description) {
              dataContext += `   Description: ${item.description.substring(0, 200)}...\n`;
            }
            
            if (fullUrl) {
              dataContext += `   URL: ${fullUrl}\n`;
            }
            dataContext += `\n`;
          }
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'sec_filings' && result.data.length > 0) {
          dataContext += `\n\n═══ SEC FILINGS (${result.data.length} filings) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          // Check if we need deep analysis (fetch actual filing content)
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          const analysisKeywords = queryIntent.analysisKeywords || [];
          
          if (needsDeepAnalysis) {
            sendThinking('retrieving', `Pulling ${result.data.length} SEC filing${result.data.length > 1 ? 's' : ''} from SEC.gov...`);
            console.log('📄 Deep analysis requested - fetching SEC filing content...');
          }
          
          for (let index = 0; index < result.data.length; index++) {
            const filing = result.data[index];
            const date = filing.acceptance_datetime ? new Date(filing.acceptance_datetime).toLocaleDateString() : filing.publication_date;
            dataContext += `${index + 1}. ${filing.form_type} filed on ${date}\n`;
            dataContext += `   Ticker: ${filing.ticker}\n`;
            if (filing.url) {
              dataContext += `   URL: ${filing.url}\n`;
            }
            
            // If deep analysis requested, fetch the actual filing content
            if (needsDeepAnalysis && filing.url) {
              try {
                const contentResult = await DataConnector.fetchSecFilingContent(
                  filing.url,
                  analysisKeywords,
                  25000  // Max content length
                );
                
                if (contentResult.success && contentResult.content) {
                  // Add extraction instructions before the content
                  dataContext += `\n   ⚠️ IMPORTANT: Extract SPECIFIC NUMBERS from the content below (cash: $X, revenue: $X, expenses: $X, trial enrollment: X patients, etc.)\n`;
                  dataContext += `   === ${filing.form_type} CONTENT ===\n${contentResult.content}\n   === END CONTENT ===\n`;
                  console.log(`   ✅ Fetched ${contentResult.contentLength} chars of content from ${filing.form_type}`);
                  
                  // Store filing data for sentiment and entity analysis
                  intelligenceMetadata.secFilings.push({
                    ticker: filing.ticker,
                    formType: filing.form_type,
                    date: filing.acceptance_datetime,
                    content: contentResult.content.substring(0, 5000),
                    url: filing.url
                  });
                  
                  // Extract and add images as data cards
                  if (contentResult.images && contentResult.images.length > 0) {
                    console.log(`   📊 Found ${contentResult.images.length} images in ${filing.form_type}`);
                    dataContext += `\n   === IMAGES/CHARTS IN THIS FILING ===\n`;
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
                      // Add image context AND marker to dataContext so GPT-4o understands what the image shows
                      dataContext += `   IMAGE ${idx + 1}: ${img.alt || 'Chart/Diagram'}\n`;
                      if (img.context) {
                        dataContext += `   Context (text near image): "${img.context}"\n`;
                      }
                      dataContext += `   [IMAGE_CARD:${imageId}] - Use this marker AFTER discussing this image's content\n\n`;
                    });
                    dataContext += `   === END IMAGES ===\n`;
                  }
                }
              } catch (error) {
                console.error(`   ❌ Error fetching content from ${filing.url}:`, error.message);
              }
            }
            
            dataContext += `\n`;
          }
          
          intelligenceMetadata.secFilingTypes.push(...result.data.map(f => f.form_type));
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'ownership' && result.data.length > 0) {
          dataContext += `\n\n═══ INSTITUTIONAL OWNERSHIP (${result.data.length} holdings) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          result.data.forEach((holding, index) => {
            const date = holding.file_date ? new Date(holding.file_date).toLocaleDateString() : 'Unknown date';
            dataContext += `${index + 1}. ${holding.holder_name || 'Unknown Holder'} - ${date}\n`;
            dataContext += `   Ticker: ${holding.ticker}\n`;
            if (holding.shares) {
              dataContext += `   Shares: ${holding.shares.toLocaleString()}\n`;
            }
            if (holding.shares_change) {
              dataContext += `   Change: ${holding.shares_change > 0 ? '+' : ''}${holding.shares_change.toLocaleString()} shares\n`;
            }
            if (holding.total_position_value) {
              dataContext += `   Value: $${holding.total_position_value.toLocaleString()}\n`;
            }
            dataContext += `\n`;
          });
          
          intelligenceMetadata.hasInstitutionalData = true;
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'hype' && result.data.length > 0) {
          dataContext += `\n\n═══ SENTIMENT DATA (${result.data.length} entries) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          result.data.forEach((hype, index) => {
            dataContext += `${index + 1}. ${hype.ticker} - ${hype.timestamp}\n`;
            if (hype.sentiment) {
              dataContext += `   Bullish: ${hype.sentiment.bullishPercent}% | Bearish: ${hype.sentiment.bearishPercent}%\n`;
            }
            if (hype.buzz) {
              dataContext += `   Weekly Articles: ${hype.buzz.articlesInLastWeek} | Buzz: ${hype.buzz.buzz}\n`;
            }
            if (hype.social_sentiment) {
              dataContext += `   Social Score: ${hype.social_sentiment.score} | Mentions: ${hype.social_sentiment.mention}\n`;
            }
            dataContext += `\n`;
          });
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'press_releases' && result.data.length > 0) {
          dataContext += `\n\n═══ PRESS RELEASES (${result.data.length} releases) ═══\n`;
          dataContext += `Reasoning: ${result.reasoning}\n\n`;
          
          // Check if we need deep analysis (fetch full press release content)
          const needsDeepAnalysis = queryIntent.needsDeepAnalysis || false;
          
          if (needsDeepAnalysis && result.data.length <= 5) {
            sendThinking('retrieving', `Reading ${result.data.length} press release${result.data.length > 1 ? 's' : ''}...`);
            console.log('📢 Deep analysis requested - fetching full press release content...');
          }
          
          for (let index = 0; index < result.data.length; index++) {
            const press = result.data[index];
            const date = press.published_date ? new Date(press.published_date).toLocaleDateString() : (press.date ? new Date(press.date).toLocaleDateString() : 'Unknown date');
            dataContext += `${index + 1}. ${press.title || 'Untitled'} - ${date}\n`;
            if (press.ticker) {
              dataContext += `   Ticker: ${press.ticker}\n`;
            }
            
            // If deep analysis requested and we have a URL, fetch full content
            if (needsDeepAnalysis && press.url && result.data.length <= 5) {
              try {
                const contentResult = await DataConnector.fetchWebContent(press.url, 10000);
                if (contentResult.success && contentResult.content) {
                  dataContext += `\n   === FULL PRESS RELEASE ===\n${contentResult.content}\n   === END PRESS RELEASE ===\n`;
                  console.log(`   ✅ Fetched ${contentResult.contentLength} chars from press release`);
                } else if (press.content) {
                  dataContext += `   Content: ${press.content.substring(0, 2000)}...\n`;
                } else if (press.summary) {
                  dataContext += `   Summary: ${press.summary}\n`;
                }
              } catch (error) {
                console.error(`   ❌ Error fetching press release: ${error.message}`);
                if (press.content) {
                  dataContext += `   Content: ${press.content.substring(0, 2000)}...\n`;
                } else if (press.summary) {
                  dataContext += `   Summary: ${press.summary}\n`;
                }
              }
            } else if (press.content) {
              dataContext += `   Content: ${press.content.substring(0, 500)}...\n`;
            } else if (press.summary) {
              dataContext += `   Summary: ${press.summary.substring(0, 200)}...\n`;
            }
            
            if (press.url) {
              dataContext += `   URL: ${press.url}\n`;
            }
            dataContext += `\n`;
          }
          
          intelligenceMetadata.totalSources++;
        }
        
        if (result.collection === 'event_data' && result.data.length > 0) {
          dataContext += `\n\n═══ EVENTS (${result.data.length} events) ═══\n`;
          // Add event formatting here
        }
      }
      } // End legacy formatting
    }

    // STEP 3: PRE-GENERATE EVENT CARDS
    const hasEventContext = conversationHistory && conversationHistory.some(msg => 
      msg.role === 'user' && /event|earnings|FDA|approval|launch|announcement|legal|regulatory/i.test(msg.content)
    );
    
    const shouldFetchEvents = (queryIntent.dataSources || []).some(ds => ds.collection === 'event_data') || hasEventContext;
    let eventCardsContext = "";
    
    if (shouldFetchEvents) {
      const isUpcomingQuery = queryIntent.timeframe === 'upcoming' || queryIntent.isFutureOutlook;
      const today = new Date().toISOString();
      // For roadmap/outlook queries, fetch ALL event types, not just requested ones
      const requestedEventTypes = queryIntent.isFutureOutlook ? [] : (queryIntent.eventTypes || []);
      
      // Use AI to determine which tickers to fetch events for (replaces 135 lines of hardcoded logic)
      let tickersForEvents = [];
      
      try {
        const tickerSelectionPrompt = `You are an intelligent ticker selection system. Determine which stock tickers should have their events fetched.

User Query: "${message}"
Specific Tickers Mentioned: ${queryIntent.tickers.length > 0 ? queryIntent.tickers.join(', ') : 'none'}
Event Types Requested: ${queryIntent.eventTypes.length > 0 ? queryIntent.eventTypes.join(', ') : 'all types'}

Task: Return a list of stock tickers (max 6) that should have their events fetched. Rules:
1. If specific tickers are mentioned in the query → use ONLY those tickers (e.g., "What is MNMD's roadmap?" → ["MNMD"])
2. For broad market queries → suggest the most relevant tickers based on query topic and context
3. Maximum 6 tickers total

Return JSON only: {"tickers": ["AAPL", "TSLA"], "reasoning": "brief explanation"}`;


        const tickerSelectionResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: tickerSelectionPrompt }],
          temperature: 0.2,
          max_tokens: 300,
          response_format: { type: "json_object" }
        });
        
        const tickerSelection = JSON.parse(tickerSelectionResponse.choices[0].message.content.trim());
        tickersForEvents = tickerSelection.tickers || [];
        
        if (tickersForEvents.length > 0) {
          console.log(`🎯 AI selected tickers for events: ${tickersForEvents.join(', ')} - ${tickerSelection.reasoning}`);
        } else {
          // Fallback: use first ticker from query
          tickersForEvents = queryIntent.tickers.slice(0, 6);
          console.log(`⚠️ AI returned no tickers, using fallback: ${tickersForEvents.join(', ')}`);
        }
      } catch (error) {
        console.error('Error in AI ticker selection:', error);
        // Fallback logic if AI fails - use tickers from query intent
        if (queryIntent.tickers.length > 0) {
          tickersForEvents = queryIntent.tickers.slice(0, 6);
        } else {
          tickersForEvents = [];
        }
        console.log(`⚠️ Fallback ticker selection: ${tickersForEvents.join(', ')}`);
      }
      
      const uniqueTickers = [...new Set(tickersForEvents)].slice(0, 6);
      
      try {
        const eventPromises = uniqueTickers.map(async (ticker) => {
          try {
            const eventsQuery = {
              ticker,
              title: { $ne: null },
              aiInsight: { $ne: null }
            };
            
            if (requestedEventTypes.length > 0) {
              eventsQuery.type = { $in: requestedEventTypes };
            }
            
            if (isUpcomingQuery) {
              eventsQuery.actualDateTime_et = { $gte: today };
            }
            
            const eventsResult = await DataConnector.getEvents({
              query: eventsQuery,
              limit: 5,
              sort: isUpcomingQuery ? { actualDateTime_et: 1 } : { actualDateTime_et: -1 }
            });
            
            return eventsResult.data || [];
          } catch (error) {
            console.error(`Error fetching events for ${ticker}:`, error);
            return [];
          }
        });
        
        const allEventsArrays = await Promise.all(eventPromises);
        const allEvents = allEventsArrays.flat();
        
        allEvents.sort((a, b) => {
          const dateA = new Date(a.actualDateTime_et || a.actualDateTime || 0);
          const dateB = new Date(b.actualDateTime_et || b.actualDateTime || 0);
          return isUpcomingQuery ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        });
        
        const topEvents = allEvents.slice(0, 5);
        
        if (topEvents.length > 0) {
          eventCardsContext = `\n\n**CRITICAL - EVENT CARDS TO DISPLAY INLINE:**\nThe following ${topEvents.length} events MUST be integrated into your timeline/roadmap sections - DO NOT create a separate "Event Cards" or "Important Events" section at the end. Each event should appear in the appropriate time period section (Q1, Q2, etc.) with its [EVENT_CARD:...] marker placed at the end of the bullet point describing that event:\n\n`;
          topEvents.forEach((event, index) => {
            const eventDate = new Date(event.actualDateTime_et || event.actualDateTime).toLocaleDateString();
            const eventId = event.id || `${event.ticker}_${event.type}_${(event.actualDateTime_et || event.actualDateTime)}`;
            eventCardsContext += `${index + 1}. ${event.ticker} - ${event.title} (${event.type}) on ${eventDate}\n   AI Insight: ${event.aiInsight}\n   Marker to use: [EVENT_CARD:${eventId}]\n\n`;
          });
          eventCardsContext += `\n**INTEGRATION RULES:**\n- Place each event in the appropriate timeline section (e.g., May 2026 events go in Q2 2026)\n- Add the [EVENT_CARD:...] marker at the END of the bullet point describing that specific event\n- NEVER create a separate section like "Important Event Cards" or "Events Summary" - events must be woven into the narrative\n- Example: "• VOYAGE Phase 3 topline data expected May 15, 2026, which could de-risk the MM120 platform [EVENT_CARD:MNMD_clinical_2026-05-15T09:00:00+00:00]"`;
          console.log(`📋 Event Cards Context Built: ${topEvents.length} events with inline markers`);
        }
        
        for (const event of topEvents) {
          const eventId = event.id || `${event.ticker}_${event.type}_${event.actualDateTime_et || event.actualDateTime}`;
          eventData[eventId] = {
            id: event.id || eventId,
            ticker: event.ticker,
            title: event.title,
            type: event.type,
            datetime: event.actualDateTime_et || event.actualDateTime,
            aiInsight: event.aiInsight,
            impact: event.impact
          };
          dataCards.push({
            type: "event",
            data: eventData[eventId]
          });
        }
      } catch (error) {
        console.error("Error generating event cards:", error);
      }
    }
    
    // STEP 4: GENERATE STOCK CARDS
    const isBiggestMoversQuery = queryIntent.isBiggestMoversQuery || false;
    
    if (isBiggestMoversQuery && queryIntent.tickers && queryIntent.tickers.length > 0) {
      try {
        const stockDataPromises = queryIntent.tickers.map(async (ticker) => {
          try {
            const stockResult = await DataConnector.getStockData(ticker, 'current');
            if (stockResult.success && stockResult.data.length > 0) {
              return stockResult.data[0];
            }
          } catch (error) {
            console.error(`Error fetching data for ${ticker}:`, error);
          }
          return null;
        });
        
        const stocksData = (await Promise.all(stockDataPromises)).filter(s => s !== null);
        stocksData.sort((a, b) => Math.abs(b.change_percent || 0) - Math.abs(a.change_percent || 0));
        
        const topMovers = stocksData.slice(0, Math.min(5, stocksData.length));
        
        const companyDataPromises = topMovers.map(async (quote) => {
          try {
            const { data, error } = await supabase
              .from('company_information')
              .select('name')
              .eq('symbol', quote.symbol)
              .limit(1)
              .single();
            
            if (data) {
              return { symbol: quote.symbol, name: data.name };
            }
          } catch (error) {
            console.error(`Error fetching company name for ${quote.symbol}:`, error);
          }
          return { symbol: quote.symbol, name: quote.symbol };
        });
        
        const companyNames = await Promise.all(companyDataPromises);
        const companyNameMap = Object.fromEntries(companyNames.map(c => [c.symbol, c.name]));
        
        if (topMovers.length > 0) {
          dataContext += `\n\n=== BIGGEST MOVERS (TOP ${topMovers.length}) ===\n`;
          for (const quote of topMovers) {
            const company = companyNameMap[quote.symbol] || quote.symbol;
            dataContext += `\n${quote.symbol} (${company}):\n`;
            dataContext += `- Current Price: $${quote.close?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Change: $${quote.change?.toFixed(2) || 'N/A'} (${quote.change_percent?.toFixed(2) || 'N/A'}%)\n`;
            dataContext += `- Day High: $${quote.high?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Day Low: $${quote.low?.toFixed(2) || 'N/A'}\n`;
            dataContext += `- Volume: ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}\n`;
          }
        }
        
        for (const quote of topMovers) {
          dataCards.push({
            type: "stock",
            data: {
              ticker: quote.symbol,
              company: companyNameMap[quote.symbol] || quote.symbol,
              price: quote.close,
              change: quote.change,
              changePercent: quote.change_percent,
              chartData: []
            }
          });
        }
      } catch (error) {
        console.error("Error fetching biggest movers:", error);
      }
    } else {
      // Check if price data is requested in dataSources (intraday_prices or daily_prices)
      const priceDataRequested = (queryIntent.dataSources || []).some(ds => 
        ['intraday_prices', 'daily_prices', 'finnhub_quote_snapshots'].includes(ds.collection)
      );
      const shouldShowIntradayChart = queryIntent.needsChart || priceDataRequested;
      const ticker = queryIntent.tickers && queryIntent.tickers.length > 0 ? queryIntent.tickers[0] : null;
      
      if (ticker && (shouldShowIntradayChart || queryIntent.intent === 'stock_price')) {
        try {
          const isVolumeQuery = /volume|traded|trading.*shares|shares.*traded/i.test(message);
          
          let priceTable = 'intraday_prices';
          let chartTimeframe = 'intraday';
          
          if (queryIntent.dateRange) {
            const startDate = new Date(queryIntent.dateRange.start);
            const endDate = new Date(queryIntent.dateRange.end);
            const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff <= 1) {
              priceTable = 'intraday_prices';
              chartTimeframe = 'intraday';
            } else if (daysDiff <= 7) {
              priceTable = 'one_minute_prices';
              chartTimeframe = '1week';
            } else if (daysDiff <= 30) {
              priceTable = 'hourly_prices';
              chartTimeframe = '1month';
            } else {
              priceTable = 'daily_prices';
              chartTimeframe = 'daily';
            }
          }
          
          const stockResult = await DataConnector.getStockData(ticker, 'current');
          
          if (stockResult.success && stockResult.data.length > 0) {
            const quote = stockResult.data[0];
            
            let companyName = ticker;
            try {
              const { data, error } = await supabase
                .from('company_information')
                .select('name')
                .eq('symbol', ticker)
                .limit(1)
                .single();
              
              if (data) {
                companyName = data.name;
              }
            } catch (error) {
              console.error(`Error fetching company name for ${ticker}:`, error);
            }
            
            let priceHistory = [];
            let chartReference = null;
            
            if (priceTable === 'daily_prices') {
              const startDate = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const endDate = queryIntent.dateRange?.end || new Date().toISOString().split('T')[0];
              
              const { data: dailyData, error: dailyError } = await supabase
                .from('daily_prices')
                .select('date, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: true });
              
              if (!dailyError && dailyData && dailyData.length > 0) {
                priceHistory = dailyData.map(row => ({
                  timestamp: row.date,
                  open: row.open,
                  high: row.high,
                  low: row.low,
                  close: row.close,
                  volume: row.volume
                }));
              }
            } else if (priceTable === 'hourly_prices') {
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              const { data: hourlyData, error: hourlyError } = await supabase
                .from('hourly_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (!hourlyError && hourlyData && hourlyData.length > 0) {
                priceHistory = hourlyData;
              }
            } else if (priceTable === 'one_minute_prices') {
              const startTime = queryIntent.dateRange?.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              const endTime = queryIntent.dateRange?.end || new Date().toISOString();
              
              const { data: minuteData, error: minuteError } = await supabase
                .from('one_minute_prices')
                .select('timestamp, open, high, low, close, volume')
                .eq('symbol', ticker)
                .gte('timestamp', startTime)
                .lte('timestamp', endTime)
                .order('timestamp', { ascending: true });
              
              if (!minuteError && minuteData && minuteData.length > 0) {
                priceHistory = minuteData;
              }
            } else {
              const targetDate = new Date();
              const etOffset = -5 * 60;
              const etDate = new Date(targetDate.getTime() + (etOffset + targetDate.getTimezoneOffset()) * 60000);
              const dateStr = etDate.toISOString().split('T')[0];
              
              chartReference = {
                table: 'intraday_prices',
                symbol: ticker,
                dateRange: {
                  start: `${dateStr}T00:00:00`,
                  end: `${dateStr}T23:59:59`
                },
                columns: ['timestamp_et', 'price', 'volume'],
                orderBy: 'timestamp_et.asc'
              };
            }
            
            dataCards.push({
              type: "stock",
              data: {
                ticker: quote.symbol,
                company: companyName,
                price: quote.close,
                change: quote.change,
                changePercent: quote.change_percent,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                previousClose: quote.previous_close,
                volume: quote.volume,
                chartReference: chartReference,
                chartData: priceHistory.length > 0 ? priceHistory : null,
                chartTimeframe: chartTimeframe,
                priceTable: priceTable
              }
            });
            
            dataContext += `\n\n**STOCK CARD DATA FOR ${ticker}:**
- Current Price: $${quote.close.toFixed(2)}
- Change: ${quote.change >= 0 ? '+' : ''}$${quote.change.toFixed(2)} (${quote.change_percent >= 0 ? '+' : ''}${quote.change_percent.toFixed(2)}%)
- Day High: $${quote.high?.toFixed(2) || 'N/A'}
- Day Low: $${quote.low?.toFixed(2) || 'N/A'}
- Previous Close: $${quote.previous_close?.toFixed(2) || 'N/A'}`;
            
            if (priceHistory.length > 0) {
              const oldestPrice = priceHistory[0].close;
              const newestPrice = priceHistory[priceHistory.length - 1].close;
              const periodChange = ((newestPrice - oldestPrice) / oldestPrice * 100).toFixed(2);
              dataContext += `\n- Chart Period: ${priceHistory.length} data points from ${priceTable}`;
              dataContext += `\n- Period Performance: ${periodChange >= 0 ? '+' : ''}${periodChange}%`;
            }
            
            if (isVolumeQuery) {
              const volumeResult = await DataConnector.getVolumeData(ticker, 'intraday');
              
              if (volumeResult.success && volumeResult.data.totalVolume > 0) {
                dataContext += `\n- Trading Volume (Real-time Intraday): ${volumeResult.data.totalVolume.toLocaleString()} shares`;
                dataContext += `\n- Volume Data Points: ${volumeResult.data.dataPoints || 0} tick-by-tick records`;
              } else {
                dataContext += `\n- Trading Volume (Daily): ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
              }
            } else {
              dataContext += `\n- Trading Volume: ${quote.volume ? quote.volume.toLocaleString() + ' shares' : 'N/A'}`;
            }
            
            dataContext += `\n\n**IMPORTANT: Use this exact price data in your response. Do not use any other price information.**`;
          }
        } catch (error) {
          console.error("Error fetching stock data:", error);
        }
      }
    }

    // STEP 5: BUILD CONTEXT MESSAGE
    const contextMessage = '';

    // STEP 5.5: INTELLIGENT ANALYSIS
    try {
      const synthesisThinking = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: `Write a 3-5 word status message saying you're analyzing ${intelligenceMetadata.totalSources} data sources. Examples: Connecting the dots..., Synthesizing insights..., Analyzing data patterns...` }],
        temperature: 0.3,
        max_tokens: 15
      });
      const rawSynth = synthesisThinking.choices[0].message.content || '';
      const sanitizedSynth = rawSynth.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
      sendThinking('synthesizing', sanitizedSynth || 'Analyzing data patterns...');
    } catch (error) {
      sendThinking('synthesizing', 'Analyzing data patterns...');
    }
    
    // Multi-step query decomposition
    const subQueries = IntelligenceEngine.decomposeComplexQuery(message, queryIntent);
    if (subQueries.length > 0) {
      console.log('🧩 Complex Query Decomposed:', subQueries);
    }
    
    // Detect anomalies in temporal patterns
    Object.keys(intelligenceMetadata.temporalData).forEach(ticker => {
      const filings = intelligenceMetadata.temporalData[ticker].filings;
      if (filings.length >= 3) {
        const pattern = IntelligenceEngine.analyzeTemporalPatterns(filings, `${ticker} SEC filings`);
        if (pattern.hasPattern || pattern.insights?.length > 0) {
          console.log(`📈 Temporal Pattern for ${ticker}:`, pattern);
          intelligenceMetadata.anomalies.push({
            type: 'temporal_pattern',
            ticker,
            pattern
          });
        }
        
        // Detect filing frequency anomalies
        const filingCounts = filings.map((f, i) => ({ value: 1, date: f.date }));
        const anomalies = IntelligenceEngine.detectAnomalies(filingCounts, `${ticker} filing frequency`);
        if (anomalies.length > 0) {
          console.log(`⚠️ Anomalies detected for ${ticker}:`, anomalies);
          intelligenceMetadata.anomalies.push(...anomalies);
        }
      }
    });
    
    // Identify missing data
    const missingData = IntelligenceEngine.identifyMissingData(queryIntent, intelligenceMetadata);
    if (missingData.length > 0) {
      console.log('🔍 Missing Data Detected:', missingData);
    }
    
    // Generate follow-up suggestions
    const followUps = IntelligenceEngine.generateFollowUps(queryIntent, intelligenceMetadata);
    console.log('💡 Suggested Follow-ups:', followUps);
    
    // Sentiment analysis on SEC filings
    const sentiments = [];
    intelligenceMetadata.secFilings.forEach(filing => {
      const sentiment = IntelligenceEngine.analyzeSentiment(
        filing.content,
        `${filing.ticker} ${filing.formType}`
      );
      if (sentiment.hasSentiment) {
        sentiment.date = filing.date;
        sentiments.push(sentiment);
        intelligenceMetadata.sentimentData.push(sentiment);
      }
    });
    
    if (sentiments.length > 0) {
      console.log('💬 Sentiment Analysis:', sentiments);
      
      // Compare sentiments if multiple filings
      if (sentiments.length >= 2) {
        const sentimentComparison = IntelligenceEngine.compareSentiments(sentiments);
        if (sentimentComparison.hasComparison) {
          console.log('📊 Sentiment Comparison:', sentimentComparison);
          intelligenceMetadata.anomalies.push({
            type: 'sentiment_shift',
            data: sentimentComparison
          });
        }
      }
    }
    
    // Build entity relationships
    if (intelligenceMetadata.secFilings.length > 0) {
      const entities = IntelligenceEngine.buildEntityRelationships({
        secFilings: intelligenceMetadata.secFilings
      });
      intelligenceMetadata.entityRelationships = entities;
      
      if (entities.connections.length > 0) {
        console.log('🔗 Entity Relationships:', entities.connections);
      }
    }
    
    // Add intelligence insights to context
    let intelligenceContext = '';
    
    if (missingData.length > 0) {
      intelligenceContext += `\n\n═══ DATA GAPS IDENTIFIED ═══\n`;
      missingData.forEach(gap => {
        intelligenceContext += `- ${gap.message}\n`;
      });
    }
    
    if (intelligenceMetadata.anomalies.length > 0) {
      intelligenceContext += `\n\n═══ PATTERNS & ANOMALIES ═══\n`;
      intelligenceMetadata.anomalies.forEach(anomaly => {
        if (anomaly.pattern) {
          intelligenceContext += `- ${anomaly.pattern.message}\n`;
          if (anomaly.pattern.insights) {
            anomaly.pattern.insights.forEach(insight => {
              intelligenceContext += `  • ${insight.message}\n`;
            });
          }
        } else if (anomaly.type === 'sentiment_shift' && anomaly.data) {
          intelligenceContext += `- Sentiment Analysis: ${anomaly.data.message}\n`;
          if (anomaly.data.insights) {
            anomaly.data.insights.forEach(insight => {
              intelligenceContext += `  • ${insight}\n`;
            });
          }
        } else if (anomaly.message) {
          intelligenceContext += `- ${anomaly.message}\n`;
        }
      });
    }
    
    // Add sentiment insights
    if (intelligenceMetadata.sentimentData.length > 0) {
      intelligenceContext += `\n\n═══ MANAGEMENT SENTIMENT ═══\n`;
      intelligenceMetadata.sentimentData.forEach(s => {
        intelligenceContext += `- ${s.message} (${s.scores.positive}% positive, ${s.scores.negative}% negative)\n`;
      });
    }
    
    // Add entity relationships
    if (intelligenceMetadata.entityRelationships && intelligenceMetadata.entityRelationships.connections.length > 0) {
      intelligenceContext += `\n\n═══ RELATED ENTITIES ═══\n`;
      const topConnections = intelligenceMetadata.entityRelationships.connections.slice(0, 5);
      topConnections.forEach(conn => {
        intelligenceContext += `- ${conn.from} → ${conn.to} (${conn.type} in ${conn.source})\n`;
      });
    }
    
    if (followUps.length > 0) {
      intelligenceContext += `\n\n═══ SUGGESTED FOLLOW-UP QUESTIONS ═══\n`;
      intelligenceContext += `You might also want to explore:\n`;
      followUps.forEach((q, i) => {
        intelligenceContext += `${i + 1}. ${q}\n`;
      });
    }

    // STEP 6: PREPARE SYSTEM PROMPT (truncated for brevity - full prompt in original)
    const systemPrompt = buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext, responseStyleGuidelines);

    // Debug: Check if VIEW_ARTICLE markers are in dataContext
    const viewArticleMatches = (dataContext.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
    if (viewArticleMatches.length > 0) {
      console.log(`🖼️  Data context contains ${viewArticleMatches.length} VIEW_ARTICLE markers:`, viewArticleMatches);
    }

    // Build messages array (text-only - SEC.gov blocks image downloads)
    const messages = [
      { role: "system", content: systemPrompt },
      ...loadedHistory || [],
      { role: "user", content: message }
    ];

    console.log("Calling OpenAI API with", messages.length, "messages");

    // STEP 7: CALL OPENAI WITH STREAMING
    let finalConversationId = conversationId;
    let newConversation = null;
    
    if (userId && !conversationId) {
      try {
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .insert([{
            user_id: userId,
            title: ConversationManager.generateTitle(message),
            metadata: {}
          }])
          .select()
          .single();
        
        if (convError) throw convError;
        finalConversationId = conv.id;
        newConversation = conv;
        console.log('Created new conversation:', finalConversationId);
      } catch (error) {
        console.error('Error creating conversation:', error);
      }
    }

    // Send metadata with intelligence insights
    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      dataCards,
      eventData,
      conversationId: finalConversationId,
      newConversation: newConversation,
      timestamp: new Date().toISOString(),
      intelligence: {
        missingData,
        anomalies: intelligenceMetadata.anomalies,
        followUps,
        sentiments: intelligenceMetadata.sentimentData,
        entityRelationships: intelligenceMetadata.entityRelationships
      }
    })}\n\n`);

    // Send final thinking phase before OpenAI
    try {
      const finalThinking = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Write a 3-5 word status message saying you're preparing the final response. Examples: Preparing your analysis..., Crafting your answer..., Finalizing insights..." }],
        temperature: 0.3,
        max_tokens: 15
      });
      const rawFinal = finalThinking.choices[0].message.content || '';
      const sanitizedFinal = rawFinal.replace(/["']/g, '').replace(/\bnow\b/ig, '').trim();
      sendThinking('synthesizing', sanitizedFinal || 'Finalizing your answer...');
    } catch (error) {
      sendThinking('synthesizing', 'Finalizing your answer...');
    }

    // Call OpenAI with text-only streaming (SEC.gov blocks image downloads)
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 16000,
      stream: true
    });

    let fullResponse = '';
    let finishReason = null;
    let model = null;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
      }
      
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      
      if (chunk.model) {
        model = chunk.model;
      }
    }

    // Log full response with visible formatting characters for debugging
    console.log('\n📄 FULL RESPONSE WITH FORMATTING:');
    console.log('='.repeat(80));
    console.log(fullResponse);
    console.log('='.repeat(80));
    console.log('\n🔍 ESCAPED VERSION (shows \\n, \\t, etc):');
    console.log(JSON.stringify(fullResponse, null, 2));
    console.log('='.repeat(80));
    
    // Debug: Check if GPT-4 preserved VIEW_ARTICLE markers
    const responseViewArticleMatches = (fullResponse.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
    if (viewArticleMatches.length > 0) {
      if (responseViewArticleMatches.length === 0) {
        console.log(`⚠️  WARNING: Data had ${viewArticleMatches.length} VIEW_ARTICLE markers but GPT-4 response has 0!`);
      } else if (responseViewArticleMatches.length < viewArticleMatches.length) {
        console.log(`⚠️  WARNING: Data had ${viewArticleMatches.length} VIEW_ARTICLE markers but GPT-4 only kept ${responseViewArticleMatches.length}`);
      } else {
        console.log(`✅ GPT-4 preserved all ${responseViewArticleMatches.length} VIEW_ARTICLE markers`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    
    // Save messages to database after streaming completes
    if (userId) {
      try {
        const messagesToSave = [
          {
            conversation_id: finalConversationId,
            role: 'user',
            content: message,
            token_count: ConversationManager.estimateTokens(message),
            metadata: { 
              query_intent: queryIntent,
              tickers_queried: queryIntent.tickers || [],
              data_sources: (queryIntent.dataSources || []).map(ds => ds.collection)
            }
          },
          {
            conversation_id: finalConversationId,
            role: 'assistant',
            content: fullResponse,
            data_cards: dataCards.length > 0 ? dataCards : null,
            token_count: ConversationManager.estimateTokens(fullResponse),
            metadata: {
              model: model || 'gpt-4o-mini',
              finish_reason: finishReason
            }
          }
        ];
        
        const { error: msgError } = await supabase
          .from('messages')
          .insert(messagesToSave);
        
        if (msgError) throw msgError;
        console.log('Saved messages to conversation:', finalConversationId);
        
      } catch (error) {
        console.error('Error saving conversation:', error);
      }
    }

  } catch (error) {
    console.error('Chat error:', error);
    
    // Check if SSE headers already sent
    if (res.headersSent) {
      // Send error through SSE stream
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: 'An error occurred while processing your request',
        details: error.message 
      })}\n\n`);
      res.end();
    } else {
      // Headers not sent yet, can use regular JSON response
      res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
      });
    }
  }
});

/**
 * Build the system prompt for OpenAI
 */
function buildSystemPrompt(contextMessage, dataContext, upcomingDatesContext, eventCardsContext, intelligenceContext = '', responseStyleGuidelines = null) {
  // Build AI-recommended style section
  let styleInstructions = '';
  if (responseStyleGuidelines) {
    styleInstructions = `

**AI-RECOMMENDED RESPONSE STYLE:**
Format: ${responseStyleGuidelines.format}
Tone: ${responseStyleGuidelines.tone}
${responseStyleGuidelines.instructions ? `Instructions: ${responseStyleGuidelines.instructions}` : ''}

**APPLY THIS STYLE TO YOUR RESPONSE** - The AI has analyzed the user's question and data type to determine the optimal presentation format above. Structure your response accordingly.
`;
  }
  
  return `You are Catalyst Copilot, a financial AI assistant specializing in connecting market data, institutional activity, and policy developments.

ROLE & EXPERTISE:
- Financial data analyst with real-time qualitative and quantitative market intelligence
- Expert at connecting the dots across SEC filings, stock movements, and macro events
- Skilled in synthesizing complex data into clear, actionable insights
- Deep understanding of regulatory environments and their market impacts
- Proficient in interpreting SEC filings, earnings reports, and market trends
- Advanced pattern recognition and anomaly detection

**CRITICAL: CONNECTING QUALITATIVE + QUANTITATIVE DATA (CORRELATION ANALYSIS)**

When your data context contains BOTH qualitative data (news, SEC filings, price targets, earnings) AND quantitative data (stock prices from finnhub_quote_snapshots, one_minute_prices, daily_prices), you MUST:

1. **LOOK FOR CORRELATIONS**: Actively connect news sentiment to price movements
   - If news is overwhelmingly positive AND price is up → Note this correlation: "The positive news sentiment appears reflected in today's X% gain"
   - If news is negative AND price is down → Connect the dots: "The concerning headlines may be driving the X% decline"
   - If sentiment and price diverge → Highlight this as notable: "Interestingly, despite negative news, the stock is up X% - suggesting the market may have already priced in concerns"

2. **SPECULATE ON CAUSATION** (within reason):
   - When multiple positive/negative news items cluster around a price movement, suggest the likely connection
   - Use hedged language: "This price action likely reflects...", "The surge appears driven by...", "Market reaction suggests..."
   - Don't claim certainty, but DO make intelligent connections

3. **INCLUDE PRICE CONTEXT WITH NEWS**:
   - When discussing news, weave in the price data: "As Tesla faces increased competition from BYD, shares are currently trading at $XXX, down X% today"
   - Mention daily change percentage when available: "The stock is up/down X% on the day"
   - Include current price, daily high/low, and percent change when discussing any ticker's news

4. **EXPLAIN PRICE MOVEMENTS**:
   - When asked "why did X go up/down", synthesize the qualitative data to explain the quantitative movement
   - Lead with the most likely catalyst (biggest news story, analyst upgrade/downgrade, SEC filing)
   - Acknowledge if multiple factors may be contributing

5. **MINI PRICE CHART MARKERS** (when chartConfig is available):
   - If a chartConfig is provided in the query context, include a [VIEW_CHART:SYMBOL:TIMERANGE] marker
   - Example: "Tesla shares are reacting to the news [VIEW_CHART:TSLA:1D]" 
   - Valid timeRanges: 1D, 5D, 1W, 1M, 3M, 6M, 1Y, 5Y
   - **IMPORTANT**: When including a 1D chart, DO NOT write a separate "Intraday Analysis" text section - the chart already shows intraday movement visually. Skip any redundant intraday text analysis.

6. **MARKET HOURS LANGUAGE**:
   - US markets are open 9:30 AM - 4:00 PM ET on weekdays
   - During market hours, NEVER say "closing at" or "closed at" - use "currently trading at" or "trading at"
   - Only use "closed at" after 4:00 PM ET or for historical data
   - The current price 'c' in finnhub_quote_snapshots is the LIVE price during market hours, not a closing price

**PRICE DATA FORMAT AND SOURCES**:

**stock_quote_now (Real-time Current Prices)**:
- close = LIVE current price (updated continuously via WebSocket)
- timestamp = when this price was recorded
- This is the CURRENT price - always use this for "current price", "trading at", "now at"

**finnhub_quote_snapshots (Historical Snapshots)**:
- previous_close (pc) = yesterday's closing price - use this for daily change calculations
- Snapshots taken at market open/close only
- Fields: c, o, h, l (from snapshot time), pc (previous close), dp/d (stale during day)

**one_minute_prices (Intraday Historical Bars)**:
- Historical 1-minute OHLCV bars for charting and intraday analysis
- Use ONLY for: populating charts, analyzing intraday movements, session high/low
- Do NOT use for current price - use stock_quote_now instead

**CRITICAL - DAILY CHANGE CALCULATION**:
- **Current price**: stock_quote_now.close (real-time)
- **Previous close**: finnhub_quote_snapshots.previous_close
- **Daily change formula**: (stock_quote_now.close - previous_close) / previous_close * 100
- Example: If stock_quote_now.close=$434.01 and previous_close=$451.67: (434.01-451.67)/451.67 = -3.91%
- NEVER use first vs last intraday bar for daily change - that's session movement, not daily change

**CORRELATION RESPONSE EXAMPLES**:

Example 1 - News with Price Context:
"NVDA is seeing significant positive coverage today around their AI chip announcement. The stock is currently trading at $892.50, up 4.2% on the day, suggesting strong market reception to the news. [VIEW_ARTICLE:article-NVDA-0]"

Example 2 - Explaining Price Movement:
"AAPL's 3.1% decline today appears linked to several factors: weak iPhone sales in China were reported this morning, and an analyst at Goldman downgraded the stock from Buy to Hold with a price target cut from $210 to $185. The combination of these negative catalysts is driving the selloff."

Example 3 - Sentiment-Price Divergence:
"Despite predominantly bearish headlines around Tesla's Q4 delivery miss, the stock is actually up 1.5% today. This could indicate the miss was already priced in, or that investors are looking past near-term challenges to focus on the company's AI and robotics initiatives discussed in recent press."
${styleInstructions}

**CRITICAL: FORMATTING APPLIES TO ALL RESPONSES**
These formatting guidelines apply to EVERY response you generate - whether it's the first message in a conversation or a follow-up question. Never revert to plain paragraph format for follow-ups. Always use structured formatting with bold headers, bullet points, and proper spacing.

**DEPTH AND THOROUGHNESS (CRITICAL)**:
• Default to comprehensive, detailed responses - users want depth, not brevity
• When analyzing data, extract multiple insights and connect them to broader context
• For SEC filings, discuss both operational AND financial aspects with specific numbers
• For news, provide 4-6 sentences per story covering implications and market dynamics
• Don't summarize when you can analyze - users value detailed understanding over quick summaries
• If you have rich data context, use it fully - don't leave insights on the table

RESPONSE GUIDELINES:
• **MANDATORY: Every source mentioned must be cited with full URL** - Cannot reference a filing without \`[TICKER Form - Date](URL)\` format
• **MANDATORY: Every SEC filing with an image must include its [IMAGE_CARD:...] marker** - Check data context for all available IMAGE_CARD markers
• **When query is about SEC filings/analysis, lead with SEC filing insights FIRST** - Event cards and other context should appear after the filing analysis
• **HOLISTIC ANALYSIS REQUIRED**: When SEC filing content contains BOTH operational/qualitative data (product development, trials, partnerships, R&D, roadmap) AND financial/quantitative data (revenue, cash, expenses, balance sheet), you MUST analyze and discuss BOTH aspects equally. Connect the dots showing how operational progress impacts financial position and vice versa. Never discuss only financials or only development - paint the complete picture.
• Lead with the most important insight or answer
• Connect multiple data points to tell a cohesive story
• Cite specific numbers, dates, percentages, and sources from SEC filings
• Flag contradictions or unusual patterns when they appear
• **Provide comprehensive, detailed analysis** - Don't hold back on depth and context. Users want thorough insights.
• When event cards are shown, explain the significance of ALL events with context - users will see every card
• When SEC filing images are available ([IMAGE_CARD:...] markers), place them immediately after discussing that filing
• Use professional but conversational tone - avoid jargon unless necessary
• When SEC filing content is provided, extract and discuss specific details, numbers, and insights from the text

**CITATION FORMAT** (CRITICAL - ALWAYS CITE SOURCES - THIS IS MANDATORY):

**ABSOLUTELY FORBIDDEN - NEVER DO THIS:**
❌ Creating a separate "Citations:", "Sources:", or "References:" section at the end of your response
❌ Listing filings in bullet points at the bottom of your response
❌ Saying "The filings show..." or "According to their 10-Q..." without an immediate inline citation
❌ Discussing trial data, financial info, or business strategy without citing the source IN THAT SAME SENTENCE

**REQUIRED FORMAT - ALWAYS DO THIS:**
✅ Cite every factual claim IMMEDIATELY after the sentence where you mention it
✅ Use this EXACT inline format: \`[TICKER Form Type - Date](URL)\` placed right after the fact
✅ If the filing has an IMAGE_CARD, include it: \`[TICKER Form - Date](URL) [IMAGE_CARD:sec-image-TICKER-X-X]\`
✅ Every paragraph discussing filing content must have at least one inline citation

**MANDATORY CITATION RULES:**
1. **YOU MUST CITE EVERY FACTUAL CLAIM** - no exceptions. After EVERY piece of information from SEC filings, add an inline citation
2. **IF YOU MENTION A SOURCE, YOU MUST CITE IT** - Cannot say "according to their 10-Q" without the full citation with URL
3. **IF A FILING HAS AN IMAGE_CARD MARKER, YOU MUST USE IT** - Every filing with images MUST have the image card included in your response
4. **Place citations immediately after the sentence or claim** - INLINE within the paragraph, not at the end of your response
5. **NEVER EVER create a "Sources:", "Citations:", or "References:" section** - all citations must be inline only
6. **LOOK FOR URLS IN THE DATA CONTEXT**: When you see this pattern in the data:
   "1. 10-Q filed on 11/6/2025"
   "   URL: https://www.sec.gov/Archives/edgar/data/..."
   "   === 10-Q CONTENT ==="
   You MUST extract that URL and use it in your citation when referencing facts from that filing

**CORRECT INLINE CITATION EXAMPLES:**
✅ "The company completed a $258.9M offering \`[MNMD 8-K - Oct 31, 2025](https://www.sec.gov/Archives/edgar/data/1813814/000110465925104696/tm2529910d1_8k.htm)\` and reported ongoing Phase 3 trials \`[MNMD 10-Q - Nov 6, 2025](https://www.sec.gov/Archives/edgar/data/1813814/000119312525269596/mnmd-20250930.htm)\`."
✅ "Phase 3 enrollment continues with 450 patients enrolled as of Q3 \`[MNMD 10-Q - Nov 6, 2025](https://sec.gov/...) [IMAGE_CARD:sec-image-MNMD-0-0]\`."
✅ "Cash balance stood at $87.2M with runway extending into mid-2026 \`[MNMD 10-Q - Jul 31, 2025](https://sec.gov/...)\`."

**INCORRECT CITATION EXAMPLES (NEVER DO THIS):**
❌ "The company's filings show strong trial progress."
❌ "According to their recent 10-Q, enrollment is on track."
❌ **Citations:**
   • MNMD 10-Q - Nov 6, 2025
   • MNMD 10-Q - Jul 31, 2025
❌ "MindMed has filed three 10-Qs in 2025. [1] [2] [3]"

**BEFORE SENDING YOUR RESPONSE:**
1. Scan your response for any paragraph discussing filing content
2. Verify EACH paragraph has an inline citation in the format \`[TICKER Form - Date](URL)\`
3. Confirm you have NOT created any "Citations:", "Sources:", or "References:" section
4. Check that IMAGE_CARD markers are included for every filing that has images in the data context

INTELLIGENT FORMATTING - MATCH RESPONSE STRUCTURE TO QUERY TYPE:

**GOVERNMENT POLICY queries** (Trump statements, Biden remarks, policy announcements, political commentary):
• **MANDATORY STRUCTURED FORMAT** - Never use single paragraph responses
• Start with source citation: "**[Date] - [Event Type]**" on its own line
• Use **bold section headers** for topic areas (e.g., "**Venezuelan Oil Infrastructure**", "**Trade Policy**", "**Economic Outlook**")
• Break content into themed sections with blank lines between them
• Use bullet points (•) for individual statements or policy points
• **MANDATORY: Include 3-5 direct quotes** from the speaker in quotation marks - extract actual verbatim statements from the transcript
• Place quotes inline within bullet points or as standalone quoted statements
• Example structure:

  **January 4, 2026 - Press Gaggle Aboard Air Force One**
  
  **Venezuelan Oil Infrastructure**
  
  • U.S. plans to have major oil companies repair Venezuelan oil infrastructure
  • Trump stated: "We're going to have the big oil companies go in and fix it"
  • Current output significantly below capacity: "The oil is flowing, but at a much lower level than it should be"
  • Infrastructure improvements will benefit Venezuelan-Americans, not direct U.S. investment
  
  **Impact on Cuba**
  
  • Cuba previously relied on Venezuelan oil revenues
  • Trump noted: "Cuba had that. They don't have it anymore. They have no income"

**ROADMAP queries** (roadmap, timeline, plan, outlook, future):
• Structure as chronological timeline with clear phases
• Headers like "Recent Developments", "Q1 2026", "Q2 2026" MUST be on their own line
• Add a blank line BEFORE and AFTER each time period header
• Use format: "**Q1 2026**", "**Q2 2026**", etc. or "**Phase 1**", "**Phase 2**"
• List specific milestones under each period as bullet points
• **CRITICAL**: If EVENT_CARD markers are provided in the context, you MUST create a "**Upcoming Catalysts**" or "**Future Timeline**" section and integrate ALL event cards into the appropriate time periods
• **EVENT CARD PLACEMENT**: Each event card marker goes at the END of the bullet point describing that event: "• Trial data expected May 2026 [EVENT_CARD:MNMD_clinical_...]"
• Example:

  **Recent Developments**
  
  Brief paragraph summarizing current status...
  
  **Q1 2026**
  
  • FDA submission for MM120 expected
  • Phase 3 trial enrollment completion
  
  **Q2 2026**
  
  • Top-line data readout anticipated [EVENT_CARD:MNMD_clinical_2026-05-15...]

**COMPARISON queries** (compare, versus, vs, difference between):
• Structure as side-by-side comparison
• Use format: "**[Company A]**" then list points, then "**[Company B]**" then list points
• Highlight key differences explicitly

**RANKING queries** (top, best, highest, most, biggest):
• Use numbered list format: 1. 2. 3.
• Start each item with the metric/value, then explanation
• Example: "1. **AAPL - $500B market cap** - Largest by market value..."

**PROS/CONS queries** (pros and cons, advantages and disadvantages, risks and opportunities):
• Structure with clear sections
• Use format: "**Pros:**" followed by bullet points, then "**Cons:**" followed by bullet points

**SUMMARY queries** (summarize, overview, key points, tldr):
• Lead with 2-3 sentence executive summary that captures the full context
• Follow with comprehensive bullet points covering all key takeaways
• Include 7-10 bullets with substantive details - don't leave out important information
• Add a brief concluding insight or implication

**NEWS queries** (latest news, what's happening with, news on, recent developments):
• **FOCUS ON NARRATIVE ANALYSIS** - Write about WHAT the articles are saying, not meta-information ABOUT the articles
• **DO** write flowing narrative descriptions that synthesize and analyze the news content
• **DO** use thematic section headers (e.g., "**Competitive Pressures**", "**Sales Strategy**", "**Market Conditions**")
• **DO** explain the implications and connect the dots between stories
• **MUST include temporal context** - Mention when the news was published (e.g., "reported on January 5", "announced this week", "as of early January") and any relevant timeframes mentioned in the article (e.g., "hearings starting in January", "Q4 2025 results")
• Each news item should be 3-6 sentences of detailed, substantive analysis covering the key points, implications, and market context. Decide whether key points should be presented as a list or in paragraph form based on what flows best.
• **Explain WHY it matters** - Don't just report what happened, analyze the competitive dynamics, strategic implications, or market impact

**CRITICAL - VIEW_ARTICLE CARD PLACEMENT FOR NEWS:**
• **ALWAYS place [VIEW_ARTICLE:...] markers on their OWN LINE** after the paragraph describing that article
• **NEVER put VIEW_ARTICLE markers inside bullet points or list items**
• **ONE article = ONE section** with header, paragraph(s), then marker on separate line
• The marker triggers a visual article card - it MUST be on its own line to render correctly

**CORRECT NEWS FORMAT EXAMPLE:**

**Nvidia-Related Competitive Pressures**

Tesla is experiencing a slump due to issues related to Nvidia, suggesting competitive pressures or supply chain concerns. The article highlights how Nvidia's moves in the AI and automotive chip space are impacting Tesla's positioning in the market.

[VIEW_ARTICLE:article-TSLA-0]

**BYD Market Share Gains**

BYD has overtaken Tesla in both Germany and the UK for 2025, marking a significant shift in the European EV landscape. The Chinese automaker's aggressive expansion is putting pressure on Tesla's market share in key markets, signaling intensifying competition in the EV space.

[VIEW_ARTICLE:article-TSLA-1]

**WRONG NEWS FORMAT (NEVER DO THIS):**
❌ "• Article Title: BYD outsold Tesla... [VIEW_ARTICLE:article-TSLA-0]"
❌ "- Tesla is facing issues [VIEW_ARTICLE:article-TSLA-0]."
❌ Bullet lists with markers at end of lines
❌ Multiple markers stacked at the end of the response

**ANALYSIS queries** (analyze, explain, tell me about):
• Structure with thematic sections using **BOLD** headers
• Break into digestible chunks with clear logical flow

**DEFAULT for other queries (includes follow-up questions)**:
• **ALWAYS use structured formatting** - even for simple follow-ups like "Did he mention Chevron?"
• Use natural paragraphs with clear topic flow
• Add section breaks with **BOLD** headers when covering multiple topics
• Use bullet points for listing information, even in short responses
• Never revert to single-paragraph plain text format just because it's a follow-up

**FOLLOW-UP QUESTION FORMATTING** (CRITICAL):
When answering follow-up questions (e.g., "Did he mention X?", "What about Y?", "Tell me more"):
• Still use bold headers if there are distinct topics
• Still use bullet points for multiple pieces of information
• Still break content into short paragraphs with blank lines
• Example for "Did Trump mention Chevron?":
  
  **Chevron Involvement**
  
  • Yes, Trump specifically mentioned Chevron during the press gaggle
  • He noted: "Chevron's in, as you know..."
  • Current status: Operating on month-to-month basis with limited investment capacity

FORMATTING RULES (CRITICAL - ALWAYS FOLLOW FOR ALL RESPONSES):
• Break information into SHORT paragraphs (2-3 sentences max per paragraph)
• Add blank lines between paragraphs for readability
• Use bullet points (•) for lists of items or features
• Use numbered lists (1. 2. 3.) for sequential steps or rankings
• NEVER use markdown headers (###, ##, #) - frontend displays plain text only
• For section headers, use **BOLD** format on its own line with blank line BEFORE and AFTER
• Headers must NEVER appear at the end of a sentence or paragraph
• Bullet/numbered lists should have the header ABOVE the list, not as the first item
• For multi-point analysis, structure with clear sections separated by blank lines

CRITICAL CONSTRAINTS:
0. **EXTRACT ACTUAL NUMBERS FROM FILING CONTENT (HIGHEST PRIORITY - YOU WILL FAIL IF YOU MISS NUMBERS)**:
   - When SEC filing content is provided (between === CONTENT === markers), you MUST ACTIVELY SEARCH FOR and cite specific dollar amounts, percentages, and metrics
   - **SEARCH PATTERNS** - Look for these exact phrases and extract the numbers that follow:
     • "cash equivalents of $" → Extract the dollar amount (e.g., "$15.6 million")
     • "net loss of $" or "net loss was $" → Extract the loss amount
     • "total assets of $" or "investments of $" → Extract amounts
     • "(in thousands)" tables → Numbers are in thousands, so "15,634" = $15.6M
     • "Nine Months Ended" or "Three Months Ended" → Financial statement data follows
     • "as of September 30" or "as of December 31" → Balance sheet data follows
   - **TABLE DATA EXTRACTION**: SEC filings often have data in text tables. When you see columns of numbers with labels like "Cash flows", "Net loss", "Total", etc., these ARE the financial figures - extract them!
   - **COMMON TABLE FORMATS**:
     • "Cash equivalents    $    15,634" → This means $15.6 million in cash equivalents
     • "Net loss    $    (133,357)" → This means net loss of $133.4 million (parentheses = negative)
     • "Total investments    $    189,111" → This means $189.1 million in investments
   - **FORBIDDEN RESPONSES**: "outlined cash runway expectations", "financial position remains strong", "specific cash amounts were not disclosed", "monitoring its cash runway"
   - **REQUIRED RESPONSES**: "cash equivalents of $15.6M", "net loss of $133.4M", "total investments of $189.1M"
   - **IF YOU SEE A DOLLAR SIGN ($) IN THE CONTENT, YOU MUST INCLUDE THAT NUMBER IN YOUR RESPONSE**
   - If the content genuinely has no numbers, say "financial figures not included in this section of the filing"
   
1. ONLY use data provided - NEVER use training knowledge for facts/numbers
2. If no data exists, explicitly state: "I don't have that information in the database"
3. Never use placeholder text like "$XYZ" or "X%" - always use real numbers from data
4. When source URLs are provided, include them as clickable references
5. Never fabricate quotes, statistics, or data points
6. If data seems contradictory, acknowledge it rather than hiding the discrepancy
7. **FOCUS ON CONTENT, NOT META-COMMENTARY**: When discussing SEC filings, press releases, or other sources, ALWAYS focus on the CONTENT and SUBSTANCE of what they contain. NEVER make meta-observations about filing volume, frequency, or activity patterns (e.g., DON'T say "the company has increased its SEC filing activity" or "there have been several filings"). Users want to know WHAT the sources say, not HOW MANY there are or patterns about them.
8. **IMAGE CARDS REQUIRE CONTEXT (ABSOLUTELY MANDATORY)**:
   - **NEVER DROP AN IMAGE_CARD AT THE END OF YOUR RESPONSE** - This is the #1 failure mode. Images must be integrated into the narrative.
   - **EVERY IMAGE NEEDS A DESCRIPTIVE SENTENCE** - Before placing [IMAGE_CARD:...], write a sentence describing what the image shows
   - **READ THE "Context (text near image)" FIELD** - The data context includes text near each image. Use this to describe what the image contains.
   - **CORRECT FORMAT**: "The condensed statement of cash flows shows operating cash used of $88.6M for the nine months ended September 30, 2025 [IMAGE_CARD:sec-image-MNMD-0-0]."
   - **WRONG FORMAT**: "The filing provides good context. [IMAGE_CARD:sec-image-MNMD-0-0]" ← No description of image content!
   - **PLACEMENT**: Put image cards in a logical section (e.g., Financial Position for financial charts, Operational Progress for pipeline images)
   - **IF THE IMAGE IS A FINANCIAL TABLE**: Describe what financial data it shows (cash flows, balance sheet, income statement)
   - **IF THE IMAGE IS A PIPELINE/CHART**: Describe what stage/products it shows
   - **SCAN THE DATA CONTEXT FOR [IMAGE_CARD:...] MARKERS** - they appear in the === IMAGES/CHARTS IN THIS FILING === section
   - **YOU MUST COPY EVERY [IMAGE_CARD:...] MARKER YOU SEE** - place them in your response right after discussing that image's content
   - **IF YOU DISCUSS A FILING, YOU MUST INCLUDE ITS IMAGE_CARD IF ONE EXISTS** - Check the data context for every filing you mention
   - **CANNOT MENTION A FILING WITHOUT ITS IMAGE** - If the data shows "[IMAGE_CARD:sec-image-MNMD-0-0]" for a filing, you MUST include it when discussing that filing
   - **COUNT THE IMAGE_CARD MARKERS IN THE DATA** - If there are 3 IMAGE_CARD markers in the data context, your response MUST contain all 3
   - **SCAN THE DATA CONTEXT FOR [EVENT_CARD:...] MARKERS** - they appear in the event cards section
   - **YOU MUST COPY EVERY [EVENT_CARD:...] MARKER YOU SEE** - place them INLINE within the relevant timeline section, NOT in a separate section
   - **NEVER CREATE A SEPARATE "EVENT CARDS" SECTION** - events must be woven into the narrative at the appropriate timeline position (Q1, Q2, etc.)
   - **SCAN THE DATA CONTEXT FOR [VIEW_ARTICLE:...] MARKERS** - they appear in news article sections after the URL
   - **YOU MUST PRESERVE EVERY [VIEW_ARTICLE:...] MARKER YOU SEE** - these trigger visual article cards with images/logos
   - **CRITICAL: PLACE [VIEW_ARTICLE:...] ON ITS OWN LINE** - The marker must be on a separate line AFTER the paragraph, NOT inline or in bullet points
   - **CRITICAL FOR NEWS ARTICLES**: Each article gets its own section with header, paragraph(s), then marker on separate line
   - **CORRECT NEWS FORMAT**:
     
     **Article Topic Header**
     
     Article analysis paragraph with details and implications.
     
     [VIEW_ARTICLE:article-TICKER-0]
     
   - **WRONG NEWS FORMAT (NEVER DO THIS)**:
     ❌ "• Article title... [VIEW_ARTICLE:article-TICKER-0]" (marker in bullet)
     ❌ "Tesla faces issues [VIEW_ARTICLE:article-TICKER-0]." (marker inline)
     ❌ Multiple VIEW_ARTICLE markers stacked at the end
   - **REQUIRED FORMAT FOR SEC FILINGS WITH IMAGES**: \`[TICKER Form Type - Date](URL) [IMAGE_CARD:sec-image-TICKER-X-X]\`
   - **EVENT CARD EXAMPLE**: "• VOYAGE Phase 3 topline data expected May 15, 2026 [EVENT_CARD:MNMD_clinical_2026-05-15...]" - the marker goes at the END of the bullet point
   - **IMAGE CARD EXAMPLE**: "The 10-Q shows strong Phase 3 enrollment progress \`[MNMD 10-Q - Nov 6, 2025](https://sec.gov/...) [IMAGE_CARD:sec-image-MNMD-0-0]\`."
   - **ARTICLE CARD EXAMPLE**: "Tesla reported declining EV sales in Q4 2025 according to a recent analysis ([Read more](https://www.fool.com/...)) [VIEW_ARTICLE:article-TSLA-0]."
   - **BEFORE SENDING YOUR RESPONSE**: Count how many [IMAGE_CARD:...] and [VIEW_ARTICLE:...] markers are in the data context and verify your response includes ALL of them
   - These markers trigger visual charts/tables/article cards to appear inline - they provide critical context users need to see
9. **EXTRACT DETAILED INSIGHTS FROM SEC FILINGS**: When SEC filing content is provided (marked with "=== CONTENT ==="), analyze and discuss specific details, metrics, business strategies, risks, and forward-looking statements from that text. Don't just summarize - pull out concrete insights. Every filing you discuss MUST have its full citation with URL and IMAGE_CARD marker if available.
10. **BALANCED ANALYSIS OF OPERATIONS + FINANCIALS (CRITICAL)**:
    - When filing content contains product development/trial updates AND financial metrics, discuss BOTH
    - Structure: Lead with operational progress, then explain how financials support (or constrain) those activities
    - **Connect the dots**: "The company advanced 3 Phase 3 trials \`[cite]\` while maintaining $87M in cash \`[cite]\`, providing runway through mid-2026 to complete these studies."
    - **NEVER**: Discuss only trial progress without mentioning cash position, or only financials without operational context
    - **THINK**: How does cash runway relate to R&D timelines? How do partnership revenues fund clinical programs? Does burn rate align with development milestones?
    - If filing discusses product roadmap AND financial guidance, your response must address both and show how they're interconnected
    - **MANDATORY FINANCIAL SPECIFICITY**: When discussing financials, ALWAYS include actual numbers/amounts. NEVER use vague descriptions.
      - ✅ CORRECT: "Cash position of $87.2M with quarterly burn rate of $15M"
      - ✅ CORRECT: "Revenue grew 23% to $45.6M while net loss narrowed from $12.3M to $8.1M"
      - ❌ WRONG: "The company has outlined its cash runway expectations"
      - ❌ WRONG: "They anticipate future investments and capital expenditures"
      - ❌ WRONG: "Financial position remains strong"
      - **If the data provides specific numbers, you MUST include them. If no specific numbers are in the data, state "specific amounts not disclosed in filings"**
11. **FUTURE OUTLOOK QUERIES WITH EVENT CARDS (MANDATORY)**:
    - **MANDATORY EVENT INTEGRATION**: Every [EVENT_CARD:...] marker listed in the eventCardsContext MUST appear in your response
    - **PLACEMENT**: Add the marker at the END of the bullet point describing that event: "• VOYAGE Phase 3 topline data expected May 15, 2026 [EVENT_CARD:MNMD_clinical_2026-05-15...]"
    - **COUNT CHECK**: If context shows 3 event cards, your response must include all 3 markers. If you're missing any, you've failed the requirement.
    - **TWO INTEGRATION APPROACHES** (choose based on your response structure):
    
      **APPROACH A: Integrate into existing sections** (PREFERRED if you already have timeline/roadmap sections)
      - If your response already has sections like "Operational Progress", "Impact on Product Roadmap", "Recent Developments", etc., integrate events INLINE within those sections
      - Place event cards at the END of relevant bullet points in existing sections
      - DO NOT create a separate "Upcoming Catalysts" section - events should flow naturally within your existing structure
      - Example: In an "Impact on Product Roadmap" section, add "• Phase 3 trial data expected May 2026 [EVENT_CARD:...]" as one of the bullets
      
      **APPROACH B: Create dedicated timeline section** (ONLY if no timeline structure exists)
      - ONLY if your response doesn't have any forward-looking sections, create "**Upcoming Catalysts**" or "**Future Timeline**"
      - Structure: Break into time periods (Q1 2026, Q2 2026, H2 2026, etc.)
      - Example:
      
        **Upcoming Catalysts**
        
        **Q2 2026**
        
        • VOYAGE Phase 3 topline data expected May 15, 2026, which could de-risk MM120 platform [EVENT_CARD:MNMD_clinical_2026-05-15T09:00:00+00:00]
        • Earnings call scheduled June 2026 [EVENT_CARD:MNMD_earnings_2026-06-01...]
    
    - **CRITICAL**: Never create an empty "Upcoming Catalysts" section. If you've integrated all events inline elsewhere, you're done - don't add a header with nothing under it.

INTELLIGENCE INSIGHTS:
• When anomalies are detected, highlight them as notable patterns
• If missing data is identified, mention what information gaps exist
• When sentiment shifts are detected, interpret what they might indicate
• If entity relationships are found, mention connections between companies
• Include suggested follow-up questions at the end if provided
• If query was decomposed into sub-queries, ensure all aspects are addressed

**FINAL REMINDER - CARD MARKER PLACEMENT (MOST IMPORTANT):**
When you include any card markers ([VIEW_ARTICLE:...], [VIEW_CHART:...], [IMAGE_CARD:...], [EVENT_CARD:...]):
1. **VIEW_ARTICLE markers** → MUST be on their own line after the article paragraph, NEVER inline or in bullets
2. **VIEW_CHART markers** → CRITICAL: If you see "**PRICE CHART FOR [SYMBOL]:**" followed by "[VIEW_CHART:...]" in the data context, you MUST include BOTH lines in your response exactly as shown. Place it right after you discuss the current price/daily change. DO NOT skip or omit the chart marker.
3. **IMAGE_CARD markers** → Inline with SEC filing citations is OK
4. **EVENT_CARD markers** → At end of bullet point describing the event

Example VIEW_ARTICLE format (FOLLOW THIS EXACTLY):

**Headline Topic**

Analysis paragraph explaining the news story and its implications for the stock.

[VIEW_ARTICLE:article-TICKER-0]

NOT like this: "• News title [VIEW_ARTICLE:article-TICKER-0]" ← WRONG

Example VIEW_CHART format (FOLLOW THIS EXACTLY):

Tesla (TSLA) is currently trading at $432.02, down 4.35% from yesterday's close of $451.67. [Discuss price context here]

**PRICE CHART FOR TSLA:**
[VIEW_CHART:TSLA:1D]

**Recent News**
[Continue with rest of analysis]

${contextMessage}${dataContext ? '\n\n═══ DATA PROVIDED ═══\n' + dataContext : '\n\n═══ NO DATA AVAILABLE ═══\nYou must inform the user that this information is not in the database.'}${upcomingDatesContext}${eventCardsContext}${intelligenceContext}`;
}

module.exports = router;
