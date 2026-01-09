/**
 * Complex Multi-Source Query Test Suite
 * Tests comprehensive analysis with multiple data sources and inline citations
 */

const https = require('https');

const complexQueries = [
  {
    query: "What's driving TMC's stock price over the past month? Include news, analyst ratings, and company announcements",
    expectedSources: ['news', 'press_releases', 'price_targets'],
    expectMultipleInlineMarkers: true,
    description: "Multi-source correlation analysis"
  },
  {
    query: "Analyze TSLA's recent performance including analyst upgrades, news sentiment, and price movements",
    expectedSources: ['price_targets', 'news', 'prices'],
    expectMultipleInlineMarkers: true,
    description: "Comprehensive stock analysis"
  },
  {
    query: "What are the latest developments for TMC based on their press releases, SEC filings, and news coverage?",
    expectedSources: ['press_releases', 'sec_filings', 'news'],
    expectMultipleInlineMarkers: true,
    description: "Corporate developments across sources"
  },
  {
    query: "Tell me about TMC's PFS announcement and how analysts and media covered it",
    expectedSources: ['press_releases', 'news', 'price_targets'],
    expectMultipleInlineMarkers: true,
    description: "Event analysis across sources"
  },
  {
    query: "Compare what analysts are saying about TSLA versus what the company announced in press releases",
    expectedSources: ['price_targets', 'press_releases'],
    expectMultipleInlineMarkers: true,
    description: "Analyst vs company messaging"
  },
  {
    query: "What did TMC's CEO discuss in earnings calls and how does it relate to their recent press releases?",
    expectedSources: ['earnings_transcripts', 'press_releases'],
    expectMultipleInlineMarkers: true,
    description: "Earnings vs press release analysis"
  },
  {
    query: "Has there been insider trading at TMC? Also show me their recent corporate announcements",
    expectedSources: ['news', 'press_releases'],
    expectMultipleInlineMarkers: true,
    description: "Insider activity + corporate news"
  },
  {
    query: "What's TMC's regulatory and permitting progress according to their updates and filings?",
    expectedSources: ['press_releases', 'sec_filings'],
    expectMultipleInlineMarkers: true,
    description: "Regulatory progress tracking"
  }
];

async function testComplexQuery(testCase, index, total) {
  return new Promise((resolve, reject) => {
    const { query, expectedSources, expectMultipleInlineMarkers, description } = testCase;
    
    console.log('\n' + '━'.repeat(120));
    console.log(`📝 TEST ${index + 1}/${total}: ${description}`);
    console.log(`Query: "${query}"`);
    console.log(`Expected sources: ${expectedSources.join(', ')}`);
    console.log('━'.repeat(120));

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
    let thinkingPhases = [];

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
                thinkingPhases.push(`[${data.phase}] ${data.content}`);
              } else if (data.type === 'content') {
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
        
        // Analyze response comprehensiveness
        const wordCount = fullResponse.split(/\s+/).length;
        const sentenceCount = (fullResponse.match(/[.!?]+/g) || []).length;
        const paragraphCount = (fullResponse.match(/\n\n/g) || []).length + 1;
        
        // Check for numbered sections (comprehensive structure)
        const numberedSections = (fullResponse.match(/^\d+\.\s\*\*[^*]+\*\*/gm) || []).length;
        
        // Count inline markers (not in Related Coverage)
        const allMarkers = (fullResponse.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
        const relatedCoverageMatch = fullResponse.match(/\*\*Related Coverage:\*\*([\s\S]*?)$/);
        let inlineMarkers = allMarkers;
        let relatedCoverageMarkers = [];
        
        if (relatedCoverageMatch) {
          const relatedSection = relatedCoverageMatch[1];
          relatedCoverageMarkers = (relatedSection.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
          const relatedSectionStart = fullResponse.indexOf('**Related Coverage:**');
          const beforeRelated = fullResponse.substring(0, relatedSectionStart);
          inlineMarkers = (beforeRelated.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []);
        }
        
        // Count unique source types from data cards
        const sourceTypes = new Set();
        dataCards.forEach(card => {
          if (card.data && card.data.id) {
            const idPrefix = card.data.id.split('-')[0]; // article, press, sec, etc.
            sourceTypes.add(idPrefix);
          }
        });
        
        // Analysis quality indicators
        const hasAnalyticalLanguage = /significance|impact|suggests|indicates|demonstrates|reveals|implies/i.test(fullResponse);
        const hasComparison = /compared to|versus|while|however|although|in contrast/i.test(fullResponse);
        const hasNumbers = /\$|%|\d+\.\d+/.test(fullResponse);
        const hasDateReferences = /\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(fullResponse);
        
        // Comprehensive scoring
        let comprehensiveScore = 0;
        let maxComprehensiveScore = 8;
        
        if (wordCount >= 150) comprehensiveScore++; // Sufficient depth
        if (numberedSections >= 2) comprehensiveScore++; // Multiple topics covered
        if (inlineMarkers.length >= 2) comprehensiveScore++; // Multiple inline citations
        if (sourceTypes.size >= 2) comprehensiveScore++; // Multiple source types
        if (hasAnalyticalLanguage) comprehensiveScore++; // Analytical depth
        if (hasComparison) comprehensiveScore++; // Comparative analysis
        if (hasNumbers) comprehensiveScore++; // Quantitative data
        if (dataCards.length >= 5) comprehensiveScore++; // Rich context
        
        const isComprehensive = comprehensiveScore >= 6;
        const status = isComprehensive ? '✅ COMPREHENSIVE' : 
                      comprehensiveScore >= 4 ? '⚠️  MODERATE' : 
                      fullResponse.includes("I don't have") ? '⚡ NO DATA' :
                      '❌ INSUFFICIENT';
        
        console.log(`\n📊 ANALYSIS RESULTS:`);
        console.log(`   Status: ${status} (${comprehensiveScore}/${maxComprehensiveScore})`);
        console.log(`\n   📝 Structure & Depth:`);
        console.log(`     • Word Count: ${wordCount} ${wordCount >= 150 ? '✅' : '⚠️'}`);
        console.log(`     • Numbered Sections: ${numberedSections} ${numberedSections >= 2 ? '✅' : '⚠️'}`);
        console.log(`     • Paragraphs: ${paragraphCount}`);
        console.log(`     • Sentences: ${sentenceCount}`);
        
        console.log(`\n   🔗 Source Integration:`);
        console.log(`     • Inline Markers: ${inlineMarkers.length} ${inlineMarkers.length >= 2 ? '✅' : '⚠️'}`);
        console.log(`     • Related Coverage Markers: ${relatedCoverageMarkers.length}`);
        console.log(`     • Total Markers: ${allMarkers.length}`);
        console.log(`     • Data Cards: ${dataCards.length} ${dataCards.length >= 5 ? '✅' : '⚠️'}`);
        console.log(`     • Source Types: ${sourceTypes.size} (${Array.from(sourceTypes).join(', ')}) ${sourceTypes.size >= 2 ? '✅' : '⚠️'}`);
        
        console.log(`\n   🧠 Analysis Quality:`);
        console.log(`     • Analytical Language: ${hasAnalyticalLanguage ? '✅' : '❌'}`);
        console.log(`     • Comparative Analysis: ${hasComparison ? '✅' : '❌'}`);
        console.log(`     • Quantitative Data: ${hasNumbers ? '✅' : '❌'}`);
        console.log(`     • Date References: ${hasDateReferences ? '✅' : '❌'}`);
        
        console.log(`\n   ⏱️  Performance:`);
        console.log(`     • Response Time: ${totalTime}ms`);
        console.log(`     • Thinking Phases: ${thinkingPhases.length}`);
        
        // Show inline markers in context
        if (inlineMarkers.length > 0) {
          console.log(`\n   📍 Inline Markers (${inlineMarkers.length}):`);
          inlineMarkers.forEach(marker => {
            const markerPos = fullResponse.indexOf(marker);
            const contextStart = Math.max(0, markerPos - 60);
            const contextEnd = Math.min(fullResponse.length, markerPos + marker.length + 60);
            const context = fullResponse.substring(contextStart, contextEnd).replace(/\n/g, ' ');
            console.log(`     → ${marker}`);
            console.log(`       Context: "...${context}..."`);
          });
        }
        
        // Show numbered sections
        if (numberedSections > 0) {
          console.log(`\n   📑 Numbered Sections (${numberedSections}):`);
          const sections = fullResponse.match(/^\d+\.\s\*\*([^*]+)\*\*/gm) || [];
          sections.forEach(section => {
            console.log(`     → ${section.trim()}`);
          });
        }
        
        // Check for missing expected sources
        const missingExpectedSources = expectedSources.filter(source => {
          return !Array.from(sourceTypes).some(type => 
            type.includes(source) || source.includes(type)
          );
        });
        
        if (missingExpectedSources.length > 0) {
          console.log(`\n   ⚠️  Missing Expected Sources: ${missingExpectedSources.join(', ')}`);
        }
        
        resolve({
          query,
          description,
          status,
          comprehensiveScore,
          maxComprehensiveScore,
          wordCount,
          numberedSections,
          inlineMarkers: inlineMarkers.length,
          relatedCoverageMarkers: relatedCoverageMarkers.length,
          dataCards: dataCards.length,
          sourceTypes: Array.from(sourceTypes),
          hasAnalyticalLanguage,
          hasComparison,
          totalTime,
          missingExpectedSources
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

async function runComplexTestSuite() {
  console.log('\n' + '█'.repeat(120));
  console.log('🧪 COMPLEX MULTI-SOURCE QUERY TEST SUITE');
  console.log('Testing comprehensive analysis with multiple data sources and inline citations');
  console.log(`${complexQueries.length} complex queries`);
  console.log('█'.repeat(120));
  
  const results = [];
  
  for (let i = 0; i < complexQueries.length; i++) {
    try {
      const result = await testComplexQuery(complexQueries[i], i, complexQueries.length);
      results.push(result);
      
      if (i < complexQueries.length - 1) {
        console.log(`\n⏳ Waiting 5 seconds before next test...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) {
      console.error(`Test ${i + 1} failed:`, error.message);
      results.push({
        query: complexQueries[i].query,
        description: complexQueries[i].description,
        status: '❌ ERROR',
        error: error.message
      });
    }
  }
  
  // Generate comprehensive report
  console.log('\n\n' + '█'.repeat(120));
  console.log('📊 COMPREHENSIVE TEST REPORT');
  console.log('█'.repeat(120) + '\n');
  
  const comprehensive = results.filter(r => r.comprehensiveScore >= 6).length;
  const moderate = results.filter(r => r.comprehensiveScore >= 4 && r.comprehensiveScore < 6).length;
  const insufficient = results.filter(r => r.comprehensiveScore < 4 && !r.status?.includes('NO DATA')).length;
  const noData = results.filter(r => r.status?.includes('NO DATA')).length;
  
  console.log(`📈 COMPREHENSIVENESS RATINGS:`);
  console.log(`   Total Tests: ${results.length}`);
  console.log(`   ✅ Comprehensive (6-8/8): ${comprehensive} (${Math.round(comprehensive/results.length*100)}%)`);
  console.log(`   ⚠️  Moderate (4-5/8): ${moderate} (${Math.round(moderate/results.length*100)}%)`);
  console.log(`   ❌ Insufficient (0-3/8): ${insufficient} (${Math.round(insufficient/results.length*100)}%)`);
  console.log(`   ⚡ No Data: ${noData}`);
  
  // Average metrics
  const validResults = results.filter(r => !r.error && !r.status?.includes('NO DATA'));
  if (validResults.length > 0) {
    const avgWords = Math.round(validResults.reduce((sum, r) => sum + r.wordCount, 0) / validResults.length);
    const avgSections = (validResults.reduce((sum, r) => sum + r.numberedSections, 0) / validResults.length).toFixed(1);
    const avgInlineMarkers = (validResults.reduce((sum, r) => sum + r.inlineMarkers, 0) / validResults.length).toFixed(1);
    const avgCards = Math.round(validResults.reduce((sum, r) => sum + r.dataCards, 0) / validResults.length);
    const avgTime = Math.round(validResults.reduce((sum, r) => sum + r.totalTime, 0) / validResults.length);
    const avgSourceTypes = (validResults.reduce((sum, r) => sum + r.sourceTypes.length, 0) / validResults.length).toFixed(1);
    
    console.log(`\n📊 AVERAGE METRICS (valid responses):`);
    console.log(`   • Words per response: ${avgWords}`);
    console.log(`   • Numbered sections: ${avgSections}`);
    console.log(`   • Inline markers: ${avgInlineMarkers}`);
    console.log(`   • Data cards: ${avgCards}`);
    console.log(`   • Source types: ${avgSourceTypes}`);
    console.log(`   • Response time: ${avgTime}ms`);
    
    const withAnalysis = validResults.filter(r => r.hasAnalyticalLanguage).length;
    const withComparison = validResults.filter(r => r.hasComparison).length;
    
    console.log(`\n🧠 ANALYSIS QUALITY:`);
    console.log(`   • Analytical language: ${withAnalysis}/${validResults.length} (${Math.round(withAnalysis/validResults.length*100)}%)`);
    console.log(`   • Comparative analysis: ${withComparison}/${validResults.length} (${Math.round(withComparison/validResults.length*100)}%)`);
  }
  
  console.log(`\n📋 DETAILED RESULTS:\n`);
  results.forEach((r, idx) => {
    const statusEmoji = r.comprehensiveScore >= 6 ? '✅' : 
                       r.comprehensiveScore >= 4 ? '⚠️' : 
                       r.status?.includes('NO DATA') ? '⚡' : '❌';
    console.log(`${idx + 1}. ${statusEmoji} [${r.comprehensiveScore || 0}/${r.maxComprehensiveScore || 8}] ${r.description}`);
    console.log(`   "${r.query}"`);
    if (r.wordCount) {
      console.log(`   ${r.wordCount}w • ${r.numberedSections}sec • ${r.inlineMarkers}inline • ${r.dataCards}cards • ${r.sourceTypes.length}types`);
      if (r.sourceTypes.length > 0) {
        console.log(`   Sources: ${r.sourceTypes.join(', ')}`);
      }
      if (r.missingExpectedSources && r.missingExpectedSources.length > 0) {
        console.log(`   Missing: ${r.missingExpectedSources.join(', ')}`);
      }
    }
  });
  
  console.log(`\n\n💡 RECOMMENDATIONS:\n`);
  
  if (comprehensive >= results.length * 0.75) {
    console.log(`   ✅ Excellent comprehensiveness (${Math.round(comprehensive/results.length*100)}%)!`);
  } else if (comprehensive >= results.length * 0.5) {
    console.log(`   ⚠️  Moderate comprehensiveness (${Math.round(comprehensive/results.length*100)}%)`);
    console.log(`   → Encourage GPT-4 to discuss multiple sources inline, not just Related Coverage`);
    console.log(`   → Add examples showing 3-4 inline article discussions before Related Coverage`);
  } else {
    console.log(`   ❌ Low comprehensiveness (${Math.round(comprehensive/results.length*100)}%)`);
    console.log(`   → Review prompt engineering to emphasize comprehensive multi-source analysis`);
    console.log(`   → Consider increasing response token budget for complex queries`);
  }
  
  if (validResults.length > 0) {
    const avgInline = validResults.reduce((sum, r) => sum + r.inlineMarkers, 0) / validResults.length;
    if (avgInline < 2) {
      console.log(`   ⚠️  Low inline marker usage (avg ${avgInline.toFixed(1)})`);
      console.log(`   → GPT-4 may be putting too many markers in Related Coverage`);
      console.log(`   → Emphasize discussing multiple sources inline before Related Coverage section`);
    }
  }
  
  console.log('\n' + '█'.repeat(120));
  console.log('🏁 COMPLEX TEST SUITE COMPLETE');
  console.log('█'.repeat(120) + '\n');
}

runComplexTestSuite().catch(console.error);
