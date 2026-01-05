# Catalyst Finance Database Schema

**Last Updated:** November 21, 2025

This document provides a comprehensive overview of the Catalyst Finance Supabase database structure, organized by functional area.

---

## Table of Contents
1. [Authentication & User Management](#authentication--user-management)
2. [User Data & Personalization](#user-data--personalization)
3. [Market Data & Prices](#market-data--prices)
4. [Events & Company Information](#events--company-information)
5. [Conversations & Messages](#conversations--messages)
6. [System & Infrastructure](#system--infrastructure)
7. [Storage & Files](#storage--files)
8. [Audit & Logging](#audit--logging)

---

## Authentication & User Management

### `auth.users` (Supabase Auth - Main User Table)
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** Supabase's managed authentication table. Stores core user authentication data.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Unique user identifier |
| `email` | varchar | YES | - | User's email address |
| `encrypted_password` | varchar | YES | - | Bcrypt hashed password |
| `email_confirmed_at` | timestamptz | YES | - | Email verification timestamp |
| `confirmed_at` | timestamptz | YES | - | Overall confirmation timestamp |
| `last_sign_in_at` | timestamptz | YES | - | Last login timestamp |
| `created_at` | timestamptz | YES | - | Account creation timestamp |
| `updated_at` | timestamptz | YES | - | Last update timestamp |
| `raw_user_meta_data` | jsonb | YES | - | Custom user metadata (full_name, avatar_url) |
| `raw_app_meta_data` | jsonb | YES | - | App metadata (is_premium, roles) |
| `banned_until` | timestamptz | YES | - | Temporary ban expiration |
| `deleted_at` | timestamptz | YES | - | Soft delete timestamp |
| `is_sso_user` | boolean | NO | false | True if user signed up via SSO |
| `is_anonymous` | boolean | NO | false | True for anonymous users |
| `phone` | text | YES | - | Phone number |
| `phone_confirmed_at` | timestamptz | YES | - | Phone verification timestamp |
| `confirmation_token` | varchar | YES | - | Email confirmation token |
| `recovery_token` | varchar | YES | - | Password recovery token |
| `email_change` | varchar | YES | - | Pending email change |
| `email_change_token_new` | varchar | YES | - | New email confirmation token |
| `email_change_token_current` | varchar | YES | '' | Current email confirmation token |
| `email_change_confirm_status` | smallint | YES | 0 | Email change confirmation status |
| `reauthentication_token` | varchar | YES | '' | Re-authentication token |
| `reauthentication_sent_at` | timestamptz | YES | - | Re-auth token sent timestamp |

**Indexes:**
- Primary key on `id`
- Unique index on `email`
- Indexes on `confirmation_token`, `recovery_token`, `email_change_token_*`

---

### `auth.identities`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** OAuth and SSO provider identities linked to users.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Identity ID |
| `user_id` | uuid | NO | - | Reference to auth.users |
| `provider` | text | NO | - | Provider name (google, github, etc.) |
| `provider_id` | text | NO | - | User ID from provider |
| `identity_data` | jsonb | NO | - | Provider-specific data |
| `email` | text | YES | - | Email from provider |
| `last_sign_in_at` | timestamptz | YES | - | Last sign in with this provider |
| `created_at` | timestamptz | YES | - | Identity creation timestamp |
| `updated_at` | timestamptz | YES | - | Last update timestamp |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE

---

### `auth.sessions`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** Active user sessions with refresh token tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Session ID |
| `user_id` | uuid | NO | - | Reference to auth.users |
| `created_at` | timestamptz | YES | - | Session start time |
| `updated_at` | timestamptz | YES | - | Last activity time |
| `factor_id` | uuid | YES | - | MFA factor used |
| `aal` | enum | YES | - | Authentication assurance level |
| `not_after` | timestamptz | YES | - | Session expiration |
| `refreshed_at` | timestamp | YES | - | Last token refresh |
| `user_agent` | text | YES | - | Browser/client user agent |
| `ip` | inet | YES | - | Client IP address |
| `tag` | text | YES | - | Custom session tag |
| `oauth_client_id` | uuid | YES | - | OAuth client if applicable |
| `refresh_token_hmac_key` | text | YES | - | Token HMAC key |
| `refresh_token_counter` | bigint | YES | - | Refresh token rotation counter |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE
- `factor_id` → `auth.mfa_factors(id)` ON DELETE CASCADE

---

### `auth.refresh_tokens`
**Schema:** `auth`  
**Primary Key:** `id` (bigserial)  
**Description:** Refresh tokens for session management.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | nextval() | Token ID |
| `token` | varchar | YES | - | Hashed refresh token |
| `user_id` | varchar | YES | - | User identifier |
| `session_id` | uuid | YES | - | Associated session |
| `parent` | varchar | YES | - | Parent token (rotation) |
| `revoked` | boolean | YES | - | Token revoked status |
| `created_at` | timestamptz | YES | - | Token creation time |
| `updated_at` | timestamptz | YES | - | Last update time |
| `instance_id` | uuid | YES | - | Supabase instance ID |

---

### `auth.mfa_factors`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** Multi-factor authentication factors for users.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Factor ID |
| `user_id` | uuid | NO | - | Reference to auth.users |
| `friendly_name` | text | YES | - | User-defined factor name |
| `factor_type` | enum | NO | - | Type: totp, webauthn |
| `status` | enum | NO | - | Status: unverified, verified |
| `secret` | text | YES | - | TOTP secret (encrypted) |
| `phone` | text | YES | - | Phone number for SMS |
| `web_authn_credential` | jsonb | YES | - | WebAuthn credential data |
| `web_authn_aaguid` | uuid | YES | - | Authenticator AAGUID |
| `last_challenged_at` | timestamptz | YES | - | Last MFA challenge time |
| `last_webauthn_challenge_data` | jsonb | YES | - | Last WebAuthn challenge |
| `created_at` | timestamptz | NO | - | Factor creation time |
| `updated_at` | timestamptz | NO | - | Last update time |

---

### `auth.mfa_challenges`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** MFA challenge attempts.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Challenge ID |
| `factor_id` | uuid | NO | - | Reference to mfa_factors |
| `created_at` | timestamptz | NO | - | Challenge creation time |
| `verified_at` | timestamptz | YES | - | Challenge verification time |
| `ip_address` | inet | NO | - | Client IP address |
| `otp_code` | text | YES | - | TOTP code (hashed) |
| `web_authn_session_data` | jsonb | YES | - | WebAuthn session data |

---

### `auth.mfa_amr_claims`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** Authentication Method Reference claims for sessions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Claim ID |
| `session_id` | uuid | NO | - | Reference to sessions |
| `authentication_method` | text | NO | - | Method: password, otp, webauthn |
| `created_at` | timestamptz | NO | - | Claim creation time |
| `updated_at` | timestamptz | NO | - | Last update time |

---

## User Data & Personalization

### `public.user_profiles`
**Schema:** `public`  
**Primary Key:** `user_id` (uuid)  
**Description:** Extended user profile information and preferences.  
**RLS:** Enabled - Users can only access their own profile.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `user_id` | uuid | NO | - | Reference to auth.users |
| `default_watchlist` | jsonb | YES | '[]' | Array of ticker symbols |
| `notification_preferences` | jsonb | YES | '{}' | Notification settings |
| `risk_tolerance` | text | YES | - | Risk level: low, medium, high |
| `investment_goals` | text[] | YES | - | Array of investment goals |
| `preferred_sectors` | text[] | YES | - | Array of sector preferences |
| `onboarding_completed` | boolean | YES | false | Onboarding completion status |
| `onboarding_step` | integer | YES | 0 | Current onboarding step |
| `total_queries` | integer | YES | 0 | Total AI queries count |
| `total_conversations` | integer | YES | 0 | Total conversations count |
| `created_at` | timestamptz | YES | now() | Profile creation time |
| `updated_at` | timestamptz | YES | now() | Last update time |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE

**Triggers:**
- Auto-created via `handle_new_user()` function when user signs up

**RLS Policies:**
- SELECT: Users can view their own profile
- INSERT: Users can create their own profile
- UPDATE: Users can update their own profile

---

### `public.user_watchlists`
**Schema:** `public`  
**Primary Key:** `id` (uuid)  
**Description:** User-created watchlists with multiple stocks.  
**RLS:** Enabled - Users can access their own watchlists and public watchlists.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() | Watchlist ID |
| `user_id` | uuid | NO | - | Reference to auth.users |
| `name` | text | NO | - | Watchlist name |
| `description` | text | YES | - | Watchlist description |
| `tickers` | jsonb | YES | '[]' | Array of ticker symbols |
| `is_default` | boolean | YES | false | Is user's default watchlist |
| `is_public` | boolean | YES | false | Public visibility |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE

**RLS Policies:**
- SELECT: Users can view own watchlists + public watchlists
- INSERT: Users can create own watchlists
- UPDATE: Users can update own watchlists
- DELETE: Users can delete own watchlists

---

### `public.watchlist` (Master Symbol List)
**Schema:** `public`  
**Primary Key:** `symbol` (text)  
**Description:** Master list of all tradeable symbols in the system.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `is_active` | boolean | NO | true | Symbol is actively traded |

**RLS Policies:**
- SELECT: Authenticated users can view all symbols

---

## Market Data & Prices

### `public.stock_quote_now`
**Schema:** `public`  
**Primary Key:** `symbol` (text)  
**Description:** Latest stock quote for each symbol (real-time snapshot).  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `close` | double precision | YES | - | Latest price |
| `timestamp` | timestamptz | YES | - | Quote timestamp (UTC) |
| `timestamp_et` | timestamptz | YES | - | Quote timestamp (ET) |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | NO | 'finnhub' | Data source |
| `ingested_at` | timestamptz | NO | now() | When data was ingested |

**Indexes:**
- Primary key on `symbol`
- Index on `timestamp`

**RLS Policies:**
- SELECT: Authenticated users can view quotes

---

### `public.daily_prices`
**Schema:** `public`  
**Primary Key:** `(symbol, date)`  
**Description:** Daily OHLCV data for historical analysis.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `date` | date | NO | - | Trading date |
| `date_et` | date | YES | - | Trading date (ET) |
| `open` | double precision | NO | - | Opening price |
| `high` | double precision | NO | - | High price |
| `low` | double precision | NO | - | Low price |
| `close` | double precision | NO | - | Closing price |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | YES | 'hourly_aggregated' | Data source |
| `created_at` | timestamptz | YES | now() | Record creation time |
| `updated_at` | timestamptz | YES | now() | Last update time |

**Indexes:**
- Primary key on `(symbol, date)`
- Index on `symbol`
- Index on `date`

**RLS Policies:**
- SELECT: Authenticated users can view daily prices

---

### `public.hourly_prices`
**Schema:** `public`  
**Primary Key:** `(symbol, timestamp)`  
**Description:** Hourly OHLCV aggregated data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `timestamp` | timestamptz | NO | - | Hour timestamp (UTC) |
| `timestamp_et` | timestamptz | YES | - | Hour timestamp (ET) |
| `open` | double precision | NO | - | Opening price |
| `high` | double precision | NO | - | High price |
| `low` | double precision | NO | - | Low price |
| `close` | double precision | NO | - | Closing price |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | NO | 'intraday_aggregated' | Data source |
| `created_at` | timestamptz | NO | now() | Record creation time |

**Indexes:**
- Primary key on `(symbol, timestamp)`
- Index on `symbol`
- Index on `timestamp`

**RLS Policies:**
- SELECT: Authenticated users can view hourly prices

---

### `public.five_minute_prices`
**Schema:** `public`  
**Primary Key:** `(symbol, timestamp)`  
**Description:** 5-minute OHLCV aggregated data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `timestamp` | timestamptz | NO | - | 5-minute interval timestamp |
| `timestamp_et` | timestamptz | YES | - | Timestamp (ET) |
| `open` | double precision | NO | - | Opening price |
| `high` | double precision | NO | - | High price |
| `low` | double precision | NO | - | Low price |
| `close` | double precision | NO | - | Closing price |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | NO | 'intraday_aggregated' | Data source |
| `created_at` | timestamptz | NO | now() | Record creation time |

**RLS Policies:**
- SELECT: Authenticated users can view 5-minute prices

---

### `public.one_minute_prices`
**Schema:** `public`  
**Primary Key:** `(symbol, timestamp)`  
**Description:** 1-minute OHLCV aggregated data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `timestamp` | timestamptz | NO | - | 1-minute interval timestamp |
| `timestamp_et` | timestamptz | YES | - | Timestamp (ET) |
| `open` | double precision | NO | - | Opening price |
| `high` | double precision | NO | - | High price |
| `low` | double precision | NO | - | Low price |
| `close` | double precision | NO | - | Closing price |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | NO | 'intraday_aggregated' | Data source |
| `created_at` | timestamptz | NO | now() | Record creation time |

**RLS Policies:**
- SELECT: Authenticated users can view 1-minute prices

---

### `public.intraday_prices`
**Schema:** `public`  
**Primary Key:** `(symbol, timestamp)`  
**Description:** Raw tick-level intraday price data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `timestamp` | timestamptz | NO | - | Trade timestamp (UTC) |
| `timestamp_et` | timestamptz | YES | - | Trade timestamp (ET) |
| `price` | double precision | NO | - | Trade price |
| `volume` | bigint | YES | - | Trade volume |
| `source` | text | YES | 'finnhub' | Data source |
| `ingested_at` | timestamptz | YES | now() | Data ingestion time |

**Indexes:**
- Primary key on `(symbol, timestamp)`
- Index on `symbol`
- Index on `timestamp`

**RLS Policies:**
- SELECT: Authenticated users can view intraday prices

---

### `public.finnhub_quote_snapshots`
**Schema:** `public`  
**Primary Key:** `(symbol, timestamp)`  
**Description:** Historical snapshots of Finnhub quote data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `timestamp` | timestamptz | NO | - | Snapshot timestamp (UTC) |
| `timestamp_et` | timestamptz | YES | - | Snapshot timestamp (ET) |
| `market_date` | date | NO | - | Market date |
| `close` | double precision | YES | - | Current price |
| `change` | double precision | YES | - | Price change |
| `change_percent` | double precision | YES | - | Percent change |
| `high` | double precision | YES | - | Day high |
| `low` | double precision | YES | - | Day low |
| `open` | double precision | YES | - | Day open |
| `previous_close` | double precision | YES | - | Previous close |
| `volume` | bigint | YES | - | Trading volume |
| `source` | text | NO | 'finnhub_quote' | Data source |
| `ingested_at` | timestamptz | NO | now() | Data ingestion time |

**Indexes:**
- Primary key on `(symbol, timestamp)`
- Index on `symbol`
- Index on `market_date`

**RLS Policies:**
- SELECT: Authenticated users can view snapshots

---

## Events & Company Information

### `public.event_data`
**Schema:** `public`  
**Primary Key:** `PrimaryID` (text)  
**Description:** Corporate events, earnings, announcements.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `PrimaryID` | text | NO | - | Unique event identifier |
| `type` | text | YES | - | Event type (earnings, merger, etc.) |
| `title` | text | YES | - | Event title |
| `company` | text | YES | - | Company name |
| `ticker` | text | YES | - | Stock ticker symbol |
| `sector` | text | YES | - | Company sector |
| `time` | text | YES | - | Event time (text format) |
| `actualDateTime` | timestamptz | YES | - | Event datetime (UTC) |
| `actualDateTime_et` | timestamptz | YES | - | Event datetime (ET) |
| `impactRating` | bigint | YES | - | Impact rating (1-10) |
| `confidence` | bigint | YES | - | Confidence score (1-100) |
| `aiInsight` | text | YES | - | AI-generated insight |
| `created_on` | timestamptz | NO | now() | Record creation time |
| `created_on_et` | timestamptz | YES | - | Creation time (ET) |
| `updated_on` | timestamptz | NO | now() | Last update time |
| `updated_on_et` | timestamptz | YES | - | Update time (ET) |

**Indexes:**
- Primary key on `PrimaryID`
- Index on `ticker`
- Index on `actualDateTime`
- Index on `type`

**RLS Policies:**
- SELECT: Authenticated users can view events

---

### `public.company_information`
**Schema:** `public`  
**Primary Key:** `symbol` (text)  
**Description:** Comprehensive company profile and fundamental data.  
**RLS:** Enabled - Authenticated users have read-only access.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `symbol` | text | NO | - | Stock ticker symbol |
| `name` | text | YES | - | Company name |
| `description` | text | YES | - | Company description |
| `city` | text | YES | - | Headquarters city |
| `state` | text | YES | - | Headquarters state |
| `country` | text | YES | - | Headquarters country |
| `currency` | text | YES | - | Trading currency |
| `exchange` | text | YES | - | Stock exchange |
| `weburl` | text | YES | - | Company website |
| `logo` | text | YES | - | Logo URL |
| `gsector` | text | YES | - | GICS sector |
| `gind` | text | YES | - | GICS industry |
| `gsubind` | text | YES | - | GICS sub-industry |
| `finnhubIndustry` | text | YES | - | Finnhub industry classification |
| `employeeTotal` | smallint | YES | - | Number of employees |
| `shareOutstanding` | double precision | YES | - | Shares outstanding |
| `marketCapitalization` | numeric | YES | - | Market cap |
| `ipo` | date | YES | - | IPO date (UTC) |
| `ipo_et` | date | YES | - | IPO date (ET) |
| `source` | text | YES | '' | Data source |
| `json` | text | YES | - | Raw JSON data |
| `ingested_at` | timestamptz | YES | - | Data ingestion time (UTC) |
| `ingested_at_et` | timestamptz | YES | - | Ingestion time (ET) |

**Indexes:**
- Primary key on `symbol`
- Index on `name`
- Index on `gsector`
- Index on `exchange`

**RLS Policies:**
- SELECT: Authenticated users can view company info

---

## Conversations & Messages

### `public.conversations`
**Schema:** `public`  
**Primary Key:** `id` (uuid)  
**Description:** User chat conversations with AI assistant.  
**RLS:** Enabled - Users can only access their own conversations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() | Conversation ID |
| `user_id` | uuid | NO | - | Reference to auth.users |
| `title` | text | YES | - | Conversation title |
| `metadata` | jsonb | YES | '{}' | Additional metadata |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE CASCADE

**Triggers:**
- `updated_at` auto-updates on row change

**RLS Policies:**
- SELECT: Users can view own conversations
- INSERT: Users can create own conversations
- UPDATE: Users can update own conversations
- DELETE: Users can delete own conversations

---

### `public.messages`
**Schema:** `public`  
**Primary Key:** `id` (uuid)  
**Description:** Individual messages within conversations.  
**RLS:** Enabled - Users can only access messages in their conversations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Message ID |
| `conversation_id` | uuid | NO | - | Reference to conversations |
| `role` | text | NO | - | Message role: user, assistant, system |
| `content` | text | NO | - | Message content |
| `topic` | text | NO | - | Message topic/category |
| `extension` | text | NO | - | Extension identifier |
| `data_cards` | jsonb | YES | - | Structured data cards for display |
| `payload` | jsonb | YES | - | Additional payload data |
| `event` | text | YES | - | Event identifier |
| `feedback` | text | YES | - | User feedback: positive, negative |
| `feedback_reason` | text | YES | - | Reason for feedback |
| `private` | boolean | YES | false | Is message private |
| `token_count` | integer | YES | - | Token count for AI messages |
| `metadata` | jsonb | YES | '{}' | Additional metadata |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamp | NO | now() | Last update timestamp |
| `inserted_at` | timestamp | NO | now() | Insertion timestamp |

**Foreign Keys:**
- `conversation_id` → `conversations(id)` ON DELETE CASCADE

**Indexes:**
- Primary key on `id`
- Index on `conversation_id`
- Index on `created_at`

**RLS Policies:**
- SELECT: Users can view messages in own conversations
- INSERT: Users can add messages to own conversations
- UPDATE: Users can update messages in own conversations (for feedback)

---

## System & Infrastructure

### `public.eod_run_log`
**Schema:** `public`  
**Primary Key:** `et_date` (date)  
**Description:** End-of-day data processing log.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `et_date` | date | NO | - | Date of EOD run (ET) |
| `ran_at` | timestamptz | NO | now() | When the EOD process ran |
| `rows_upserted` | integer | YES | - | Number of rows processed |

---

### `cron.job`
**Schema:** `cron`  
**Primary Key:** `jobid` (bigserial)  
**Description:** Scheduled cron jobs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `jobid` | bigint | NO | nextval() | Job ID |
| `schedule` | text | NO | - | Cron schedule expression |
| `command` | text | NO | - | SQL command to execute |
| `nodename` | text | NO | 'localhost' | Node name |
| `nodeport` | integer | NO | inet_server_port() | Node port |
| `database` | text | NO | current_database() | Target database |
| `username` | text | NO | CURRENT_USER | Execution user |
| `active` | boolean | NO | true | Is job active |
| `jobname` | text | YES | - | Human-readable job name |

---

### `cron.job_run_details`
**Schema:** `cron`  
**Primary Key:** `runid` (bigserial)  
**Description:** Execution history of cron jobs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `jobid` | bigint | YES | - | Reference to cron.job |
| `runid` | bigint | NO | nextval() | Run ID |
| `job_pid` | integer | YES | - | Process ID |
| `database` | text | YES | - | Database name |
| `username` | text | YES | - | User that ran the job |
| `command` | text | YES | - | Command executed |
| `status` | text | YES | - | Status: succeeded, failed |
| `return_message` | text | YES | - | Output message |
| `start_time` | timestamptz | YES | - | Job start time |
| `end_time` | timestamptz | YES | - | Job end time |

---

### `public.migrations`
**Schema:** `public`  
**Primary Key:** `id` (integer)  
**Description:** Database migration tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | - | Migration ID |
| `name` | varchar | NO | - | Migration name |
| `hash` | varchar | NO | - | Migration hash |
| `executed_at` | timestamp | YES | CURRENT_TIMESTAMP | Execution timestamp |

---

### `public.seed_files`
**Schema:** `public`  
**Primary Key:** `path` (text)  
**Description:** Database seed files tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `path` | text | NO | - | Seed file path |
| `hash` | text | NO | - | File content hash |

---

### `realtime.subscription`
**Schema:** `realtime`  
**Primary Key:** `id` (bigint)  
**Description:** Real-time subscription tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | - | Subscription ID |
| `subscription_id` | uuid | NO | - | External subscription ID |
| `entity` | regclass | NO | - | Table being subscribed to |
| `filters` | array | NO | '{}' | Subscription filters |
| `claims` | jsonb | NO | - | User claims |
| `claims_role` | regrole | NO | - | User role |
| `created_at` | timestamp | NO | timezone('utc', now()) | Creation timestamp |

---

### `net.http_request_queue`
**Schema:** `net`  
**Primary Key:** `id` (bigserial)  
**Description:** HTTP request queue for async operations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | nextval() | Request ID |
| `method` | text | NO | - | HTTP method |
| `url` | text | NO | - | Target URL |
| `headers` | jsonb | YES | - | Request headers |
| `body` | bytea | YES | - | Request body |
| `timeout_milliseconds` | integer | NO | - | Request timeout |

---

## Storage & Files

### `storage.buckets`
**Schema:** `storage`  
**Primary Key:** `id` (text)  
**Description:** Storage buckets for file uploads.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | text | NO | - | Bucket ID |
| `name` | text | NO | - | Bucket name |
| `owner` | uuid | YES | - | Bucket owner (deprecated) |
| `owner_id` | text | YES | - | Owner identifier |
| `type` | enum | NO | 'STANDARD' | Bucket type |
| `public` | boolean | YES | false | Public access |
| `avif_autodetection` | boolean | YES | false | AVIF format detection |
| `file_size_limit` | bigint | YES | - | Max file size |
| `allowed_mime_types` | text[] | YES | - | Allowed MIME types |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |

---

### `storage.objects`
**Schema:** `storage`  
**Primary Key:** `id` (uuid)  
**Description:** Individual files stored in buckets.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Object ID |
| `bucket_id` | text | YES | - | Reference to buckets |
| `name` | text | YES | - | Object name/path |
| `owner` | uuid | YES | - | Object owner (deprecated) |
| `owner_id` | text | YES | - | Owner identifier |
| `version` | text | YES | - | Object version |
| `level` | integer | YES | - | Directory level |
| `metadata` | jsonb | YES | - | File metadata |
| `user_metadata` | jsonb | YES | - | User-defined metadata |
| `path_tokens` | text[] | YES | - | Path components |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |
| `last_accessed_at` | timestamptz | YES | now() | Last access timestamp |

---

### `storage.prefixes`
**Schema:** `storage`  
**Primary Key:** `(bucket_id, name, level)`  
**Description:** Directory prefixes in storage buckets.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `bucket_id` | text | NO | - | Reference to buckets |
| `name` | text | NO | - | Prefix name |
| `level` | integer | NO | - | Directory level |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |

---

### `storage.buckets_analytics`
**Schema:** `storage`  
**Primary Key:** `id` (uuid)  
**Description:** Analytics-specific buckets (Iceberg format).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Bucket ID |
| `name` | text | NO | - | Bucket name |
| `type` | enum | NO | 'ANALYTICS' | Bucket type |
| `format` | text | NO | 'ICEBERG' | Data format |
| `created_at` | timestamptz | NO | now() | Creation timestamp |
| `updated_at` | timestamptz | NO | now() | Last update timestamp |
| `deleted_at` | timestamptz | YES | - | Soft delete timestamp |

---

### `storage.buckets_vectors`
**Schema:** `storage`  
**Primary Key:** `id` (text)  
**Description:** Vector storage buckets for embeddings.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | text | NO | - | Bucket ID |
| `type` | enum | NO | 'VECTOR' | Bucket type |
| `created_at` | timestamptz | NO | now() | Creation timestamp |
| `updated_at` | timestamptz | NO | now() | Last update timestamp |

---

### `storage.vector_indexes`
**Schema:** `storage`  
**Primary Key:** `id` (text)  
**Description:** Vector search indexes.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | text | NO | gen_random_uuid() | Index ID |
| `name` | text | NO | - | Index name |
| `bucket_id` | text | NO | - | Reference to vector bucket |
| `data_type` | text | NO | - | Vector data type |
| `dimension` | integer | NO | - | Vector dimension |
| `distance_metric` | text | NO | - | Distance metric (cosine, euclidean) |
| `metadata_configuration` | jsonb | YES | - | Index configuration |
| `created_at` | timestamptz | NO | now() | Creation timestamp |
| `updated_at` | timestamptz | NO | now() | Last update timestamp |

---

## Audit & Logging

### `public.audit_logs`
**Schema:** `public`  
**Primary Key:** `id` (uuid)  
**Description:** Application-level audit logging.  
**RLS:** Enabled - Users can view own logs; authenticated users can insert own logs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | uuid_generate_v4() | Log ID |
| `user_id` | uuid | YES | - | Reference to auth.users |
| `action` | text | NO | - | Action performed |
| `resource_type` | text | YES | - | Resource type affected |
| `resource_id` | text | YES | - | Resource identifier |
| `ip_address` | text | YES | - | Client IP address |
| `user_agent` | text | YES | - | Client user agent |
| `metadata` | jsonb | YES | '{}' | Additional context |
| `created_at` | timestamptz | YES | now() | Log timestamp |

**Foreign Keys:**
- `user_id` → `auth.users(id)` ON DELETE SET NULL

**Indexes:**
- Primary key on `id`
- Index on `user_id`
- Index on `created_at`
- Index on `action`

**RLS Policies:**
- SELECT: Users can view own audit logs
- INSERT: Authenticated users can insert own audit logs

---

### `auth.audit_log_entries`
**Schema:** `auth`  
**Primary Key:** `id` (uuid)  
**Description:** Supabase Auth audit logging (system-level).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | - | Log entry ID |
| `instance_id` | uuid | YES | - | Supabase instance ID |
| `payload` | json | YES | - | Log payload |
| `ip_address` | varchar | NO | '' | Client IP address |
| `created_at` | timestamptz | YES | - | Log timestamp |

---

### `vault.secrets`
**Schema:** `vault`  
**Primary Key:** `id` (uuid)  
**Description:** Encrypted secrets storage.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | gen_random_uuid() | Secret ID |
| `name` | text | YES | - | Secret name |
| `description` | text | NO | '' | Secret description |
| `secret` | text | NO | - | Encrypted secret value |
| `key_id` | uuid | YES | - | Encryption key ID |
| `nonce` | bytea | YES | _crypto_aead_det_noncegen() | Nonce for encryption |
| `created_at` | timestamptz | NO | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | NO | CURRENT_TIMESTAMP | Last update timestamp |

---

### `vault.decrypted_secrets`
**Schema:** `vault`  
**Description:** View for decrypting secrets (requires appropriate permissions).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | YES | - | Secret ID |
| `name` | text | YES | - | Secret name |
| `description` | text | YES | - | Secret description |
| `secret` | text | YES | - | Encrypted value |
| `decrypted_secret` | text | YES | - | Decrypted value (view only) |
| `key_id` | uuid | YES | - | Encryption key ID |
| `nonce` | bytea | YES | - | Encryption nonce |
| `created_at` | timestamptz | YES | - | Creation timestamp |
| `updated_at` | timestamptz | YES | - | Last update timestamp |

---

## Views

### `public.user_details`
**Schema:** `public`  
**Type:** View  
**Description:** Consolidated view of user information from auth.users and user_profiles.

**Columns:**
- `id` - User ID from auth.users
- `email` - User email
- `full_name` - From raw_user_meta_data
- `avatar_url` - From raw_user_meta_data
- `email_verified` - Derived from email_confirmed_at
- `is_active` - Derived from banned_until
- `is_premium` - From raw_app_meta_data
- `created_at` - Account creation time
- `last_login_at` - Last sign in time
- `default_watchlist` - From user_profiles
- `notification_preferences` - From user_profiles
- `risk_tolerance` - From user_profiles
- `investment_goals` - From user_profiles
- `preferred_sectors` - From user_profiles
- `onboarding_completed` - From user_profiles
- `total_queries` - From user_profiles
- `total_conversations` - From user_profiles

---

### `public.user_statistics`
**Schema:** `public`  
**Type:** View  
**Description:** Aggregated user statistics with conversation and message counts.

**Columns:**
- `user_id` - User ID
- `email` - User email
- `full_name` - User name
- `is_premium` - Premium status
- `total_queries` - From user_profiles
- `total_conversations` - From user_profiles
- `active_conversations` - Count of conversations
- `total_messages` - Count of messages
- `watchlist_count` - Count of user_watchlists
- `last_message_at` - Most recent message timestamp

---

## Database Functions

### `public.handle_new_user()`
**Returns:** trigger  
**Description:** Automatically creates user_profiles entry when new user signs up.

**Trigger:** `on_auth_user_created` ON `auth.users` AFTER INSERT

---

### `public.increment_user_queries(user_uuid UUID)`
**Returns:** void  
**Description:** Increments the total_queries counter for a user.

---

### `public.increment_user_conversations(user_uuid UUID)`
**Returns:** void  
**Description:** Increments the total_conversations counter for a user.

---

## RLS Security Summary

| Table | RLS Enabled | Policies |
|-------|-------------|----------|
| `user_profiles` | ✅ | Users: own profile only |
| `user_watchlists` | ✅ | Users: own + public watchlists |
| `conversations` | ✅ | Users: own conversations only |
| `messages` | ✅ | Users: messages in own conversations |
| `audit_logs` | ✅ | Users: own logs; authenticated: insert own |
| `stock_quote_now` | ✅ | Authenticated: read-only |
| `daily_prices` | ✅ | Authenticated: read-only |
| `hourly_prices` | ✅ | Authenticated: read-only |
| `five_minute_prices` | ✅ | Authenticated: read-only |
| `one_minute_prices` | ✅ | Authenticated: read-only |
| `intraday_prices` | ✅ | Authenticated: read-only |
| `finnhub_quote_snapshots` | ✅ | Authenticated: read-only |
| `event_data` | ✅ | Authenticated: read-only |
| `company_information` | ✅ | Authenticated: read-only |
| `watchlist` | ✅ | Authenticated: read-only |

**Note:** Service role key bypasses all RLS policies for data ingestion operations.

---

## Data Ingestion Architecture

**Market Data Sources:**
- Finnhub API for real-time quotes
- Historical price aggregation from intraday data
- Event data from various providers

**Ingestion Process:**
1. External services fetch data from APIs
2. Data sent to `/internal/ingest/*` endpoints
3. Backend uses `supabaseAdmin` client (service role)
4. Service role bypasses RLS to insert/update data
5. Authenticated users query via anon key (RLS enforced)

**Data Flow:**
```
External API → Data Pipeline → Backend (service_role) → Supabase (RLS bypassed) → Storage
Frontend (anon_key) → Supabase (RLS enforced) → Read-only access
```

---

## Indexes Summary

**Critical Indexes:**
- All price tables: `(symbol, timestamp)` or `(symbol, date)` composite primary keys
- `event_data`: `PrimaryID`, `ticker`, `actualDateTime`, `type`
- `company_information`: `symbol`, `name`, `gsector`, `exchange`
- `messages`: `conversation_id`, `created_at`
- `conversations`: `user_id`, `updated_at`
- `audit_logs`: `user_id`, `created_at`, `action`

---

## Schema Versions

| Schema | Version | Last Migration |
|--------|---------|----------------|
| `public` | Latest | RLS policies migration |
| `auth` | Supabase Auth v2 | Managed by Supabase |
| `storage` | Supabase Storage v2 | Managed by Supabase |
| `realtime` | Supabase Realtime | Managed by Supabase |
| `cron` | pg_cron extension | Job scheduling |
| `net` | pg_net extension | HTTP requests |
| `vault` | Vault extension | Secrets management |

---

## Environment-Specific Notes

**Timezone Handling:**
- All `timestamptz` columns store UTC
- `*_et` columns contain Eastern Time conversions
- Frontend should display in user's local timezone

**Data Retention:**
- `intraday_prices`: 7 days rolling window
- `*_minute_prices`: 30 days rolling window
- `hourly_prices`: 90 days rolling window
- `daily_prices`: Historical (no expiration)
- `audit_logs`: 1 year retention
- `auth.audit_log_entries`: Managed by Supabase

**Performance Considerations:**
- Price tables use partitioning by symbol (future enhancement)
- Indexes on high-query columns (`symbol`, `timestamp`, `date`)
- RLS policies optimized for user_id lookups
- Read replicas for market data queries (production)

---

## Migration History

1. **Initial Schema** - Core market data tables
2. **User Authentication** - Added auth tables and RLS
3. **Conversations** - Added conversation and message tables
4. **RLS Policies** - Comprehensive RLS implementation
5. **Data Ingestion** - Service role bypass and FORCE RLS
6. **Audit Logging** - Custom audit_logs table with RLS

---

## Related Documentation

- [RLS Migration SQL](./rls-policies-migration.sql)
- [Supabase Auth Integration Guide](./SUPABASE_AUTH_INTEGRATION.md)
- [API Documentation](./API_DOCUMENTATION.md) *(if exists)*

---

**Last Updated:** November 21, 2025  
**Database:** Supabase PostgreSQL 15+  
**Maintainer:** Catalyst Finance Engineering Team
