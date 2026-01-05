// Updated Supabase Edge Function with FREE MongoDB proxy integration
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// DigitalOcean Function URL for MongoDB (FREE tier)
const MONGODB_FUNCTION_URL = Deno.env.get('MONGODB_FUNCTION_URL') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// MongoDB proxy calls
async function getInstitutionalData(symbol: string) {
  try {
    const response = await fetch(MONGODB_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'institutional', symbol })
    })
    const data = await response.json()
    return data.body || data
  } catch (error) {
    console.error('MongoDB institutional fetch error:', error)
    return { success: false, error: error.message, data: [] }
  }
}

async function getMacroData(category: string = 'economic') {
  try {
    const response = await fetch(MONGODB_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'macro', category })
    })
    const data = await response.json()
    return data.body || data
  } catch (error) {
    console.error('MongoDB macro fetch error:', error)
    return { success: false, error: error.message, data: [] }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { message, conversationHistory = [], selectedTickers = [] } = await req.json()

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Build portfolio context
    const contextMessage = selectedTickers.length > 0
      ? `The user is currently tracking these stocks: ${selectedTickers.join(', ')}.`
      : 'The user has not specified any stocks they are tracking.'

    // Prepare messages for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Catalyst Copilot, an advanced AI assistant for a financial investment app. You help users understand stocks, market events, and make informed investment decisions.

You have access to multiple data sources through function calls:

SUPABASE DATA (Stock & Events):
- Current stock prices and quotes
- Intraday trading data
- Historical daily prices  
- Market events (earnings, FDA approvals, mergers, conferences, etc.)
- Company information

MONGODB DATA (Institutional & Macro):
- Institutional ownership data (who owns stocks, position changes)
- Macro economic indicators (GDP, inflation, unemployment)
- Government policy transcripts (Fed announcements, White House briefings)
- Market news and sentiment analysis

CAPABILITIES:
- Answer questions about any publicly traded stock
- Provide institutional ownership analysis
- Explain market events and their potential impact
- Discuss macro economic trends and policy implications
- Analyze trading patterns and price movements

GUIDELINES:
1. Always use function calls to get real data - never make up numbers
2. Be concise but comprehensive in your analysis
3. Reference specific data points with exact numbers and dates
4. Explain complex financial concepts in accessible terms
5. When discussing events, mention both the event details and AI insights about impact
6. For institutional data, highlight ownership percentages and recent changes
7. Connect macro trends to their potential market implications

${contextMessage}`
      },
      ...conversationHistory,
      { role: "user", content: message }
    ]

    // Define function tools for OpenAI
    const tools = [
      {
        type: "function",
        function: {
          name: "get_stock_data",
          description: "Get stock price data from Supabase",
          parameters: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Stock ticker symbol (e.g., AAPL, TSLA)" },
              dataType: { 
                type: "string", 
                enum: ["current", "intraday", "daily"],
                description: "Type of data to fetch"
              }
            },
            required: ["symbol"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_events",
          description: "Get market events and earnings from Supabase",
          parameters: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "Stock ticker to filter events for" },
              type: { type: "array", items: { type: "string" }, description: "Event types to filter" },
              upcoming: { type: "boolean", description: "Whether to get upcoming events" },
              limit: { type: "number", description: "Number of events to return" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_institutional_data",
          description: "Get institutional ownership data from MongoDB",
          parameters: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Stock ticker symbol" }
            },
            required: ["symbol"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_macro_data",
          description: "Get macro economic data, policy info, or market news from MongoDB",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["economic", "policy", "news"],
                description: "Type of macro data to fetch"
              }
            }
          }
        }
      }
    ]

    // Call OpenAI with function calling
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 1500
      })
    })

    const completion = await openaiResponse.json()
    let assistantMessage = completion.choices[0].message
    const toolCalls = assistantMessage.tool_calls || []

    // Execute function calls
    if (toolCalls.length > 0) {
      const toolResults = []

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments)
        let result

        switch (call.function.name) {
          case 'get_stock_data': {
            const { symbol, dataType = 'current' } = args
            let query

            if (dataType === 'current') {
              query = supabase
                .from('finnhub_quote_snapshots')
                .select('*')
                .eq('symbol', symbol)
                .order('timestamp', { ascending: false })
                .limit(1)
            } else if (dataType === 'intraday') {
              const today = new Date().toISOString().split('T')[0]
              query = supabase
                .from('intraday_prices')
                .select('*')
                .eq('symbol', symbol)
                .gte('timestamp_et', `${today}T00:00:00`)
                .lte('timestamp_et', `${today}T23:59:59`)
                .order('timestamp_et', { ascending: true })
                .limit(500)
            } else {
              query = supabase
                .from('daily_prices')
                .select('*')
                .eq('symbol', symbol)
                .order('date', { ascending: false })
                .limit(30)
            }

            const { data, error } = await query
            result = { success: !error, data: data || [], source: 'supabase', type: dataType }
            break
          }

          case 'get_events': {
            let query = supabase
              .from('event_data')
              .select('*')
              .not('title', 'is', null)
              .not('aiInsight', 'is', null)

            if (args.ticker) query = query.eq('ticker', args.ticker)
            if (args.type) query = Array.isArray(args.type) ? query.in('type', args.type) : query.eq('type', args.type)
            if (args.upcoming) {
              query = query.gte('actualDateTime_et', new Date().toISOString()).order('actualDateTime_et', { ascending: true })
            } else {
              query = query.order('actualDateTime_et', { ascending: false })
            }
            query = query.limit(args.limit || 20)

            const { data, error } = await query
            result = { success: !error, data: data || [], source: 'supabase', type: 'events' }
            break
          }

          case 'get_institutional_data':
            result = await getInstitutionalData(args.symbol)
            break

          case 'get_macro_data':
            result = await getMacroData(args.category)
            break

          default:
            result = { success: false, error: `Unknown function: ${call.function.name}` }
        }

        toolResults.push({
          tool_call_id: call.id,
          role: "tool",
          content: JSON.stringify(result)
        })
      }

      // Get final response with tool results
      const finalResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            ...messages,
            assistantMessage,
            ...toolResults
          ],
          temperature: 0.7,
          max_tokens: 1500
        })
      })

      const finalCompletion = await finalResponse.json()
      assistantMessage = finalCompletion.choices[0].message
    }

    return new Response(
      JSON.stringify({
        response: assistantMessage.content,
        functionCalls: toolCalls.length,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Chat error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
