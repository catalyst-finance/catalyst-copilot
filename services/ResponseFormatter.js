/**
 * Response Formatter
 * Post-processes AI responses to apply mechanical formatting rules
 * 
 * Separates concerns:
 * - AI focuses on: content, citations, card markers, natural organization
 * - Post-processor handles: markdown consistency, spacing, bullet formatting
 */

class ResponseFormatter {
  constructor() {
    this.buffer = '';
    this.inCodeBlock = false;
    this.lastLineWasEmpty = false;
  }

  /**
   * Process a chunk of streaming text
   * Buffers until complete lines, applies formatting, emits formatted text only
   */
  processChunk(chunk) {
    this.buffer += chunk;
    
    // Process complete lines only
    const lines = this.buffer.split('\n');
    
    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';
    
    // Format complete lines and filter out nulls (removed blank lines)
    const formatted = lines.map((line, index) => {
      return this.formatLine(line, index === 0);
    }).filter(l => l !== null).join('\n');
    
    return formatted ? formatted + '\n' : '';
  }

  /**
   * Flush remaining buffer at end of stream
   */
  flush() {
    if (this.buffer) {
      const formatted = this.formatLine(this.buffer, false);
      this.buffer = '';
      return formatted;
    }
    return '';
  }

  /**
   * Format a single line according to mechanical rules
   */
  formatLine(line, isFirst) {
    // Track code blocks (don't format inside them)
    if (line.trim().startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      return line;
    }
    
    if (this.inCodeBlock) {
      return line;
    }

    const trimmed = line.trim();
    
    // Empty line handling
    if (trimmed === '') {
      // Prevent multiple consecutive empty lines
      if (this.lastLineWasEmpty) {
        return null; // Skip this line
      }
      this.lastLineWasEmpty = true;
      return '';
    }
    
    this.lastLineWasEmpty = false;

    // Header detection and formatting
    if (this.isHeader(trimmed)) {
      return this.formatHeader(trimmed);
    }

    // Bullet point formatting
    if (this.isBullet(trimmed)) {
      return this.formatBullet(trimmed);
    }

    // Card markers (preserve as-is)
    if (this.isCardMarker(trimmed)) {
      return line;
    }

    // Regular paragraph - ensure proper spacing
    return line;
  }

  /**
   * Detect if line is a header (contains text that should be bold)
   */
  isHeader(line) {
    // Already bolded headers
    if (line.match(/^\*\*[^*]+\*\*:?\s*$/)) {
      return true;
    }
    
    // Numbered list items with colons are NOT headers (e.g., "1. Item Name:")
    if (line.match(/^\d+\.\s/)) {
      return false;
    }
    
    // Bullet points with colons are NOT headers (e.g., "- Category:")
    if (line.match(/^[-•\*]\s/)) {
      return false;
    }
    
    // Common section header patterns (title case, short, standalone)
    // Only match clean headers without leading punctuation
    if (line.match(/^[A-Z][A-Za-z\s]{5,50}$/) && !line.includes('.')) {
      return true;
    }
    
    return false;
  }

  /**
   * Format headers with consistent bold markdown
   */
  formatHeader(line) {
    // Already properly formatted
    if (line.match(/^\*\*[^*]+\*\*:?\s*$/)) {
      return line;
    }
    
    // Add bold formatting
    const cleaned = line.replace(/^[*\s]+|[*\s]+$/g, '').trim();
    return `**${cleaned}**`;
  }

  /**
   * Detect if line is a bullet point
   */
  isBullet(line) {
    return line.match(/^[-•\*]\s/) !== null;
  }

  /**
   * Format bullets consistently (use - for all bullets)
   */
  formatBullet(line) {
    // Normalize to dash bullets
    return line.replace(/^[•\*]\s/, '- ');
  }

  /**
   * Detect card markers
   */
  isCardMarker(line) {
    return line.match(/^\[(VIEW_ARTICLE|VIEW_CHART|IMAGE_CARD|EVENT_CARD):/) !== null;
  }

  /**
   * Reset formatter state for new response
   */
  reset() {
    this.buffer = '';
    this.inCodeBlock = false;
    this.lastLineWasEmpty = false;
  }
}

module.exports = ResponseFormatter;
