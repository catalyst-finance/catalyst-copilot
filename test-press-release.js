/**
 * Test Script for Press Release Queries
 * Tests the press release analysis and article card generation
 */

const https = require('https');

function testPressReleaseQuery(message) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Query: "${message}"`);
  console.log('='.repeat(80));
  
  const data = JSON.stringify({
    message: message,
    timezone: 'America/New_York'
  });
  
  const options = {
    hostname: 'catalyst-copilot-2nndy.ondigitalocean.app',
    path: '/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  
  const req = https.request(options, (res) => {
    console.log(`\nStatus Code: ${res.statusCode}\n`);
    
    let buffer = '';
    
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.substring(6));
            
            switch(json.type) {
              case 'thinking':
                console.log(`💭 [${json.phase}] ${json.content}`);
                break;
              case 'content':
                process.stdout.write(json.content);
                break;
              case 'data_card':
                console.log(`\n\n📊 DATA CARD:`);
                console.log(JSON.stringify(json.data, null, 2));
                console.log('');
                break;
              case 'token_usage':
                console.log(`\n\n📈 Token Usage: ${json.total} (Tier: ${json.tier})`);
                break;
              case 'done':
                console.log(`\n\n✅ Done!`);
                if (json.conversationId) console.log(`   Conversation ID: ${json.conversationId}`);
                if (json.messageId) console.log(`   Message ID: ${json.messageId}`);
                if (json.data_cards && json.data_cards.length > 0) {
                  console.log(`\n📊 RECEIVED ${json.data_cards.length} DATA CARDS:`);
                  json.data_cards.forEach((card, i) => {
                    console.log(`\n   Card ${i + 1}:`);
                    console.log(`     Type: ${card.type}`);
                    console.log(`     ID: ${card.data.id}`);
                    console.log(`     Title: ${card.data.title}`);
                    if (card.data.imageUrl) console.log(`     Image: ${card.data.imageUrl}`);
                    console.log(`     URL: ${card.data.url}`);
                  });
                }
                break;
              case 'error':
                console.error(`\n❌ Error: ${json.error}`);
                break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    });
    
    res.on('end', () => {
      console.log('\n' + '='.repeat(80) + '\n');
    });
  });
  
  req.on('error', (error) => {
    console.error('Request Error:', error);
  });
  
  req.write(data);
  req.end();
}

// Test queries for press releases
const testQueries = [
  'When did Steve Jurvetson join TMC board?',
  'Tell me about TMC board changes',
  'What executive appointments has TSLA announced recently?'
];

// Run first test
testPressReleaseQuery(testQueries[0]);

// Run additional tests with delays
setTimeout(() => testPressReleaseQuery(testQueries[1]), 15000);
setTimeout(() => testPressReleaseQuery(testQueries[2]), 30000);
