/**
 * SHORT COMPLEX MULTI-SOURCE TEST
 * Tests 2 complex queries quickly to validate comprehensive analysis
 */

const PROD_URL = 'https://catalyst-copilot-2nndy.ondigitalocean.app';

const testQueries = [
  {
    query: "What's driving TMC's stock price recently? Include news, analyst ratings, and company announcements",
    expectedSources: ['news', 'press_releases', 'price_targets'],
    description: 'Multi-source correlation analysis'
  },
  {
    query: "Latest developments for TMC based on press releases, SEC filings, and news coverage",
    expectedSources: ['press_releases', 'sec_filings', 'news'],
    description: 'Corporate developments synthesis'
  }
];

async function testQuery(queryObj, index) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST ${index + 1}/${testQueries.length}: ${queryObj.description}`);
  console.log(`Query: "${queryObj.query}"`);
  console.log(`Expected sources: ${queryObj.expectedSources.join(', ')}`);
  console.log('='.repeat(80));

  const startTime = Date.now();
  let responseText = '';
  let dataCards = [];

  try {
    const response = await fetch(`${PROD_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: queryObj.query,
        ticker: 'TMC',
        conversationId: null
      })
    });

    if (!response.ok) {
      console.log(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log(`Error body: ${errorText.substring(0, 200)}`);
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'content' && data.content) {
              responseText += data.content;
            }
            
            if (data.type === 'done') {
              console.log(`\nDONE EVENT: ${JSON.stringify(data).substring(0, 200)}`);
              if (data.data_cards) {
                dataCards = data.data_cards;
              }
            }
          } catch (e) {}
        }
      }
    }

    const responseTime = Date.now() - startTime;

    // Debug: Show actual response
    console.log(`\nACTUAL RESPONSE:`);
    console.log(responseText.substring(0, 500));
    console.log(responseText.length > 500 ? '...(truncated)' : '');

    // Analysis
    const wordCount = responseText.split(/\s+/).length;
    const inlineMarkers = (responseText.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []).length;
    const relatedCoverageMatch = responseText.match(/Related Coverage:(.*?)(?=\n\n|$)/s);
    const relatedMarkers = relatedCoverageMatch 
      ? (relatedCoverageMatch[1].match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []).length 
      : 0;
    const numberedSections = (responseText.match(/^\d+\.\s+\*\*/gm) || []).length;
    
    // Check source types
    const sourceTypes = new Set();
    dataCards.forEach(card => {
      if (card.type) sourceTypes.add(card.type);
    });

    // Comprehensiveness score
    let score = 0;
    if (wordCount >= 150) score++;
    if (numberedSections >= 2) score++;
    if (inlineMarkers >= 2) score++;
    if (sourceTypes.size >= 2) score++;
    if (/\b(indicates|suggests|reveals|demonstrates|shows that|according to)\b/i.test(responseText)) score++;
    if (/\b(compared to|versus|while|however|in contrast)\b/i.test(responseText)) score++;
    if (/\$\d+|\d+%/.test(responseText)) score++;
    if (dataCards.length >= 5) score++;

    // Results
    console.log(`\nRESULTS:`);
    console.log(`Response time: ${responseTime}ms`);
    console.log(`Word count: ${wordCount}`);
    console.log(`Numbered sections: ${numberedSections}`);
    console.log(`Inline markers: ${inlineMarkers}`);
    console.log(`Related Coverage markers: ${relatedMarkers}`);
    console.log(`Data cards: ${dataCards.length}`);
    console.log(`Source types: ${Array.from(sourceTypes).join(', ')}`);
    console.log(`Comprehensiveness score: ${score}/8`);

    // Check missing sources
    const missingSources = queryObj.expectedSources.filter(s => !sourceTypes.has(s));
    if (missingSources.length > 0) {
      console.log(`⚠️  MISSING SOURCES: ${missingSources.join(', ')}`);
    }

    // Inline vs Related Coverage
    if (inlineMarkers < 2) {
      console.log(`⚠️  Low inline markers - response may be too brief`);
    }
    if (relatedMarkers > inlineMarkers * 2) {
      console.log(`⚠️  Too many Related Coverage vs inline - analysis may be superficial`);
    }

    return { score, wordCount, inlineMarkers, sourceTypes: sourceTypes.size, success: true };

  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    return { score: 0, wordCount: 0, inlineMarkers: 0, sourceTypes: 0, success: false };
  }
}

async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('COMPLEX MULTI-SOURCE QUERY TEST (SHORT VERSION)');
  console.log('Testing comprehensive analysis with multiple data sources');
  console.log(`${testQueries.length} complex queries`);
  console.log('█'.repeat(80));

  const results = [];
  
  for (let i = 0; i < testQueries.length; i++) {
    const result = await testQuery(testQueries[i], i);
    results.push(result);
    
    if (i < testQueries.length - 1) {
      console.log('\nWaiting 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Summary
  console.log('\n' + '█'.repeat(80));
  console.log('SUMMARY');
  console.log('█'.repeat(80));

  const successful = results.filter(r => r.success).length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const avgWords = results.reduce((sum, r) => sum + r.wordCount, 0) / results.length;
  const avgInline = results.reduce((sum, r) => sum + r.inlineMarkers, 0) / results.length;
  const avgSources = results.reduce((sum, r) => sum + r.sourceTypes, 0) / results.length;

  console.log(`Tests completed: ${successful}/${testQueries.length}`);
  console.log(`Average comprehensiveness: ${avgScore.toFixed(1)}/8`);
  console.log(`Average word count: ${avgWords.toFixed(0)}`);
  console.log(`Average inline markers: ${avgInline.toFixed(1)}`);
  console.log(`Average source types: ${avgSources.toFixed(1)}`);

  const comprehensive = results.filter(r => r.score >= 6).length;
  console.log(`\nComprehensive responses (6+ score): ${comprehensive}/${results.length} (${(comprehensive/results.length*100).toFixed(0)}%)`);

  if (avgScore < 6) {
    console.log('\n⚠️  RECOMMENDATION: Responses lack comprehensiveness');
    console.log('Consider adding multi-source analysis examples to UNIVERSAL_FORMATTING_RULES');
  }
  if (avgInline < 2) {
    console.log('\n⚠️  RECOMMENDATION: Too few inline citations');
    console.log('Emphasize discussing 3-4 sources inline before Related Coverage section');
  }
  if (avgSources < 2) {
    console.log('\n⚠️  RECOMMENDATION: Not enough source diversity');
    console.log('QueryEngine may need multi-source query emphasis');
  }

  console.log('\n✅ Test complete!');
}

main();
