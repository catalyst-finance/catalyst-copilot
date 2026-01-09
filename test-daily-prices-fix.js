/**
 * Test the daily_prices table fix
 * Validates that queries requesting historical price data use correct "date" field
 */

const https = require('https');

const query = "What's driving TMC's stock price over the past month? Include news, analyst ratings, and company announcements";

console.log('🧪 Testing daily_prices table fix');
console.log(`Query: "${query}"\n`);

const postData = JSON.stringify({ 
  message: query,
  timezone: 'America/New_York'
});

const options = {
  hostname: 'catalyst-copilot-2nndy.ondigitalocean.app',
  path: '/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

let startTime = Date.now();
let fullResponse = '';
let dataCards = [];
let queryPlan = null;
let errors = [];

const req = https.request(options, (res) => {
  let buffer = '';

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6));
          
          if (data.type === 'thinking') {
            if (data.phase === 'query_plan' && data.content) {
              console.log(`📋 Query Plan: ${data.content.substring(0, 100)}...`);
            }
          } else if (data.type === 'content') {
            process.stdout.write(data.content);
            fullResponse += data.content;
          } else if (data.type === 'done' && data.data_cards) {
            dataCards = data.data_cards;
          }
        } catch (e) {
          // Skip non-JSON
        }
      }
    }
  });

  res.on('end', () => {
    const totalTime = Date.now() - startTime;
    
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(80));
    
    // Check if response includes error about timestamp field
    const hasTimestampError = fullResponse.toLowerCase().includes('timestamp') && 
                             fullResponse.toLowerCase().includes('does not exist');
    
    // Check if response has substantive content
    const wordCount = fullResponse.split(/\s+/).length;
    const hasChartMarker = fullResponse.includes('[VIEW_CHART:TMC:1M]');
    const hasArticleMarkers = (fullResponse.match(/\[VIEW_ARTICLE:/g) || []).length;
    
    console.log(`\n✅ Response received (${totalTime}ms)`);
    console.log(`   • Word count: ${wordCount}`);
    console.log(`   • Chart marker: ${hasChartMarker ? '✅' : '❌'}`);
    console.log(`   • Article markers: ${hasArticleMarkers}`);
    console.log(`   • Data cards: ${dataCards.length}`);
    
    if (hasTimestampError) {
      console.log('\n❌ FAIL: Response contains "timestamp does not exist" error');
      console.log('   The daily_prices query is still using wrong field name');
    } else if (wordCount < 50) {
      console.log('\n⚠️  WARNING: Response is very short, may indicate error');
    } else if (wordCount >= 150 && hasArticleMarkers >= 3) {
      console.log('\n✅ SUCCESS: Comprehensive response with multiple sources');
      console.log('   The daily_prices table fix appears to be working!');
    } else {
      console.log('\n⚠️  PARTIAL: Response received but comprehensiveness unclear');
    }
    
    console.log('\n' + '='.repeat(80));
  });
});

req.on('error', (e) => {
  console.error(`\n❌ ERROR: ${e.message}`);
  process.exit(1);
});

req.write(postData);
req.end();
