# Deploy Catalyst AI Agent to DigitalOcean App Platform

## Quick Deploy (Recommended)

### 1. Push to GitHub
```bash
cd catalyst-ai-agent
git init
git add .
git commit -m "Initial commit: Catalyst AI Agent"
gh repo create catalyst-ai-agent --public --source=. --push
# Or manually create repo at github.com and push
```

### 2. Deploy via DigitalOcean Dashboard

1. Go to https://cloud.digitalocean.com/apps
2. Click **"Create App"**
3. Select **"GitHub"** as source
4. Choose your `catalyst-ai-agent` repository
5. Select the **main** branch
6. DigitalOcean will auto-detect Node.js and use these settings:
   - **Build Command:** `npm install`
   - **Run Command:** `node agent.js`
   - **HTTP Port:** 3000

7. Click **"Next"** through the configuration
8. On **Environment Variables** page, add:
   ```
   OPENAI_API_KEY=sk-...
   SUPABASE_URL=https://xyz.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   MONGODB_URI=mongodb://user:pass@your-cluster.mongo.ondigitalocean.com:27017/raw_data?authSource=admin
   ```
   ⚠️ Mark all as **ENCRYPTED** (secret)

9. Choose **Basic plan** ($5/month) or Pro if needed
10. Click **"Create Resources"**

### 3. Get Your API URL
After deployment (5-10 minutes):
- Your agent will be live at: `https://catalyst-ai-agent-xxxxx.ondigitalocean.app`
- Test it: `https://your-url.ondigitalocean.app/health`

---

## Alternative: Deploy from DigitalOcean CLI

```bash
# Install doctl
# Windows: Download from https://github.com/digitalocean/doctl/releases

# Authenticate
doctl auth init

# Create app from spec
cd catalyst-ai-agent
doctl apps create --spec .do/app.yaml

# Set environment variables
doctl apps update YOUR_APP_ID --spec .do/app.yaml
```

---

## MongoDB Connection String

Get from DigitalOcean Dashboard:
1. Go to **Databases** → Your MongoDB cluster
2. Click **"Connection Details"**
3. Copy connection string, replace `<password>` with actual password
4. Format: `mongodb://doadmin:PASSWORD@cluster-do-user-123456-0.xyz.db.ondigitalocean.com:27017/raw_data?authSource=admin&tls=true`

---

## Verify Deployment

```bash
# Health check
curl https://your-app.ondigitalocean.app/health

# Test chat endpoint
curl -X POST https://your-app.ondigitalocean.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is AAPL trading at?"}'
```

---

## Update Your Mobile App

Replace Supabase Edge Function call:

```typescript
// OLD (Supabase Edge Function)
const { data } = await supabase.functions.invoke('index', {
  body: { message, conversationHistory }
})

// NEW (App Platform)
const response = await fetch('https://catalyst-ai-agent-xxxxx.ondigitalocean.app/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    message, 
    conversationHistory, 
    selectedTickers 
  })
})
const data = await response.json()
```

---

## Benefits Over Edge Functions

✅ **Direct MongoDB access** - No proxy needed  
✅ **No cold starts** - Always warm  
✅ **Better performance** - Persistent connections  
✅ **More control** - Full Express server  
✅ **Better debugging** - App Platform logs  
✅ **Auto-scaling** - Handles traffic spikes  

---

## Troubleshooting

**Build fails:**
- Check `package.json` has all dependencies
- Verify Node.js version compatibility

**MongoDB connection fails:**
- Verify connection string format
- Check MongoDB IP whitelist (should allow App Platform IPs)
- DigitalOcean resources in same region connect automatically

**App crashes:**
- Check logs in App Platform dashboard
- Verify all environment variables are set
- Test `/health` endpoint first

---

## Cost Estimate

- **App Platform Basic**: $5/month (512MB RAM, 1 vCPU)
- **MongoDB Cluster**: Already running (existing cost)
- **Supabase**: Free tier or existing plan
- **OpenAI API**: Pay per token usage

**Total additional cost: $5/month**
