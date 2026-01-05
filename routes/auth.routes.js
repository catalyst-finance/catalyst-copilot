/**
 * Authentication Routes
 * Handles user registration, login, logout, email verification, and password reset
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const AuthManager = require('../services/AuthManager');
const { authenticateToken } = require('../middleware/auth');

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const passwordHash = await AuthManager.hashPassword(password);
    
    // Create user
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email: email.toLowerCase(),
        password_hash: passwordHash,
        full_name: fullName || null
      }])
      .select()
      .single();
    
    if (userError) throw userError;
    
    // Generate email verification token
    const verificationToken = AuthManager.generateRandomToken();
    await supabase
      .from('email_verification_tokens')
      .insert([{
        user_id: user.id,
        token: verificationToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }]);
    
    // Generate JWT and session
    const jwtToken = AuthManager.generateToken(user.id, user.email);
    const refreshToken = AuthManager.generateRefreshToken();
    
    await supabase
      .from('user_sessions')
      .insert([{
        user_id: user.id,
        token: jwtToken,
        refresh_token: refreshToken,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      }]);
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        emailVerified: user.email_verified
      },
      token: jwtToken,
      refreshToken,
      verificationToken // In production, send this via email instead
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();
    
    if (userError || !user) {
      // Record failed login attempt
      await supabase.rpc('record_failed_login', { 
        p_email: email.toLowerCase(), 
        p_ip_address: req.ip 
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked due to failed login attempts',
        lockedUntil: user.locked_until
      });
    }
    
    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }
    
    // Verify password
    const isValidPassword = await AuthManager.verifyPassword(password, user.password_hash);
    
    if (!isValidPassword) {
      // Record failed login attempt
      await supabase.rpc('record_failed_login', { 
        p_email: email.toLowerCase(), 
        p_ip_address: req.ip 
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Record successful login
    await supabase.rpc('record_user_login', {
      p_user_id: user.id,
      p_ip_address: req.ip,
      p_user_agent: req.headers['user-agent']
    });
    
    // Generate JWT and session
    const jwtToken = AuthManager.generateToken(user.id, user.email);
    const refreshToken = AuthManager.generateRefreshToken();
    
    await supabase
      .from('user_sessions')
      .insert([{
        user_id: user.id,
        token: jwtToken,
        refresh_token: refreshToken,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }]);
    
    // Get user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified,
        isPremium: user.is_premium,
        profile: profile || {}
      },
      token: jwtToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Delete session
    await supabase
      .from('user_sessions')
      .delete()
      .eq('token', token);
    
    // Create audit log
    await supabase
      .from('audit_logs')
      .insert([{
        user_id: req.user.userId,
        action: 'logout',
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    
    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (tokenError || !tokenData) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    
    // Update user
    await supabase
      .from('users')
      .update({ 
        email_verified: true,
        email_verified_at: new Date().toISOString()
      })
      .eq('id', tokenData.user_id);
    
    // Delete used token
    await supabase
      .from('email_verification_tokens')
      .delete()
      .eq('id', tokenData.id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Get user (don't reveal if user exists)
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    
    if (user) {
      // Generate reset token
      const resetToken = AuthManager.generateRandomToken();
      
      await supabase
        .from('password_reset_tokens')
        .insert([{
          user_id: user.id,
          token: resetToken,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
        }]);
      
      // In production, send this via email
      console.log('Password reset token:', resetToken);
    }
    
    // Always return success (don't reveal if user exists)
    res.json({ 
      success: true,
      message: 'If the email exists, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .is('used_at', null)
      .single();
    
    if (tokenError || !tokenData) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    // Hash new password
    const passwordHash = await AuthManager.hashPassword(newPassword);
    
    // Update user password
    await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', tokenData.user_id);
    
    // Mark token as used
    await supabase
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenData.id);
    
    // Invalidate all user sessions
    await supabase
      .from('user_sessions')
      .delete()
      .eq('user_id', tokenData.user_id);
    
    // Create audit log
    await supabase
      .from('audit_logs')
      .insert([{
        user_id: tokenData.user_id,
        action: 'password_reset',
        ip_address: req.ip
      }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error: userError } = await supabase
      .from('user_details')
      .select('*')
      .eq('id', req.user.userId)
      .single();
    
    if (userError) throw userError;
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Update user profile
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, avatarUrl, notificationPreferences, riskTolerance, investmentGoals, preferredSectors } = req.body;
    
    // Update users table if fullName or avatarUrl provided
    if (fullName !== undefined || avatarUrl !== undefined) {
      const updates = {};
      if (fullName !== undefined) updates.full_name = fullName;
      if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
      
      await supabase
        .from('users')
        .update(updates)
        .eq('id', req.user.userId);
    }
    
    // Update user_profiles table
    const profileUpdates = {};
    if (notificationPreferences !== undefined) profileUpdates.notification_preferences = notificationPreferences;
    if (riskTolerance !== undefined) profileUpdates.risk_tolerance = riskTolerance;
    if (investmentGoals !== undefined) profileUpdates.investment_goals = investmentGoals;
    if (preferredSectors !== undefined) profileUpdates.preferred_sectors = preferredSectors;
    
    if (Object.keys(profileUpdates).length > 0) {
      await supabase
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', req.user.userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
