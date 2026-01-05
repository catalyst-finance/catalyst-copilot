-- ============================================
-- CATALYST COPILOT - USER AUTHENTICATION & PROFILE SYSTEM
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS TABLE (Core Authentication)
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt hash
  full_name TEXT,
  avatar_url TEXT,
  
  -- Account status
  email_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  is_premium BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  
  -- Security
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  
  CONSTRAINT users_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT users_email_length CHECK (char_length(email) >= 5 AND char_length(email) <= 255)
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at DESC);
CREATE INDEX idx_users_is_active ON users(is_active) WHERE is_active = TRUE;

-- ============================================
-- EMAIL VERIFICATION TOKENS
-- ============================================
CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT token_length CHECK (char_length(token) = 64)
);

CREATE INDEX idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);

-- ============================================
-- PASSWORD RESET TOKENS
-- ============================================
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  
  CONSTRAINT token_length CHECK (char_length(token) = 64)
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- ============================================
-- USER SESSIONS (for JWT/session management)
-- ============================================
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL, -- JWT or session token
  refresh_token TEXT UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT session_token_length CHECK (char_length(token) >= 32)
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- ============================================
-- USER PROFILES (Extended user information)
-- ============================================
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Portfolio settings
  default_watchlist JSONB DEFAULT '[]', -- Array of ticker symbols
  notification_preferences JSONB DEFAULT '{}',
  
  -- Trading preferences
  risk_tolerance TEXT CHECK (risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
  investment_goals TEXT[],
  preferred_sectors TEXT[],
  
  -- Onboarding
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,
  
  -- Usage tracking
  total_queries INTEGER DEFAULT 0,
  total_conversations INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_onboarding ON user_profiles(onboarding_completed);

-- ============================================
-- USER WATCHLISTS (Multiple watchlists per user)
-- ============================================
CREATE TABLE user_watchlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  tickers JSONB DEFAULT '[]', -- Array of {symbol, addedAt}
  is_default BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT watchlist_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100)
);

CREATE INDEX idx_user_watchlists_user_id ON user_watchlists(user_id);
CREATE INDEX idx_user_watchlists_is_default ON user_watchlists(is_default) WHERE is_default = TRUE;

-- ============================================
-- AUDIT LOG (Track important user actions)
-- ============================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'login', 'logout', 'password_change', 'email_change', etc.
  resource_type TEXT, -- 'user', 'conversation', 'watchlist', etc.
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================
-- UPDATE EXISTING TABLES TO REFERENCE USERS
-- ============================================

-- Drop conversation_summaries view if it exists (will be recreated later)
DROP VIEW IF EXISTS conversation_summaries CASCADE;

-- Update conversations table to reference users table
-- First, check if user_id is already UUID type
DO $$ 
BEGIN
  -- Only alter if the column is not already UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' 
    AND column_name = 'user_id' 
    AND data_type != 'uuid'
  ) THEN
    -- Drop any existing constraint
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_user_id_check;
    
    -- Alter column type to UUID
    ALTER TABLE conversations ALTER COLUMN user_id TYPE UUID USING user_id::UUID;
  END IF;
  
  -- Add foreign key constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'conversations_user_id_fkey'
    AND table_name = 'conversations'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add user_id index if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'conversations' AND indexname = 'idx_conversations_user_id_new'
  ) THEN
    CREATE INDEX idx_conversations_user_id_new ON conversations(user_id, updated_at DESC);
  END IF;
END $$;

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_timestamp
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_timestamp();

CREATE TRIGGER update_user_profiles_timestamp
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_timestamp();

CREATE TRIGGER update_user_watchlists_timestamp
  BEFORE UPDATE ON user_watchlists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_timestamp();

-- Function: Create user profile automatically when user is created
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_user_profile_trigger
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile();

-- Function: Increment query count
CREATE OR REPLACE FUNCTION increment_user_query_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET total_queries = total_queries + 1
  WHERE user_id = (
    SELECT user_id FROM conversations WHERE id = NEW.conversation_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_query_count_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.role = 'user')
  EXECUTE FUNCTION increment_user_query_count();

-- Function: Increment conversation count
CREATE OR REPLACE FUNCTION increment_user_conversation_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET total_conversations = total_conversations + 1
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_conversation_count_trigger
  AFTER INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION increment_user_conversation_count();

-- Function: Clean up expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM email_verification_tokens WHERE expires_at < NOW();
  DELETE FROM password_reset_tokens WHERE expires_at < NOW();
  DELETE FROM user_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function: Record login
CREATE OR REPLACE FUNCTION record_user_login(
  p_user_id UUID,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  -- Update last login time
  UPDATE users
  SET last_login_at = NOW(),
      failed_login_attempts = 0,
      locked_until = NULL
  WHERE id = p_user_id;
  
  -- Create audit log
  INSERT INTO audit_logs (user_id, action, ip_address, user_agent)
  VALUES (p_user_id, 'login', p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql;

-- Function: Record failed login
CREATE OR REPLACE FUNCTION record_failed_login(
  p_email TEXT,
  p_ip_address TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_user_id UUID;
  v_failed_attempts INTEGER;
BEGIN
  SELECT id, failed_login_attempts INTO v_user_id, v_failed_attempts
  FROM users
  WHERE email = p_email;
  
  IF v_user_id IS NOT NULL THEN
    v_failed_attempts := v_failed_attempts + 1;
    
    -- Lock account after 5 failed attempts for 15 minutes
    IF v_failed_attempts >= 5 THEN
      UPDATE users
      SET failed_login_attempts = v_failed_attempts,
          locked_until = NOW() + INTERVAL '15 minutes'
      WHERE id = v_user_id;
    ELSE
      UPDATE users
      SET failed_login_attempts = v_failed_attempts
      WHERE id = v_user_id;
    END IF;
    
    -- Create audit log
    INSERT INTO audit_logs (user_id, action, ip_address, metadata)
    VALUES (v_user_id, 'failed_login', p_ip_address, 
            jsonb_build_object('attempts', v_failed_attempts));
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS FOR EASY DATA ACCESS
-- ============================================

-- View: User details with profile
CREATE VIEW user_details AS
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.avatar_url,
  u.email_verified,
  u.is_active,
  u.is_premium,
  u.created_at,
  u.last_login_at,
  p.default_watchlist,
  p.notification_preferences,
  p.risk_tolerance,
  p.investment_goals,
  p.preferred_sectors,
  p.onboarding_completed,
  p.total_queries,
  p.total_conversations
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id;

-- View: User statistics
CREATE VIEW user_statistics AS
SELECT 
  u.id AS user_id,
  u.email,
  u.full_name,
  u.is_premium,
  p.total_queries,
  p.total_conversations,
  COUNT(DISTINCT c.id) AS active_conversations,
  COUNT(DISTINCT m.id) AS total_messages,
  COUNT(DISTINCT w.id) AS watchlist_count,
  MAX(m.created_at) AS last_message_at
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id
LEFT JOIN conversations c ON u.id = c.user_id
LEFT JOIN messages m ON c.id = m.conversation_id
LEFT JOIN user_watchlists w ON u.id = w.user_id
GROUP BY u.id, u.email, u.full_name, u.is_premium, p.total_queries, p.total_conversations;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own data
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
  FOR UPDATE
  USING (auth.uid() = id);

-- Policy: User profiles
CREATE POLICY user_profiles_select_own ON user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_profiles_update_own ON user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Watchlists
CREATE POLICY watchlists_select_own ON user_watchlists
  FOR SELECT
  USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY watchlists_insert_own ON user_watchlists
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY watchlists_update_own ON user_watchlists
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY watchlists_delete_own ON user_watchlists
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy: Conversations
CREATE POLICY conversations_select_own ON conversations
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY conversations_insert_own ON conversations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY conversations_update_own ON conversations
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY conversations_delete_own ON conversations
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy: Messages
CREATE POLICY messages_select_own ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );

CREATE POLICY messages_insert_own ON messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );

-- Policy: Sessions
CREATE POLICY sessions_select_own ON user_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY sessions_delete_own ON user_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- SAMPLE DATA (for testing)
-- ============================================

-- Create a test user (password: 'testpassword123')
INSERT INTO users (email, password_hash, full_name, email_verified, is_active)
VALUES (
  'test@catalyst.com',
  '$2a$10$rQZ5C3L4KX3y8N.jGQJ8ZeQxN5X5gGZKq7L3aK4C8V9KZ5L4K3X5Y', -- bcrypt hash
  'Test User',
  TRUE,
  TRUE
) ON CONFLICT (email) DO NOTHING;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE users IS 'Core user authentication and account information';
COMMENT ON TABLE user_profiles IS 'Extended user profile data and preferences';
COMMENT ON TABLE user_watchlists IS 'User-created stock watchlists';
COMMENT ON TABLE user_sessions IS 'Active user sessions for authentication';
COMMENT ON TABLE audit_logs IS 'Security audit trail for user actions';
COMMENT ON TABLE email_verification_tokens IS 'Email verification tokens with expiration';
COMMENT ON TABLE password_reset_tokens IS 'Password reset tokens with expiration';

COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password (never store plaintext)';
COMMENT ON COLUMN users.failed_login_attempts IS 'Counter for rate limiting, resets on successful login';
COMMENT ON COLUMN users.locked_until IS 'Account lock timestamp after failed attempts';
COMMENT ON COLUMN user_profiles.default_watchlist IS 'JSON array of ticker symbols for quick access';
COMMENT ON COLUMN user_profiles.total_queries IS 'Counter incremented on each user message';
COMMENT ON COLUMN user_watchlists.tickers IS 'JSON array of {symbol: "TSLA", addedAt: "2025-11-21T10:00:00Z"}';

-- ============================================
-- COMPLETED
-- ============================================

SELECT 'User authentication system created successfully!' AS status;
