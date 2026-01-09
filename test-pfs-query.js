/**
 * Test for PFS query - should find press release with "Pre-Feasibility Study" in content
 */

const https = require('https');

const query = "When did TMC release their PFS?";

console.log('================================================================================');
console.log(`Testing Query: "${query}"`);
console.log('Expected: Should find press release from Aug 4, 2025 with PFS/Pre-Feasibility Study');
console.log('================================================================================\n');

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

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}\n`);

  let buffer = '';
  let fullResponse = '';
  let thinkingPhases = [];

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6));
          
          if (data.type === 'thinking') {
            thinkingPhases.push(`[${data.phase}] ${data.content}`);
            console.log(`💭 ${data.content}`);
          } else if (data.type === 'content') {
            fullResponse += data.content;
            process.stdout.write(data.content);
          } else if (data.type === 'done') {
            console.log('\n\n✅ Done!\n');
            
            if (data.data_cards && data.data_cards.length > 0) {
              console.log(`📊 RECEIVED ${data.data_cards.length} DATA CARDS:\n`);
              data.data_cards.forEach((card, idx) => {
                console.log(`   Card ${idx + 1}:`);
                console.log(`     Type: ${card.type}`);
                console.log(`     ID: ${card.data.id}`);
                console.log(`     Title: ${card.data.title}`);
                console.log(`     URL: ${card.data.url}\n`);
              });
              
              // Check if we got the right press release
              const foundPFS = data.data_cards.some(card => 
                card.data.title && (
                  card.data.title.includes('Economic Studies') ||
                  card.data.title.includes('NPV') ||
                  card.data.title.includes('Mineral Reserves')
                )
              );
              
              if (foundPFS) {
                console.log('✅ SUCCESS: Found the PFS press release!');
              } else {
                console.log('⚠️  WARNING: Did not find expected PFS press release');
              }
            } else {
              console.log('❌ ERROR: No data cards received - query may have returned 0 results');
            }
            
            // Check response format
            const hasNumberedHeader = /^\d+\.\s\*\*[^*]+\*\*/m.test(fullResponse);
            const hasAnalysis = fullResponse.split(/\s+/).length > 30;
            const hasDate = fullResponse.includes('2025') || fullResponse.includes('August');
            
            console.log('\n📋 RESPONSE ANALYSIS:');
            console.log(`   Numbered Header: ${hasNumberedHeader ? '✅' : '❌'}`);
            console.log(`   Has Analysis: ${hasAnalysis ? '✅' : '❌'}`);
            console.log(`   Contains Date: ${hasDate ? '✅' : '❌'}`);
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    }
  });

  res.on('end', () => {
    console.log('\n================================================================================\n');
  });
});

req.on('error', (e) => {
  console.error(`❌ ERROR: ${e.message}`);
});

req.write(postData);
req.end();
