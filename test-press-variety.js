/**
 * Comprehensive Test Suite for Press Release Formatting
 * Tests various query types to ensure consistent 4-part structure
 */

const https = require('https');

// Test queries covering different patterns
const testQueries = [
  // Direct factual questions
  "When did Steve Jurvetson join TMC board?",
  
  // Broader topic queries
  "Tell me about TMC's recent board appointments",
  
  // Executive-focused queries
  "What leadership changes has TMC announced?",
  
  // Strategic questions
  "What partnerships has TMC announced recently?",
  
  // Multiple ticker query
  "What executive changes have TSLA and TMC announced?",
  
  // Recent/time-based query
  "What press releases has TMC issued in the last 6 months?"
];

function testQuery(query) {
  return new Promise((resolve, reject) => {
    console.log('\n' + '='.repeat(100));
    console.log(`🧪 TEST QUERY: "${query}"`);
    console.log('='.repeat(100) + '\n');

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
      let buffer = '';
      let fullResponse = '';
      let thinkingPhases = [];
      let dataCardCount = 0;

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
              } else if (data.type === 'content') {
                fullResponse += data.content;
              } else if (data.type === 'done' && data.data_cards) {
                dataCardCount = data.data_cards.length;
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
        }
      });

      res.on('end', () => {
        // Analyze response format
        const hasNumberedHeader = /^\d+\.\s\*\*[^*]+\*\*/m.test(fullResponse);
        const hasViewArticle = /\[VIEW_ARTICLE:press-[^\]]+\]/.test(fullResponse);
        const hasAnalysis = fullResponse.split(/\s+/).length > 30;
        const isPlainText = !hasNumberedHeader && fullResponse.length > 20;
        
        // Format validation
        const formatScore = [hasNumberedHeader, hasViewArticle, hasAnalysis].filter(Boolean).length;
        const formatStatus = formatScore === 3 ? '✅ PERFECT' : formatScore === 2 ? '⚠️  PARTIAL' : '❌ FAILED';
        
        console.log(`\n📊 ANALYSIS RESULTS:`);
        console.log(`   Status: ${formatStatus} (${formatScore}/3 criteria met)`);
        console.log(`   Numbered Header: ${hasNumberedHeader ? '✅' : '❌'}`);
        console.log(`   View Article Marker: ${hasViewArticle ? '✅' : '❌'}`);
        console.log(`   Has Analysis (30+ words): ${hasAnalysis ? '✅' : '❌'}`);
        console.log(`   Data Cards Received: ${dataCardCount}`);
        console.log(`   Thinking Phases: ${thinkingPhases.length}`);
        
        if (isPlainText && !hasNumberedHeader) {
          console.log(`\n⚠️  WARNING: Plain text response without proper format structure`);
        }
        
        console.log(`\n📝 RESPONSE PREVIEW (first 300 chars):`);
        console.log('-'.repeat(100));
        console.log(fullResponse.substring(0, 300) + (fullResponse.length > 300 ? '...' : ''));
        console.log('-'.repeat(100));
        
        if (hasNumberedHeader) {
          // Extract header
          const headerMatch = fullResponse.match(/^\d+\.\s\*\*([^*]+)\*\*/m);
          if (headerMatch) {
            console.log(`\n📌 EXTRACTED HEADER: "${headerMatch[1]}"`);
          }
        }
        
        console.log('\n' + '='.repeat(100));
        
        resolve({
          query,
          formatScore,
          hasNumberedHeader,
          hasViewArticle,
          hasAnalysis,
          dataCardCount,
          responseLength: fullResponse.length,
          thinkingPhases: thinkingPhases.length
        });
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

async function runTests() {
  console.log('\n' + '█'.repeat(100));
  console.log('🧪 PRESS RELEASE FORMATTING TEST SUITE');
  console.log('Testing various query types for consistent 4-part structure');
  console.log('█'.repeat(100));
  
  const results = [];
  
  for (let i = 0; i < testQueries.length; i++) {
    try {
      const result = await testQuery(testQueries[i]);
      results.push(result);
      
      // Wait 5 seconds between tests to avoid rate limiting
      if (i < testQueries.length - 1) {
        console.log(`\n⏳ Waiting 5 seconds before next test...\n`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) {
      console.error(`Test failed for query: ${testQueries[i]}`);
      results.push({
        query: testQueries[i],
        formatScore: 0,
        error: error.message
      });
    }
  }
  
  // Summary report
  console.log('\n\n' + '█'.repeat(100));
  console.log('📊 FINAL SUMMARY REPORT');
  console.log('█'.repeat(100) + '\n');
  
  const perfectCount = results.filter(r => r.formatScore === 3).length;
  const partialCount = results.filter(r => r.formatScore === 2).length;
  const failedCount = results.filter(r => r.formatScore <= 1).length;
  
  console.log(`Total Tests: ${results.length}`);
  console.log(`✅ Perfect Format (3/3): ${perfectCount} (${Math.round(perfectCount/results.length*100)}%)`);
  console.log(`⚠️  Partial Format (2/3): ${partialCount} (${Math.round(partialCount/results.length*100)}%)`);
  console.log(`❌ Failed Format (0-1/3): ${failedCount} (${Math.round(failedCount/results.length*100)}%)`);
  console.log(`\n📈 Overall Compliance Rate: ${Math.round((perfectCount + partialCount)/results.length*100)}%`);
  
  console.log('\n📋 DETAILED RESULTS:\n');
  results.forEach((r, idx) => {
    const statusEmoji = r.formatScore === 3 ? '✅' : r.formatScore === 2 ? '⚠️' : '❌';
    console.log(`${idx + 1}. ${statusEmoji} "${r.query}"`);
    console.log(`   Score: ${r.formatScore}/3 | Cards: ${r.dataCardCount} | Response: ${r.responseLength} chars`);
  });
  
  console.log('\n' + '█'.repeat(100));
  console.log('🏁 TEST SUITE COMPLETE');
  console.log('█'.repeat(100) + '\n');
}

// Run the test suite
runTests().catch(console.error);
