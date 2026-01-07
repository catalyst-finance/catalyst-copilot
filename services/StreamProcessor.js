/**
 * StreamProcessor.js
 * 
 * Processes the OpenAI stream and emits structured block events instead of raw text.
 * This handles marker parsing backend-side so the frontend receives clean, pre-processed events.
 */

// Marker patterns for detecting special content in the stream
const MARKER_PATTERNS = {
  CHART: /\[VIEW_CHART:([A-Z]+):([^\]]+)\]/,
  ARTICLE: /\[VIEW_ARTICLE:([^\]]+)\]/,
  IMAGE: /\[IMAGE_CARD:([^\]]+)\]/,
  EVENT: /\[EVENT_CARD:([^\]]+)\]/,
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
 */
class StreamProcessor {
  constructor(res, dataCards = []) {
    this.res = res;
    this.dataCards = dataCards;
    this.buffer = '';
    this.fullResponse = '';
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
   */
  emitText(text) {
    if (text) {
      this.emit({ type: 'content', content: text });
    }
  }

  /**
   * Send a chart block event
   */
  emitChart(symbol, timeRange) {
    this.emit({ type: 'chart_block', symbol, timeRange });
  }

  /**
   * Send an article block event
   */
  emitArticle(cardId) {
    this.emit({ type: 'article_block', cardId });
  }

  /**
   * Send an image block event
   */
  emitImage(cardId) {
    this.emit({ type: 'image_block', cardId });
  }

  /**
   * Send an event card block event
   */
  emitEvent(cardId) {
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
        // Emit any text before the marker
        this.emitText(marker.before);
        
        // Emit the marker as a structured block
        switch (marker.type) {
          case 'CHART':
            this.emitChart(marker.data.symbol, marker.data.timeRange);
            break;
          case 'ARTICLE':
            this.emitArticle(marker.data.cardId);
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
        // Don't emit yet, wait for more content
        break;
      }

      // Find a good break point (paragraph or at least some content)
      if (!flush) {
        // Look for paragraph break
        const paragraphBreak = this.buffer.indexOf('\n\n');
        if (paragraphBreak >= 0) {
          this.emitText(this.buffer.substring(0, paragraphBreak + 2));
          this.buffer = this.buffer.substring(paragraphBreak + 2);
          continue;
        }
        
        // If buffer is getting large, emit up to a sentence
        if (this.buffer.length > 200) {
          const sentenceEnd = this.buffer.search(/[.!?]\s/);
          if (sentenceEnd >= 0) {
            this.emitText(this.buffer.substring(0, sentenceEnd + 2));
            this.buffer = this.buffer.substring(sentenceEnd + 2);
            continue;
          }
        }
        
        // Wait for more content
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
   * Finalize processing - flush any remaining content
   */
  finalize() {
    this.processBuffer(true);
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
