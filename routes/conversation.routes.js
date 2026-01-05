/**
 * Conversation Routes
 * CRUD operations for conversations and messages
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Create new conversation
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { metadata = {} } = req.body;
    
    const { data, error } = await supabase
      .from('conversations')
      .insert([{
        user_id: req.user.userId,
        metadata: metadata
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ conversation: data });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get user's conversations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const { data, error } = await supabase
      .from('conversation_summaries')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    
    res.json({ conversations: data || [] });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for a conversation
router.get('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    
    // Verify user owns this conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', id)
      .single();
    
    if (!conversation || conversation.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (error) throw error;
    
    res.json({ messages: data || [] });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Submit feedback for a message
router.post('/messages/:id/feedback', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, reason } = req.body;
    
    if (!feedback || !['like', 'dislike'].includes(feedback)) {
      return res.status(400).json({ error: 'Valid feedback (like/dislike) is required' });
    }
    
    // Verify user owns the conversation this message belongs to
    const { data: message } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', id)
      .single();
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', message.conversation_id)
      .single();
    
    if (!conversation || conversation.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { error } = await supabase
      .from('messages')
      .update({ 
        feedback, 
        feedback_reason: reason || null 
      })
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

module.exports = router;
