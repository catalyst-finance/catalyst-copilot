const https = require('https');

const query = "When did Steve Jurvetson join TMC board?";

console.log('================================================================================');
console.log(`Testing Query: "${query}"`);
console.log('================================================================================\n');

const postData = JSON.stringify({ 
  message: query,
  timezone: 'America/New_York'
});

const options = {
  hostname: 'catalyst-copilot-2nndy.ondigitalocean.app',
  port: 443,
  path: '/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}\n`);

  let buffer = '';
  const dataCards = [];

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6));
          
          if (data.type === 'thinking') {
            console.log(`💭 [${data.phase}] ${data.content}`);
          } else if (data.type === 'content') {
            process.stdout.write(data.content);
          } else if (data.type === 'data_card') {
            dataCards.push(data.card);
          } else if (data.type === 'done') {
            console.log('\n\n✅ Done!\n');
            if (data.data_cards && data.data_cards.length > 0) {
              console.log(`📊 RECEIVED ${data.data_cards.length} DATA CARDS:\n`);
              data.data_cards.forEach((card, idx) => {
                console.log(`   Card ${idx + 1}:`);
                console.log(`     Type: ${card.type}`);
                console.log(`     ID: ${card.data.id}`);
                console.log(`     Title: ${card.data.title}`);
                if (card.data.imageUrl) console.log(`     ImageURL: ${card.data.imageUrl}`);
                console.log(`     URL: ${card.data.url}\n`);
              });
            }
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    }
  });

  res.on('end', () => {
    console.log('================================================================================\n');
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

req.write(postData);
req.end();
