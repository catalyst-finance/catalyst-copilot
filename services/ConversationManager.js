const { supabase } = require('../config/database');

class ConversationManager {
  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  static estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  
  // Load conversation history with smart pruning to fit token budget
  static async loadConversationContext(conversationId, maxTokens = 4000) {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(30); // Last 30 messages
      
      if (error) throw error;
      if (!messages || messages.length === 0) return [];
      
      // Reverse to chronological order
      messages.reverse();
      
      // Prune to fit token budget (keep most recent)
      let totalTokens = 0;
      const prunedMessages = [];
      
      for (let i = messages.length - 1; i >= 0; i--) {
        const msgTokens = this.estimateTokens(messages[i].content);
        if (totalTokens + msgTokens > maxTokens) break;
        prunedMessages.unshift(messages[i]);
        totalTokens += msgTokens;
      }
      
      return prunedMessages;
    } catch (error) {
      console.error('Error loading conversation context:', error);
      return [];
    }
  }
  
  // Generate conversation title from first user message
  static generateTitle(firstMessage) {
    const title = firstMessage.substring(0, 50);
    return firstMessage.length > 50 ? title + '...' : title;
  }
}

module.exports = ConversationManager;
