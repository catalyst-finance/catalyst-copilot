/**
 * Extended Test Suite for Press Release Analysis & Formatting
 * Tests various query patterns to ensure consistent formatting
 */

const https = require('https');

const testQueries = [
  // Specific factual queries
  { query: "What is TMC's NORI-D project?", expectFormat: true },
  { query: "Tell me about TMC's strategic partnership with Korea Zinc", expectFormat: true },
  { query: "What reserves did TMC declare?", expectFormat: true },
  
  // Broader analysis queries
  { query: "What major announcements has TMC made in 2025?", expectFormat: true },
  { query: "Summarize TMC's recent corporate updates", expectFormat: true },
  
  // Technical/financial queries
  { query: "What is the NPV of TMC's projects?", expectFormat: true },
  { query: "What are TMC's mineral reserves?", expectFormat: true },
  
  // Who/when queries
  { query: "When did TMC announce their economic studies?", expectFormat: true },
  { query: "Who invested in TMC recently?", expectFormat: true },
  
  // Multiple company queries
  { query: "Compare recent press releases from TSLA and TMC", expectFormat: true }
];

async function testQuery(testCase, index, total) {
  return new Promise((resolve, reject) => {
    const { query, expectFormat } = testCase;
    
    console.log('\n' + '━'.repeat(100));
    console.log(`📝 TEST ${index + 1}/${total}: "${query}"`);
    console.log('━'.repeat(100));

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
    let dataCardCount = 0;
    let thinkingTime = 0;
    let firstContentTime = 0;

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
                if (thinkingTime === 0) thinkingTime = Date.now() - startTime;
              } else if (data.type === 'content') {
                if (firstContentTime === 0) firstContentTime = Date.now() - startTime;
                fullResponse += data.content;
              } else if (data.type === 'done') {
                if (data.data_cards) dataCardCount = data.data_cards.length;
              }
            } catch (e) {
              // Skip non-JSON
            }
          }
        }
      });

      res.on('end', () => {
        const totalTime = Date.now() - startTime;
        
        // Analyze response
        const hasNumberedHeader = /^\d+\.\s\*\*[^*]+\*\*/m.test(fullResponse);
        const hasViewArticle = /\[VIEW_ARTICLE:press-[^\]]+\]/.test(fullResponse);
        const wordCount = fullResponse.split(/\s+/).length;
        const hasAnalysis = wordCount > 30;
        const hasRelatedCoverage = /\*\*Related Coverage:\*\*/.test(fullResponse);
        const isEmptyResponse = fullResponse.includes("I don't have that information");
        
        // Scoring
        let score = 0;
        let maxScore = 3;
        if (hasNumberedHeader) score++;
        if (hasViewArticle) score++;
        if (hasAnalysis) score++;
        
        const status = score === maxScore ? '✅ PERFECT' : 
                      score === 2 ? '⚠️  PARTIAL' : 
                      isEmptyResponse ? '⚡ NO DATA' :
                      '❌ FAILED';
        
        // Extract header if present
        let headerText = 'N/A';
        if (hasNumberedHeader) {
          const match = fullResponse.match(/^\d+\.\s\*\*([^*]+)\*\*/m);
          if (match) headerText = match[1];
        }
        
        console.log(`\n📊 RESULTS:`);
        console.log(`   Status: ${status} (${score}/${maxScore})`);
        console.log(`   Format:`);
        console.log(`     • Numbered Header: ${hasNumberedHeader ? '✅' : '❌'} ${hasNumberedHeader ? `"${headerText}"` : ''}`);
        console.log(`     • Analysis Present: ${hasAnalysis ? '✅' : '❌'} (${wordCount} words)`);
        console.log(`     • Article Markers: ${hasViewArticle ? '✅' : '❌'}`);
        console.log(`   Data:`);
        console.log(`     • Cards Received: ${dataCardCount}`);
        console.log(`     • Has Related Coverage: ${hasRelatedCoverage ? 'Yes' : 'No'}`);
        console.log(`   Performance:`);
        console.log(`     • Time to first thinking: ${thinkingTime}ms`);
        console.log(`     • Time to first content: ${firstContentTime}ms`);
        console.log(`     • Total response time: ${totalTime}ms`);
        
        if (!hasNumberedHeader && !isEmptyResponse && fullResponse.length > 20) {
          console.log(`\n⚠️  MISSING FORMAT - Response preview:`);
          console.log(`   "${fullResponse.substring(0, 150)}..."`);
        }
        
        if (isEmptyResponse) {
          console.log(`\n💡 No relevant data found in database`);
        }
        
        resolve({
          query,
          status,
          score,
          maxScore,
          hasNumberedHeader,
          hasAnalysis,
          hasViewArticle,
          dataCardCount,
          wordCount,
          totalTime,
          isEmptyResponse,
          headerText
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

async function runTestSuite() {
  console.log('\n' + '█'.repeat(100));
  console.log('🧪 COMPREHENSIVE PRESS RELEASE FORMATTING TEST SUITE');
  console.log(`Testing ${testQueries.length} different query patterns`);
  console.log('█'.repeat(100));
  
  const results = [];
  
  for (let i = 0; i < testQueries.length; i++) {
    try {
      const result = await testQuery(testQueries[i], i, testQueries.length);
      results.push(result);
      
      // Wait between tests
      if (i < testQueries.length - 1) {
        console.log(`\n⏳ Waiting 3 seconds before next test...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(`Test ${i + 1} failed:`, error.message);
      results.push({
        query: testQueries[i].query,
        status: '❌ ERROR',
        score: 0,
        error: error.message
      });
    }
  }
  
  // Generate report
  console.log('\n\n' + '█'.repeat(100));
  console.log('📊 FINAL TEST REPORT');
  console.log('█'.repeat(100) + '\n');
  
  const perfect = results.filter(r => r.score === r.maxScore).length;
  const partial = results.filter(r => r.score === 2).length;
  const failed = results.filter(r => r.score <= 1 && !r.isEmptyResponse).length;
  const noData = results.filter(r => r.isEmptyResponse).length;
  const errored = results.filter(r => r.error).length;
  
  console.log(`📈 SUMMARY STATISTICS:`);
  console.log(`   Total Tests: ${results.length}`);
  console.log(`   ✅ Perfect Format (3/3): ${perfect} (${Math.round(perfect/results.length*100)}%)`);
  console.log(`   ⚠️  Partial Format (2/3): ${partial} (${Math.round(partial/results.length*100)}%)`);
  console.log(`   ❌ Failed Format (0-1/3): ${failed} (${Math.round(failed/results.length*100)}%)`);
  console.log(`   ⚡ No Data Found: ${noData} (${Math.round(noData/results.length*100)}%)`);
  console.log(`   💥 Errors: ${errored}`);
  
  const withDataResults = results.filter(r => !r.isEmptyResponse && !r.error);
  const formatCompliance = withDataResults.filter(r => r.score === r.maxScore).length;
  console.log(`\n🎯 FORMAT COMPLIANCE (excluding no-data responses):`);
  console.log(`   ${formatCompliance}/${withDataResults.length} (${Math.round(formatCompliance/withDataResults.length*100)}%)`);
  
  // Average metrics
  const avgTime = Math.round(results.reduce((sum, r) => sum + (r.totalTime || 0), 0) / results.length);
  const avgCards = Math.round(results.reduce((sum, r) => sum + (r.dataCardCount || 0), 0) / results.length);
  const avgWords = Math.round(results.reduce((sum, r) => sum + (r.wordCount || 0), 0) / results.length);
  
  console.log(`\n⚡ PERFORMANCE AVERAGES:`);
  console.log(`   Avg Response Time: ${avgTime}ms`);
  console.log(`   Avg Data Cards: ${avgCards}`);
  console.log(`   Avg Word Count: ${avgWords}`);
  
  console.log(`\n📋 DETAILED RESULTS:\n`);
  results.forEach((r, idx) => {
    const statusEmoji = r.score === r.maxScore ? '✅' : 
                       r.score === 2 ? '⚠️' : 
                       r.isEmptyResponse ? '⚡' :
                       r.error ? '💥' : '❌';
    console.log(`${idx + 1}. ${statusEmoji} [${r.score || 0}/${r.maxScore || 3}] "${r.query}"`);
    if (r.headerText && r.headerText !== 'N/A') {
      console.log(`   Header: "${r.headerText}"`);
    }
    if (r.dataCardCount > 0) {
      console.log(`   ${r.dataCardCount} cards • ${r.wordCount} words • ${r.totalTime}ms`);
    }
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
  });
  
  // Recommendations
  console.log(`\n\n💡 RECOMMENDATIONS:\n`);
  
  if (formatCompliance >= withDataResults.length * 0.9) {
    console.log(`   ✅ Excellent format compliance (${Math.round(formatCompliance/withDataResults.length*100)}%)! System is working well.`);
  } else if (formatCompliance >= withDataResults.length * 0.75) {
    console.log(`   ⚠️  Good format compliance (${Math.round(formatCompliance/withDataResults.length*100)}%), but some inconsistency.`);
    console.log(`   → Consider adding more explicit formatting examples to UNIVERSAL_FORMATTING_RULES`);
  } else {
    console.log(`   ❌ Format compliance needs improvement (${Math.round(formatCompliance/withDataResults.length*100)}%)`);
    console.log(`   → Review QueryEngine prompt and ContextEngine formatting instructions`);
    console.log(`   → Consider implementing response validation with retries`);
  }
  
  if (noData > results.length * 0.3) {
    console.log(`   ⚡ High "no data" rate (${Math.round(noData/results.length*100)}%)`);
    console.log(`   → Indicates database coverage gaps or query generation issues`);
    console.log(`   → Review MongoDB press_releases collection for completeness`);
  }
  
  if (avgTime > 5000) {
    console.log(`   🐌 Average response time is slow (${avgTime}ms)`);
    console.log(`   → Consider reducing context size or using faster model for queries`);
  }
  
  console.log('\n' + '█'.repeat(100));
  console.log('🏁 TEST SUITE COMPLETE');
  console.log('█'.repeat(100) + '\n');
}

runTestSuite().catch(console.error);
