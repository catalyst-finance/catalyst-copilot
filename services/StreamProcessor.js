/**
 * StreamProcessor.js
 * 
 * Processes the OpenAI stream and emits structured block events instead of raw text.
 * This handles marker parsing backend-side so the frontend receives clean, pre-processed events.
 * 
 * Also includes smart marker injection to ensure ALL markers from data context appear in response.
 */

const ResponseFormatter = require('./ResponseFormatter');

// Marker patterns for detecting special content in the stream
const MARKER_PATTERNS = {
  CHART: /\[VIEW_CHART:([A-Z]+):([^\]]+)\]/,
  ARTICLE: /\[VIEW_ARTICLE:([^\]]+)\]/,
  IMAGE: /\[IMAGE_CARD:([^\]]+)\]/,
  EVENT: /\[EVENT_CARD:([^\]]+)\]/,
};

// Global patterns for extracting all markers
const ALL_MARKER_PATTERNS = {
  CHART: /\[VIEW_CHART:([A-Z]+):([^\]]+)\]/g,
  ARTICLE: /\[VIEW_ARTICLE:([^\]]+)\]/g,
  IMAGE: /\[IMAGE_CARD:([^\]]+)\]/g,
  EVENT: /\[EVENT_CARD:([^\]]+)\]/g,
};

// All marker pattern for quick detection
const ANY_MARKER_REGEX = /\[(?:VIEW_CHART|VIEW_ARTICLE|IMAGE_CARD|EVENT_CARD):[^\]]+\]/;

/**
 * Check if text might contain a partial marker at the end
 */
function hasPartialMarker(text) {
  // Check for unclosed bracket at end
  if (/\[[^\]]*$/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Extract the first complete marker from text
 * Returns { marker, type, data, before, after } or null if no marker found
 */
function extractFirstMarker(text) {
  // Find the earliest marker
  let earliestMatch = null;
  let earliestIndex = Infinity;
  let markerType = null;

  for (const [type, pattern] of Object.entries(MARKER_PATTERNS)) {
    const match = text.match(pattern);
    if (match && match.index < earliestIndex) {
      earliestMatch = match;
      earliestIndex = match.index;
      markerType = type;
    }
  }

  if (!earliestMatch) return null;

  const before = text.substring(0, earliestIndex);
  const after = text.substring(earliestIndex + earliestMatch[0].length);

  // Extract data based on marker type
  let data;
  switch (markerType) {
    case 'CHART':
      data = { symbol: earliestMatch[1], timeRange: earliestMatch[2] };
      break;
    case 'ARTICLE':
    case 'IMAGE':
    case 'EVENT':
      data = { cardId: earliestMatch[1] };
      break;
  }

  return {
    marker: earliestMatch[0],
    type: markerType,
    data,
    before,
    after
  };
}

/**
 * StreamProcessor class
 * Buffers incoming stream content and emits structured events
 * Tracks expected markers from dataCards and injects missing ones
 */
class StreamProcessor {
  constructor(res, dataCards = []) {
    this.res = res;
    this.dataCards = dataCards;
    this.buffer = '';
    this.fullResponse = '';
    this.formatter = new ResponseFormatter();
    
    // Track expected markers from dataCards for smart injection
    this.expectedMarkers = this.buildExpectedMarkers(dataCards);
    this.foundMarkers = new Set();
    
    // Track if we're in the "Related Coverage" section (stacked articles, no HR needed)
    this.inRelatedCoverageSection = false;
  }

  /**
   * Build expected markers from dataCards
   */
  buildExpectedMarkers(dataCards) {
    console.log(`\n🎯 StreamProcessor: Building expected markers from ${dataCards.length} dataCards`);
    
    const markers = {
      articles: [],  // { cardId, ticker, title, publishedAt }
      images: [],
      events: [],
      charts: []     // { symbol, timeRange } - from price data
    };
    
    for (const card of dataCards) {
      // Article cards use 'id' field, not 'cardId'
      if (card.type === 'article' && card.data?.id) {
        // Get date from published_at (news) or date (press releases)
        const publishedAt = card.data.published_at || card.data.date || null;
        console.log(`  📰 Expected article marker: ${card.data.id} - "${card.data.title?.substring(0, 50)}..." (${publishedAt ? new Date(publishedAt).toLocaleDateString() : 'no date'})`);
        markers.articles.push({
          cardId: card.data.id,
          ticker: card.data.ticker,
          title: card.data.title || '',
          publishedAt: publishedAt ? new Date(publishedAt) : null
        });
      } else if (card.type === 'image' && card.data?.id) {
        console.log(`  🖼️  Expected image marker: ${card.data.id} - "${card.data.title?.substring(0, 50)}..."`);
        markers.images.push({
          cardId: card.data.id,
          ticker: card.data.ticker,
          title: card.data.title || ''
        });
      } else if (card.type === 'event' && card.data?.id) {
        markers.events.push({
          cardId: card.data.id.toString(),
          title: card.data.title || ''
        });
      } else if (card.type === 'filing' && card.data?.id) {
        console.log(`  📄 Expected filing reference: ${card.data.id}`);
      }
    }
    
    console.log(`📊 StreamProcessor tracking ${markers.articles.length} article markers, ${markers.images.length} image markers`);
    
    return markers;
  }

  /**
   * Validate that a marker has a corresponding dataCard
   */
  validateMarker(marker) {
    switch (marker.type) {
      case 'ARTICLE':
        return this.expectedMarkers.articles.some(a => a.cardId === marker.data.cardId);
      case 'IMAGE':
        return this.expectedMarkers.images.some(i => i.cardId === marker.data.cardId);
      case 'EVENT':
        return this.expectedMarkers.events.some(e => e.cardId === marker.data.cardId);
      case 'CHART':
        // Charts don't have expected markers from dataCards yet
        return true;
      default:
        return false;
    }
  }

  /**
   * Send a structured event to the client
   */
  emit(event) {
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /**
   * Send text content as a content event (backward compatible with existing frontend)
   * Note: Using 'content' instead of 'text_delta' for compatibility
   * Now applies mechanical formatting post-processing
   */
  emitText(text) {
    if (text) {
      // Check if we're entering the "Related Coverage" section
      // This marks where stacked articles begin (no HR needed between them)
      if (!this.inRelatedCoverageSection && /\*\*Related Coverage:?\*\*/.test(text)) {
        console.log(`   📌 Detected "Related Coverage" header - entering stacked article section`);
        this.inRelatedCoverageSection = true;
      }
      
      // Apply mechanical formatting (spacing, bullets, headers) before emitting
      const formattedText = this.formatter.processChunk(text);
      if (formattedText) {
        this.emit({ type: 'content', content: formattedText });
      }
    }
  }

  /**
   * Send a chart block event
   */
  emitChart(symbol, timeRange) {
    this.foundMarkers.add(`chart:${symbol}:${timeRange}`);
    this.emit({ type: 'chart_block', symbol, timeRange });
  }

  /**
   * Send an article block event with "Source:" label metadata
   */
  emitArticle(cardId) {
    this.foundMarkers.add(`article:${cardId}`);
    this.emit({ 
      type: 'article_block', 
      cardId,
      showSourceLabel: true  // Frontend should render "Source:" before the card
    });
  }

  /**
   * Send a horizontal rule (visual divider)
   */
  emitHorizontalRule() {
    this.emit({ type: 'horizontal_rule' });
  }

  /**
   * Send an image block event
   */
  emitImage(cardId) {
    this.foundMarkers.add(`image:${cardId}`);
    this.emit({ type: 'image_block', cardId });
  }

  /**
   * Send an event card block event
   */
  emitEvent(cardId) {
    this.foundMarkers.add(`event:${cardId}`);
    this.emit({ type: 'event_block', cardId });
  }

  /**
   * Process buffered content, extracting and emitting complete blocks
   * @param {boolean} flush - If true, emit all remaining content even if incomplete
   */
  processBuffer(flush = false) {
    while (this.buffer.length > 0) {
      // Check for complete marker
      const marker = extractFirstMarker(this.buffer);
      
      if (marker) {
        console.log(`\n🎯 MARKER FOUND: ${marker.marker}`);
        console.log(`   Type: ${marker.type}`);
        console.log(`   Data: ${JSON.stringify(marker.data)}`);
        console.log(`   Before length: ${marker.before.length} chars`);
        console.log(`   After length: ${marker.after.length} chars`);
        
        // Validate marker has corresponding dataCard
        const isValid = this.validateMarker(marker);
        if (!isValid) {
          console.warn(`⚠️  INVALID MARKER DETECTED: ${marker.marker}`);
          console.warn(`   No matching dataCard found - GPT generated a marker for non-existent data`);
          console.warn(`   Skipping emission and removing from buffer...`);
          // Emit the text before as normal content
          this.emitText(marker.before);
          // Skip the invalid marker entirely
          this.buffer = marker.after;
          continue;
        }
        
        // Emit any text before the marker
        this.emitText(marker.before);
        
        // Emit the marker as a structured block
        switch (marker.type) {
          case 'CHART':
            console.log(`   → Emitting CHART block: ${marker.data.symbol}:${marker.data.timeRange}`);
            this.emitChart(marker.data.symbol, marker.data.timeRange);
            break;
          case 'ARTICLE':
            // IMPORTANT: Emit article markers as TEXT content, not separate events
            // This ensures the frontend's extractStreamBlocks processes them in correct order
            // relative to surrounding text content (article cards appear after discussion text)
            console.log(`   → Keeping ARTICLE marker in text stream: ${marker.data.cardId}`);
            this.foundMarkers.add(`article:${marker.data.cardId}`);
            // Emit the marker as text so frontend handles positioning
            this.emitText(marker.marker);
            
            // Add horizontal rule ONLY for inline articles (not stacked in Related Coverage)
            // Use the styled horizontal_rule event, not text "---"
            if (!this.inRelatedCoverageSection) {
              console.log(`   → Adding HR after inline article`);
              this.emitHorizontalRule();
            } else {
              console.log(`   → Skipping HR (in Related Coverage section)`);
            }
            break;
          case 'IMAGE':
            this.emitImage(marker.data.cardId);
            break;
          case 'EVENT':
            this.emitEvent(marker.data.cardId);
            break;
        }
        
        // Continue processing remaining text
        this.buffer = marker.after;
        continue;
      }

      // No complete marker found
      // Check if there might be a partial marker at the end
      if (!flush && hasPartialMarker(this.buffer)) {
        // Only buffer the potential partial marker, emit everything before it
        const lastBracketIndex = this.buffer.lastIndexOf('[');
        if (lastBracketIndex > 0) {
          this.emitText(this.buffer.substring(0, lastBracketIndex));
          this.buffer = this.buffer.substring(lastBracketIndex);
        }
        // Don't emit partial marker, wait for more content
        break;
      }

      // No partial marker - emit in smaller chunks for smooth streaming
      // But not too aggressive to avoid excessive events
      if (!flush) {
        // Emit when we have at least 50 chars or a natural break point
        if (this.buffer.length > 50 || this.buffer.includes('\n')) {
          this.emitText(this.buffer);
          this.buffer = '';
        }
        break;
      } else {
        // Flush: emit everything
        this.emitText(this.buffer);
        this.buffer = '';
      }
    }
  }

  /**
   * Add incoming chunk to buffer and process
   */
  addChunk(content) {
    this.buffer += content;
    this.fullResponse += content;
    this.processBuffer(false);
  }

  /**
   * Finalize processing - flush any remaining content and inject missing markers
   */
  finalize() {
    this.processBuffer(true);
    
    // Flush any remaining buffered content in the formatter
    const remainingFormatted = this.formatter.flush();
    if (remainingFormatted) {
      this.emit({ type: 'content', content: remainingFormatted });
    }
    
    // Smart marker injection for missing markers
    this.injectMissingMarkers();
  }
  
  /**
   * Smart marker injection - inject missing VIEW_ARTICLE markers after related content
   * Uses contextual placement when possible, groups remaining at end
   */
  injectMissingMarkers() {
    const missingArticles = this.expectedMarkers.articles.filter(
      article => !this.foundMarkers.has(`article:${article.cardId}`)
    );
    
    if (missingArticles.length === 0) return;
    
    console.log(`🔧 Smart Marker Injection: ${missingArticles.length} missing article markers`);
    
    // Try to find contextual placement for each missing marker
    const response = this.fullResponse.toLowerCase();
    const articlesToInject = [];
    
    for (const article of missingArticles) {
      // Try to find if GPT discussed this article's topic
      const titleWords = (article.title || '').toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
      
      // Check if significant title words appear in response
      const matchedWords = titleWords.filter(word => response.includes(word));
      const matchScore = matchedWords.length / Math.max(titleWords.length, 1);
      
      if (matchScore > 0.3) {
        // Good match - this article was likely discussed
        console.log(`  ✓ "${article.title}" appears discussed (${Math.round(matchScore * 100)}% match)`);
      }
      
      articlesToInject.push({
        ...article,
        matchScore,
        discussed: matchScore > 0.3
      });
    }
    
    // Sort by publishedAt date (newest first) for Related Coverage section
    articlesToInject.sort((a, b) => {
      // If both have dates, sort newest first
      if (a.publishedAt && b.publishedAt) {
        return b.publishedAt.getTime() - a.publishedAt.getTime();
      }
      // Items with dates come before items without
      if (a.publishedAt && !b.publishedAt) return -1;
      if (!a.publishedAt && b.publishedAt) return 1;
      // Both without dates - preserve original order
      return 0;
    });
    
    console.log(`📅 Related Coverage sorted by date (newest first):`);
    articlesToInject.forEach((article, idx) => {
      const dateStr = article.publishedAt ? article.publishedAt.toLocaleDateString() : 'no date';
      console.log(`  [${idx}] ${dateStr}: "${article.title?.substring(0, 50)}..."`);
    });
    
    // Inject missing markers
    if (articlesToInject.length > 0) {
      console.log(`\n💉 SMART MARKER INJECTION: Injecting ${articlesToInject.length} missing article markers`);
      articlesToInject.forEach((article, idx) => {
        console.log(`  [${idx}] ${article.cardId}: "${article.title?.substring(0, 50)}..."`);
      });
      
      // Add styled separator before Related Coverage section
      console.log(`  → Emitting HORIZONTAL_RULE before Related Coverage`);
      this.emitHorizontalRule();
      
      // Add Related Coverage header as TEXT content
      const headerText = '\n\n**Related Coverage:**\n\n';
      console.log(`  → Emitting Related Coverage header`);
      this.fullResponse += headerText;
      this.emit({ type: 'content', content: headerText });
      
      // Inject markers as TEXT content (not events)
      // This ensures they render at the END of the response in proper order
      for (const article of articlesToInject) {
        // Inject as marker text that will be processed by frontend extractStreamBlocks
        const markerText = `[VIEW_ARTICLE:${article.cardId}]\n`;
        this.fullResponse += markerText;
        this.emit({ type: 'content', content: markerText });
        console.log(`  → Injected [VIEW_ARTICLE:${article.cardId}]: "${article.title?.substring(0, 40)}..."`);
        
        // Track that we injected this marker (add to foundMarkers so we don't duplicate)
        this.foundMarkers.add(article.cardId);
      }
      console.log(`✅ Smart injection complete\n`);
    }
  }

  /**
   * Get the full response for database storage
   */
  getFullResponse() {
    return this.fullResponse;
  }
}

/**
 * Process an OpenAI stream and emit structured events
 * 
 * @param {AsyncIterable} stream - OpenAI streaming response
 * @param {Response} res - Express response object
 * @param {Array} dataCards - Data cards for marker lookup
 * @returns {Object} - { fullResponse, finishReason, model }
 */
async function processOpenAIStream(stream, res, dataCards = []) {
  const processor = new StreamProcessor(res, dataCards);
  let finishReason = null;
  let model = null;

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      processor.addChunk(content);
    }
    
    if (chunk.choices[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
    
    if (chunk.model) {
      model = chunk.model;
    }
  }

  // Finalize - flush any remaining buffered content
  processor.finalize();

  return {
    fullResponse: processor.getFullResponse(),
    finishReason,
    model
  };
}

module.exports = {
  StreamProcessor,
  processOpenAIStream,
  extractFirstMarker,
  hasPartialMarker,
  MARKER_PATTERNS
};
