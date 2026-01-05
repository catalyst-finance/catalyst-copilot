# FREE Catalyst Copilot Setup Guide

## Architecture Overview

**100% FREE Infrastructure** (except OpenAI API usage):

```
Mobile App
    ↓
Supabase Edge Function (FREE)
    ↓ (for stock/events)
    ↓
    ├─→ Supabase Database (FREE tier)
    └─→ DigitalOcean Function (FREE) → MongoDB
```

## Total Cost: $0/month + OpenAI API usage

---

## Step 1: Deploy MongoDB Proxy to DigitalOcean Functions

### Option A: Using Web UI (Easiest)

1. **Go to DigitalOcean Functions:**
   - Visit: https://cloud.digitalocean.com/functions
   - Click **"Create Function"**

2. **Upload Code:**
   - Click **"Upload Code"**
   - Select the `packages/mongodb-proxy` folder
   - Click **"Upload"**

3. **Set Environment Variables:**
   - Click **"Settings"** tab
   - Add variable: `MONGODB_URI`
   - Value: Your MongoDB connection string from DigitalOcean Databases
   - Format: `mongodb://doadmin:PASSWORD@cluster-do-user-xxxxx.db.ondigitalocean.com:27017/raw_data?authSource=admin&tls=true`

4. **Deploy:**
   - Click **"Deploy"**
   - Wait 1-2 minutes
   - Copy the **Function URL** (looks like: `https://faas-nyc1-xxxxx.doserverless.co/api/v1/web/fn-xxxxx/mongodb-proxy/index`)

### Option B: Using CLI

```bash
# Install doctl
# Windows: Download from https://github.com/digitalocean/doctl/releases

# Authenticate
doctl auth init

# Create namespace (one-time)
doctl serverless namespaces create --label "catalyst-functions" --region nyc1

# Connect
doctl serverless connect

# Deploy
cd "C:\Users\brand\Documents\Catalyst App External Functions\Catalyst Copilot"
doctl serverless deploy packages/mongodb-proxy

# Set MongoDB URI
doctl serverless functions config set MONGODB_URI "your-mongodb-connection-string"
```

---

## Step 2: Update Supabase Edge Function

1. **Go to Supabase Dashboard:**
   - Visit: https://app.supabase.com
   - Select your project
   - Go to **Edge Functions**

2. **Update or Create Function:**
   - If you have existing `index` function, click **Edit**
   - Otherwise, click **New function** → name it `index`
   - Copy contents from `supabase-edge-function/index.ts`
   - Paste into the editor

3. **Add Environment Variables:**
   - Click **Settings** for the function
   - Add these variables:
     ```
     OPENAI_API_KEY=sk-your-key-here
     MONGODB_FUNCTION_URL=https://your-do-function-url
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
     ```

4. **Deploy:**
   - Click **Deploy**
   - Test the function with a sample request

---

## Step 3: Test Everything

### Test MongoDB Function:
```bash
curl -X POST https://your-do-function-url \
  -H "Content-Type: application/json" \
  -d '{"action": "institutional", "symbol": "AAPL"}'
```

Expected response:
```json
{
  "success": true,
  "data": [...],
  "source": "mongodb",
  "type": "institutional"
}
```

### Test Supabase Edge Function:
```bash
curl -X POST https://your-project.supabase.co/functions/v1/index \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"message": "What is the institutional ownership for AAPL?"}'
```

Expected response:
```json
{
  "response": "Based on the latest institutional ownership data...",
  "functionCalls": 1,
  "timestamp": "2025-11-20T..."
}
```

---

## Step 4: Update Your Mobile App

Your app already calls Supabase Edge Functions, so **no changes needed**! 

The existing code:
```typescript
const { data } = await supabase.functions.invoke('index', {
  body: { message, conversationHistory, selectedTickers }
})
```

Will now automatically access MongoDB data through the free DigitalOcean Function proxy!

---

## Cost Breakdown

| Service | Usage Limit | Cost |
|---------|------------|------|
| DigitalOcean Functions | 90,000 requests/month | **$0** |
| Supabase Edge Functions | 500,000 requests/month | **$0** |
| Supabase Database | 500 MB storage | **$0** |
| MongoDB Database | Existing cluster | No change |
| OpenAI API | Pay per token | Variable |

**Total Infrastructure: $0/month** 🎉

---

## Troubleshooting

**MongoDB Function returns error:**
- Check MongoDB URI is correct in DO Functions settings
- Verify MongoDB allows connections from DigitalOcean IPs
- Check function logs in DO dashboard

**Supabase Function times out:**
- Verify MONGODB_FUNCTION_URL is set correctly
- Test MongoDB function independently first
- Check Supabase function logs

**AI responses don't include institutional data:**
- Verify MongoDB function is deployed and accessible
- Test with a direct curl request to MongoDB function
- Check OpenAI API key is valid

---

## Next Steps

1. Deploy MongoDB proxy function ✅
2. Update Supabase edge function ✅
3. Test both functions ✅
4. Verify mobile app works ✅
5. Monitor usage in DO and Supabase dashboards

**You're all set with a completely free infrastructure!** 🚀
