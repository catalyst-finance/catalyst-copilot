/**
 * Watchlist Routes
 * CRUD operations for user watchlists
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get user's watchlists
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_watchlists')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ watchlists: data || [] });
  } catch (error) {
    console.error('Get watchlists error:', error);
    res.status(500).json({ error: 'Failed to get watchlists' });
  }
});

// Create watchlist
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, tickers, isDefault } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Watchlist name is required' });
    }
    
    const { data, error } = await supabase
      .from('user_watchlists')
      .insert([{
        user_id: req.user.userId,
        name,
        description: description || null,
        tickers: tickers || [],
        is_default: isDefault || false
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ watchlist: data });
  } catch (error) {
    console.error('Create watchlist error:', error);
    res.status(500).json({ error: 'Failed to create watchlist' });
  }
});

// Update watchlist
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, tickers, isDefault } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (tickers !== undefined) updates.tickers = tickers;
    if (isDefault !== undefined) updates.is_default = isDefault;
    
    const { data, error } = await supabase
      .from('user_watchlists')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ watchlist: data });
  } catch (error) {
    console.error('Update watchlist error:', error);
    res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

// Delete watchlist
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('user_watchlists')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete watchlist error:', error);
    res.status(500).json({ error: 'Failed to delete watchlist' });
  }
});

module.exports = router;
