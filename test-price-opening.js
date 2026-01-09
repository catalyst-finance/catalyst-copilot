/**
 * Test Price Movement Opening Format
 * Validates that "what's driving price" queries start with price analysis
 */

const https = require('https');

async function testPriceOpening() {
  return new Promise((resolve, reject) => {
    console.log('\n📝 Testing Price Movement Opening Format');
    console.log('Query: "What\'s driving TMC\'s stock price over the past month? Include news, analyst ratings, and company announcements"\n');

    const postData = JSON.stringify({ 
      message: "What's driving TMC's stock price over the past month? Include news, analyst ratings, and company announcements",
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

    let fullResponse = '';

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
              
              if (data.type === 'content') {
                fullResponse += data.content;
              }
            } catch (e) {
              // Skip non-JSON
            }
          }
        }
      });

      res.on('end', () => {
        console.log('━'.repeat(100));
        console.log('FULL RESPONSE:');
        console.log('━'.repeat(100));
        console.log(fullResponse);
        console.log('━'.repeat(100));
        
        // Check for required elements
        const hasChartMarker = fullResponse.includes('[VIEW_CHART:');
        const chartPosition = fullResponse.indexOf('[VIEW_CHART:');
        const firstNumberedSection = fullResponse.match(/\d+\.\s\*\*/);
        const firstNumberedPosition = firstNumberedSection ? fullResponse.indexOf(firstNumberedSection[0]) : -1;
        
        // Extract first 500 characters
        const opening = fullResponse.substring(0, 500);
        
        console.log('\n📊 FORMAT VALIDATION:');
        console.log(`   ✓ Chart marker found: ${hasChartMarker ? '✅' : '❌'}`);
        console.log(`   ✓ Chart position: ${chartPosition} (should be near 0)`);
        console.log(`   ✓ First numbered section position: ${firstNumberedPosition}`);
        
        // Check if there's content between chart and first numbered section
        if (hasChartMarker && firstNumberedPosition > 0) {
          const betweenText = fullResponse.substring(chartPosition + 20, firstNumberedPosition).trim();
          const hasPriceAnalysis = betweenText.length > 20; // Should have some analysis text
          const hasTransition = /price.*(?:driven|influenced|affected|impacted)/i.test(betweenText) || 
                               /following.*(?:news|events|factors)/i.test(betweenText);
          
          console.log(`   ✓ Text between chart and sections: ${betweenText.length} chars ${hasPriceAnalysis ? '✅' : '⚠️'}`);
          console.log(`   ✓ Has transition statement: ${hasTransition ? '✅' : '⚠️'}`);
          
          console.log('\n📄 OPENING TEXT (first ~500 chars):');
          console.log('━'.repeat(100));
          console.log(opening);
          console.log('━'.repeat(100));
          
          if (hasPriceAnalysis && hasTransition) {
            console.log('\n✅ SUCCESS: Response starts with price movement analysis and transition!');
          } else if (hasPriceAnalysis) {
            console.log('\n⚠️  PARTIAL: Has price analysis but missing clear transition statement');
          } else {
            console.log('\n❌ ISSUE: Missing price movement analysis before numbered sections');
          }
        } else {
          console.log('\n❌ FORMAT ISSUE: Chart marker or numbered sections not found in expected positions');
        }
        
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error(`❌ ERROR: ${e.message}`);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

testPriceOpening().catch(console.error);
