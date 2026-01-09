/**
 * SINGLE COMPLEX QUERY TEST
 * Quick test of one multi-source query
 */

const PROD_URL = 'https://catalyst-copilot-2nndy.ondigitalocean.app';

async function test() {
  const query = "What's driving TMC's stock price recently? Include news, analyst ratings, and company announcements";
  
  console.log('Testing query:', query);
  console.log('\nCalling API...\n');

  let responseText = '';
  let dataCards = [];
  let eventCount = {content: 0, thinking: 0, done: 0, other: 0};

  try {
    const response = await fetch(`${PROD_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        ticker: 'TMC',
        conversationId: null
      })
    });

    if (!response.ok) {
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
            
            if (data.type === 'content') {
              eventCount.content++;
              if (data.content) responseText += data.content;
            } else if (data.type === 'thinking') {
              eventCount.thinking++;
            } else if (data.type === 'done') {
              eventCount.done++;
              console.log('Done event received:', JSON.stringify(data, null, 2));
              if (data.data_cards) dataCards = data.data_cards;
            } else {
              eventCount.other++;
              console.log('Other event:', data.type, JSON.stringify(data).substring(0, 100));
            }
          } catch (e) {
            console.log('Parse error:', e.message, 'for line:', line.substring(0, 50));
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('RESPONSE TEXT:');
    console.log('='.repeat(80));
    console.log(responseText);
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS:');
    console.log('='.repeat(80));
    console.log(`Events: ${eventCount.content} content, ${eventCount.thinking} thinking, ${eventCount.done} done, ${eventCount.other} other`);
    console.log(`Word count: ${responseText.split(/\s+/).length}`);
    console.log(`Data cards: ${dataCards.length}`);
    
    if (dataCards.length > 0) {
      const types = {};
      dataCards.forEach(card => {
        types[card.type] = (types[card.type] || 0) + 1;
      });
      console.log(`Card types:`, types);
    }

    const inline = (responseText.match(/\[VIEW_ARTICLE:[^\]]+\]/g) || []).length;
    console.log(`Inline markers: ${inline}`);

  } catch (error) {
    console.log('ERROR:', error.message);
  }
}

test();
