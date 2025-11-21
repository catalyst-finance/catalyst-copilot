# Conversation Management Implementation Guide

## ✅ Status: FULLY IMPLEMENTED

The conversation history and feedback system (Option 3 - Hybrid Approach) is **already implemented** in `agent.js`. This guide explains how to use it.

---

## 📊 Database Schema (Run in Supabase SQL Editor)

```sql
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  title TEXT, -- Auto-generated from first message
  metadata JSONB DEFAULT '{}', -- Store user's portfolio, preferences
  CONSTRAINT conversations_user_id_check CHECK (char_length(user_id) > 0)
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  data_cards JSONB, -- Store the stock/event cards shown
  feedback TEXT CHECK (feedback IN ('like', 'dislike', NULL)),
  feedback_reason TEXT, -- Optional: why they disliked it
  created_at TIMESTAMPTZ DEFAULT NOW(),
  token_count INTEGER, -- Track token usage
  metadata JSONB DEFAULT '{}', -- Store query_intent, data sources used, etc.
  CONSTRAINT messages_content_check CHECK (char_length(content) > 0)
);

-- Indexes for performance
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_feedback ON messages(feedback) WHERE feedback IS NOT NULL;
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update conversations.updated_at when messages are added
CREATE TRIGGER update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update conversations.updated_at when a new message is inserted
CREATE OR REPLACE FUNCTION update_conversation_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations 
  SET updated_at = NOW() 
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_on_message
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_on_new_message();

-- View for conversation summaries (useful for listing conversations)
CREATE VIEW conversation_summaries AS
SELECT 
  c.id,
  c.user_id,
  c.title,
  c.created_at,
  c.updated_at,
  c.metadata,
  COUNT(m.id) AS message_count,
  MAX(m.created_at) AS last_message_at
FROM conversations c
LEFT JOIN messages m ON c.id = m.conversation_id
GROUP BY c.id, c.user_id, c.title, c.created_at, c.updated_at, c.metadata;

-- Function to generate conversation title from first message
CREATE OR REPLACE FUNCTION generate_conversation_title(conversation_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  first_message TEXT;
  title TEXT;
BEGIN
  SELECT content INTO first_message
  FROM messages
  WHERE conversation_id = conversation_uuid AND role = 'user'
  ORDER BY created_at ASC
  LIMIT 1;
  
  IF first_message IS NULL THEN
    RETURN 'New Conversation';
  END IF;
  
  -- Truncate to 50 characters and add ellipsis if needed
  title := SUBSTRING(first_message FROM 1 FOR 50);
  IF LENGTH(first_message) > 50 THEN
    title := title || '...';
  END IF;
  
  RETURN title;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE conversations IS 'Stores user conversation threads with metadata';
COMMENT ON TABLE messages IS 'Stores individual messages within conversations with feedback tracking';
COMMENT ON COLUMN messages.data_cards IS 'JSON array of stock/event cards displayed with this message';
COMMENT ON COLUMN messages.metadata IS 'Stores query_intent, data_sources_used, tickers_mentioned, etc.';
COMMENT ON COLUMN conversations.metadata IS 'Stores user portfolio, preferences, session info';
```

---

## 🔌 API Endpoints

### 1. **Create New Conversation**
```http
POST /conversations
Content-Type: application/json

{
  "userId": "user_123",
  "metadata": {
    "selectedTickers": ["TSLA", "AAPL", "NVDA"]
  }
}
```

**Response:**
```json
{
  "conversation": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "user_123",
    "created_at": "2025-11-21T10:30:00Z",
    "updated_at": "2025-11-21T10:30:00Z",
    "title": null,
    "metadata": {
      "selectedTickers": ["TSLA", "AAPL", "NVDA"]
    }
  }
}
```

---

### 2. **Send Chat Message (with conversation tracking)**
```http
POST /chat
Content-Type: application/json

{
  "message": "How did Tesla trade today?",
  "userId": "user_123",
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "selectedTickers": ["TSLA", "AAPL"]
}
```

**Response:**
```json
{
  "response": "Tesla (TSLA) closed at $395.08, down $8.91 (-2.21%)...",
  "dataCards": [...],
  "eventData": {...},
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "newConversation": null,
  "timestamp": "2025-11-21T10:35:00Z"
}
```

**Note:** If `conversationId` is omitted, a new conversation will be created automatically.

---

### 3. **Get User's Conversations**
```http
GET /conversations/user_123?limit=20&offset=0
```

**Response:**
```json
{
  "conversations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "user_123",
      "title": "How did Tesla trade today?",
      "created_at": "2025-11-21T10:30:00Z",
      "updated_at": "2025-11-21T10:35:00Z",
      "metadata": {
        "selectedTickers": ["TSLA", "AAPL"]
      },
      "message_count": 6,
      "last_message_at": "2025-11-21T10:35:00Z"
    }
  ]
}
```

---

### 4. **Load Conversation Messages**
```http
GET /conversations/550e8400-e29b-41d4-a716-446655440000/messages?limit=50
```

**Response:**
```json
{
  "messages": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "How did Tesla trade today?",
      "data_cards": null,
      "feedback": null,
      "feedback_reason": null,
      "created_at": "2025-11-21T10:30:00Z",
      "token_count": 15,
      "metadata": {
        "query_intent": {...},
        "tickers_queried": ["TSLA"],
        "data_sources": ["stock_prices"]
      }
    },
    {
      "id": "223e4567-e89b-12d3-a456-426614174001",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "role": "assistant",
      "content": "Tesla (TSLA) closed at $395.08...",
      "data_cards": [{...}],
      "feedback": "like",
      "feedback_reason": null,
      "created_at": "2025-11-21T10:30:05Z",
      "token_count": 1250,
      "metadata": {
        "model": "gpt-4o-mini",
        "finish_reason": "stop"
      }
    }
  ]
}
```

---

### 5. **Submit Feedback (Like/Dislike)**
```http
POST /messages/223e4567-e89b-12d3-a456-426614174001/feedback
Content-Type: application/json

{
  "feedback": "dislike",
  "reason": "Response was too generic, didn't mention institutional ownership"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## 🎯 Frontend Integration Examples

### **React/TypeScript Example**

```typescript
interface ChatState {
  conversationId: string | null;
  userId: string;
  selectedTickers: string[];
}

// Start new conversation or continue existing
const sendMessage = async (message: string, chatState: ChatState) => {
  const response = await fetch('https://your-api.com/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      userId: chatState.userId,
      conversationId: chatState.conversationId, // null for new conversation
      selectedTickers: chatState.selectedTickers
    })
  });
  
  const data = await response.json();
  
  // Update conversation ID if this was a new conversation
  if (data.newConversation) {
    chatState.conversationId = data.conversationId;
  }
  
  return data;
};

// Load conversation history
const loadConversation = async (conversationId: string) => {
  const response = await fetch(`https://your-api.com/conversations/${conversationId}/messages`);
  const data = await response.json();
  return data.messages;
};

// Submit feedback
const submitFeedback = async (messageId: string, feedback: 'like' | 'dislike', reason?: string) => {
  await fetch(`https://your-api.com/messages/${messageId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback, reason })
  });
};

// List user's conversations
const loadUserConversations = async (userId: string) => {
  const response = await fetch(`https://your-api.com/conversations/${userId}`);
  const data = await response.json();
  return data.conversations;
};
```

---

## 📈 Analytics & Improvement Workflow

### **1. Query Messages with Feedback**
```sql
-- Get all disliked messages
SELECT 
  m.id,
  m.content AS user_message,
  m.created_at,
  m.metadata->>'query_intent' AS intent,
  next_m.content AS assistant_response,
  next_m.feedback_reason
FROM messages m
JOIN messages next_m ON next_m.conversation_id = m.conversation_id 
  AND next_m.created_at > m.created_at
  AND next_m.role = 'assistant'
WHERE next_m.feedback = 'dislike'
  AND m.role = 'user'
ORDER BY m.created_at DESC;
```

### **2. Track Satisfaction Rate by Query Type**
```sql
SELECT 
  m.metadata->>'query_intent' AS query_type,
  COUNT(*) AS total_responses,
  SUM(CASE WHEN m.feedback = 'like' THEN 1 ELSE 0 END) AS likes,
  SUM(CASE WHEN m.feedback = 'dislike' THEN 1 ELSE 0 END) AS dislikes,
  ROUND(
    SUM(CASE WHEN m.feedback = 'like' THEN 1 ELSE 0 END)::NUMERIC / 
    NULLIF(SUM(CASE WHEN m.feedback IS NOT NULL THEN 1 ELSE 0 END), 0) * 100, 
    2
  ) AS satisfaction_rate
FROM messages m
WHERE m.role = 'assistant'
  AND m.created_at > NOW() - INTERVAL '30 days'
GROUP BY query_type
ORDER BY total_responses DESC;
```

### **3. Export Fine-Tuning Dataset**
```sql
SELECT 
  user_msg.content AS prompt,
  asst_msg.content AS completion,
  asst_msg.feedback,
  user_msg.metadata->>'query_intent' AS intent,
  asst_msg.data_cards
FROM messages user_msg
JOIN messages asst_msg ON asst_msg.conversation_id = user_msg.conversation_id
  AND asst_msg.created_at > user_msg.created_at
  AND asst_msg.role = 'assistant'
WHERE user_msg.role = 'user'
  AND asst_msg.feedback IS NOT NULL
ORDER BY asst_msg.created_at DESC;
```

---

## 🔍 Key Features Implemented

✅ **Automatic Conversation Creation** - Creates new conversation if `conversationId` is null  
✅ **Smart Context Loading** - Loads last 30 messages, prunes to fit 4000 token budget  
✅ **Auto-Generated Titles** - Extracts first 50 chars of user's first message  
✅ **Feedback System** - Like/dislike with optional reason  
✅ **Token Tracking** - Monitors token usage per message  
✅ **Metadata Storage** - Captures query intent, tickers, data sources  
✅ **Data Cards** - Saves stock/event cards shown with each response  
✅ **Cascade Deletion** - Deleting conversation removes all messages  
✅ **Performance Indexes** - Optimized queries for user_id, conversation_id  
✅ **Auto-Timestamps** - Updates conversation.updated_at on new messages  

---

## 🚀 Next Steps

1. **Run the SQL schema** in Supabase SQL Editor
2. **Test the endpoints** using the examples above
3. **Integrate into frontend** using the React example
4. **Monitor feedback** using the analytics queries
5. **Iterate on prompts** based on disliked responses

---

## 📝 Notes

- **Token Budget**: Conversation history is pruned to 4000 tokens (roughly 16,000 characters)
- **Message Limit**: Loads last 30 messages per conversation
- **Title Generation**: First 50 characters of initial user message
- **Cascading Deletes**: Deleting a conversation automatically deletes all its messages
- **Failure Handling**: If saving fails, the chat response still succeeds (logged error only)
- **Portfolio Tracking**: `metadata` field in conversations stores user's selected tickers

---

## 🎓 Benefits of This Approach

1. **Full Control** - Your data stays in Supabase, no vendor lock-in
2. **Cost-Effective** - Don't pay OpenAI for storing conversations
3. **Analytics Ready** - Easy SQL queries for insights
4. **Feedback Loop** - Track likes/dislikes to improve AI
5. **User Experience** - Users can resume conversations across sessions
6. **Debugging** - See exactly what data was available for each response
7. **Compliance** - Retain conversation history for audit/compliance needs
