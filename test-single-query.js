/**
 * Single Query Test
 * Tests one query from the complex test suite
 */

const https = require('https');

const testCase = {
  query: "What's driving TMC's stock price over the past month? Include news, analyst ratings, and company announcements",
  expectedSources: ['news', 'press_releases', 'price_targets'],
  expectMultipleInlineMarkers: true,
  description: "Multi-source correlation analysis"
};

console.log('\n' + '━'.repeat(120));
console.log(`📝 TEST: ${testCase.description}`);
console.log(`Query: "${testCase.query}"`);
console.log(`Expected sources: ${testCase.expectedSources.join(', ')}`);
console.log('━'.repeat(120));

const postData = JSON.stringify({ 
  message: testCase.query,
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
    const missingExpectedSources = testCase.expectedSources.filter(source => {
      return !Array.from(sourceTypes).some(type => 
        type.includes(source) || source.includes(type)
      );
    });
    
    if (missingExpectedSources.length > 0) {
      console.log(`\n   ⚠️  Missing Expected Sources: ${missingExpectedSources.join(', ')}`);
    }
    
    console.log('\n' + '━'.repeat(120));
  });
});

req.on('error', (e) => {
  console.error(`❌ ERROR: ${e.message}`);
  process.exit(1);
});

req.write(postData);
req.end();
