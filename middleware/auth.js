const AuthManager = require('../services/AuthManager');
const { supabase } = require('../config/database');

// Authentication middleware - requires valid token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const decoded = AuthManager.verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  // Verify session exists and is not expired
  const { data: session } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('token', token)
    .eq('user_id', decoded.userId)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (!session) {
    return res.status(403).json({ error: 'Session expired or invalid' });
  }
  
  // Update last activity
  await supabase
    .from('user_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);
  
  req.user = { userId: decoded.userId, email: decoded.email };
  next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token) {
    const decoded = AuthManager.verifyToken(token);
    if (decoded) {
      req.user = { userId: decoded.userId, email: decoded.email };
    }
  }
  
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth
};
