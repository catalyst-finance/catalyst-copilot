# Deploy FREE MongoDB Proxy to DigitalOcean Functions

## What This Does
- Provides MongoDB access for your Supabase Edge Function
- **100% FREE** (90,000 requests/month)
- Native DigitalOcean infrastructure (fast connection to MongoDB)

## Deployment Steps

### 1. Install DigitalOcean CLI (doctl)

**Windows:**
```powershell
# Download from: https://github.com/digitalocean/doctl/releases
# Or use chocolatey:
choco install doctl
```

### 2. Authenticate

```bash
doctl auth init
# Enter your DigitalOcean API token
# Get token from: https://cloud.digitalocean.com/account/api/tokens
```

### 3. Deploy the Function

```bash
cd "C:\Users\brand\Documents\Catalyst App External Functions\Catalyst Copilot"

# Create namespace (one-time)
doctl serverless namespaces create --label "catalyst-functions" --region nyc1

# Connect to namespace
doctl serverless connect

# Deploy function
doctl serverless deploy packages/mongodb-proxy
```

### 4. Set Environment Variable

```bash
# Set MongoDB connection string
doctl serverless functions config set MONGODB_URI "mongodb://doadmin:PASSWORD@your-cluster.mongo.ondigitalocean.com:27017/raw_data?authSource=admin&tls=true"
```

### 5. Get Function URL

```bash
doctl serverless functions get mongodb-proxy/index
# Copy the URL, it will look like:
# https://faas-nyc1-2ef2e6cc.doserverless.co/api/v1/web/fn-xxxxx/mongodb-proxy/index
```

### 6. Test Function

```bash
# Test institutional data
curl -X POST https://your-function-url \
  -H "Content-Type: application/json" \
  -d '{"action": "institutional", "symbol": "AAPL"}'

# Test macro data
curl -X POST https://your-function-url \
  -H "Content-Type: application/json" \
  -d '{"action": "macro", "category": "economic"}'
```

## Alternative: Deploy via Web UI

1. Go to https://cloud.digitalocean.com/functions
2. Click **"Create Function"**
3. Choose **"Upload Code"**
4. Upload the `packages/mongodb-proxy` folder
5. Set environment variables in the UI
6. Deploy!

## Update Supabase Edge Function

Once deployed, update your Supabase Edge Function to call this MongoDB proxy:

```typescript
// In your Supabase Edge Function
const MONGODB_FUNCTION_URL = 'https://your-function-url';

async function getInstitutionalData(symbol: string) {
  const response = await fetch(MONGODB_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'institutional', symbol })
  });
  return await response.json();
}

async function getMacroData(category: string) {
  const response = await fetch(MONGODB_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'macro', category })
  });
  return await response.json();
}
```

## Cost Breakdown

- **DigitalOcean Functions**: FREE (90k requests/month)
- **Supabase Edge Functions**: FREE (500k requests/month)
- **MongoDB Database**: Existing cost (no change)
- **OpenAI API**: Pay per token usage

**Total Infrastructure Cost: $0** 🎉

## Benefits

✅ **Free MongoDB access** from DigitalOcean Functions  
✅ **Free AI chat** in Supabase Edge Functions  
✅ **Fast performance** (both on same DO infrastructure)  
✅ **No cold starts** with connection pooling  
✅ **Scalable** to 90k+ requests/month  

---

Ready to deploy? Run the commands above or use the web UI!
