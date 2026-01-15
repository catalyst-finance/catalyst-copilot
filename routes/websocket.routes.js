/**
 * WebSocket Routes
 * Real-time chat endpoint with streaming support via WebSocket
 */

const { supabase } = require('../config/database');
const openai = require('../config/openai');
const DataConnector = require('../services/DataConnector');
const ConversationManager = require('../services/ConversationManager');
const QueryEngine = require('../services/QueryEngine');
const ContextEngine = require('../services/ContextEngine');
const { buildSystemPrompt } = require('../config/prompts/system-prompt');
const { allocateTokenBudget, getTokenBudget } = require('../config/token-allocation');
const { StreamProcessor } = require('../services/StreamProcessor');

/**
 * Handle WebSocket chat connection
 */
async function handleChatWebSocket(ws, req) {
  console.log('🔌 WebSocket client connected');
  
  let userId = null;
  let isProcessing = false;

  // Helper to send JSON messages
  const send = (data) => {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(data));
    }
  };

  // Helper to send thinking updates
  const sendThinking = (phase, content) => {
    send({ type: 'thinking', phase, content });
    console.log(`💭 Thinking: ${content}`);
  };

  // Handle incoming messages
  ws.on('message', async (data) => {
    if (isProcessing) {
      send({ type: 'error', error: 'Already processing a message' });
      return;
    }

    try {
      const payload = JSON.parse(data.toString());
      const { 
        type,
        message, 
        conversationId = null, 
        conversationHistory = [],
        selectedTickers = [],
        timezone = 'America/New_York',
        userId: requestUserId = null
      } = payload;

      if (type !== 'chat') {
        send({ type: 'error', error: 'Unknown message type' });
        return;
      }

      if (!message) {
        send({ type: 'error', error: 'Message is required' });
        return;
      }

      userId = requestUserId;
      isProcessing = true;

      console.log('Processing message:', message);
      console.log('User ID:', userId);
      console.log('Conversation ID:', conversationId);
      console.log('User Timezone:', timezone);

      // Verify conversation ownership if conversationId provided
      if (conversationId && userId) {
        const { data: conversation } = await supabase
          .from('conversations')
          .select('user_id')
          .eq('id', conversationId)
          .single();
        
        if (!conversation || conversation.user_id !== userId) {
          send({ type: 'error', error: 'Access denied to this conversation' });
          isProcessing = false;
          return;
        }
      }

      // Load conversation history from database if conversationId provided
      let loadedHistory = conversationHistory;
      if (conversationId) {
        loadedHistory = await ConversationManager.loadConversationContext(conversationId, 4000);
        console.log(`Loaded ${loadedHistory.length} messages from conversation ${conversationId}`);
      }

      // AI-NATIVE QUERY ENGINE
      console.log('🤖 Using AI-Native Query Engine...');
      
      let queryIntent;
      let queryResults = [];
      
      try {
        const queryPlan = await QueryEngine.generateQueries(
          message, 
          selectedTickers,
          sendThinking,
          timezone
        );
        console.log('📋 Query Plan:', JSON.stringify(queryPlan, null, 2));
        
        const tokenAllocation = await allocateTokenBudget(queryPlan, message);
        queryResults = await QueryEngine.executeQueries(queryPlan, DataConnector);
        console.log(`✅ Retrieved data from ${queryResults.length} source(s)`);
        
        queryIntent = {
          intent: queryPlan.intent,
          extractCompaniesFromTranscripts: queryPlan.extractCompanies,
          needsChart: queryPlan.needsChart,
          needsDeepAnalysis: queryPlan.needsDeepAnalysis || false,
          analysisKeywords: queryPlan.analysisKeywords || [],
          tickers: queryPlan.tickers || [],
          queries: queryPlan.queries,
          chartConfig: queryPlan.chartConfig || null,
          tokenAllocation: tokenAllocation
        };
        
      } catch (error) {
        console.error('❌ AI Query Engine failed:', error);
        queryIntent = { intent: 'general', tickers: [] };
        queryResults = [];
      }

      // BUILD DATA CONTEXT FROM RESULTS
      let dataContext = "";
      const dataCards = [];
      const eventData = {};
      let responseStyleGuidelines = null;
      
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
      
      if (queryResults.length > 0) {
        console.log('📝 Building data context from AI query results...');
        
        try {
          const formattingPlan = await ContextEngine.generateFormattingPlan(
            queryResults,
            message,
            queryIntent,
            sendThinking
          );
          
          const formatted = await ContextEngine.executeFormattingPlan(
            formattingPlan,
            queryResults,
            DataConnector,
            sendThinking,
            queryIntent,
            message
          );
          
          dataContext = formatted.dataContext;
          dataCards.push(...formatted.dataCards);
          intelligenceMetadata = { ...intelligenceMetadata, ...formatted.intelligenceMetadata };
          
          if (queryIntent.chartConfig) {
            dataContext = await ContextEngine.addChartMarkers(dataContext, queryIntent, dataCards, DataConnector);
            console.log(`📈 Added chart marker for ${queryIntent.chartConfig.symbol}`);
          }
          
          if (formattingPlan.responseStyle) {
            responseStyleGuidelines = formattingPlan.responseStyle;
            console.log('📐 Response Style:', responseStyleGuidelines.format, '-', responseStyleGuidelines.tone);
          }
          
          console.log(`✅ AI formatting complete - ${intelligenceMetadata.totalSources} sources`);
        } catch (error) {
          console.error('❌ AI formatting failed:', error);
        }
      }

      // Build system prompt
      const systemPrompt = buildSystemPrompt('', dataContext, '', '', '', responseStyleGuidelines);

      // Build messages array
      const messages = [
        { role: "system", content: systemPrompt },
        ...loadedHistory || [],
        { role: "user", content: message }
      ];

      console.log("Calling OpenAI API with", messages.length, "messages");

      // Create conversation if needed
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

      // Send metadata
      send({
        type: 'metadata',
        dataCards,
        eventData,
        conversationId: finalConversationId,
        newConversation: newConversation,
        timestamp: new Date().toISOString()
      });

      // Call OpenAI with streaming
      const allocation = queryIntent.tokenAllocation || { responseTokens: 8000, planTokens: 1500, queryTokens: 1500, tier: 'standard' };
      const tokenBudget = getTokenBudget(allocation, 'response');
      
      console.log(`💰 Response Budget: ${allocation.tier.toUpperCase()} tier (${tokenBudget} tokens)`);
      
      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.3,
        max_completion_tokens: tokenBudget,
        stream: true
      });

      // Create WebSocket adapter for StreamProcessor
      const wsAdapter = {
        write: (data) => {
          // StreamProcessor emits SSE format: "data: {...}\n\n"
          // Extract JSON and send via WebSocket
          const match = data.match(/^data: (.+)\n\n$/);
          if (match) {
            try {
              const event = JSON.parse(match[1]);
              send(event);
            } catch (e) {
              console.error('Failed to parse StreamProcessor event:', e);
            }
          }
        }
      };

      // Use StreamProcessor to handle markers, Related Coverage, etc.
      const processor = new StreamProcessor(wsAdapter, dataCards);
      let finishReason = null;
      let model = null;

      // Stream OpenAI response through StreamProcessor
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          processor.addChunk(content);
        }
        
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
        
        if (chunk.model) {
          model = chunk.model;
        }
      }

      // Finalize processing - flush buffer and inject missing markers
      processor.finalize();
      const fullResponse = processor.getFullResponse();

      // Log complete response for debugging
      console.log('\n📄 FULL RESPONSE:');
      console.log('='.repeat(80));
      console.log(fullResponse);
      console.log('='.repeat(80));
      console.log(`Response length: ${fullResponse.length} characters\n`);

      // Send done message
      send({ 
        type: 'done',
        conversationId: userId ? finalConversationId : undefined,
        data_cards: dataCards.length > 0 ? dataCards : []
      });

      // Save messages to database
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
                model: model || 'gpt-4o',
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

      isProcessing = false;

    } catch (error) {
      console.error('WebSocket chat error:', error);
      send({ 
        type: 'error', 
        error: 'An error occurred while processing your request',
        details: error.message 
      });
      isProcessing = false;
    }
  });

  // Handle connection close
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send welcome message
  send({ type: 'connected', message: 'Connected to Catalyst Copilot' });
}

module.exports = { handleChatWebSocket };
