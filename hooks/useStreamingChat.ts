/**
 * useStreamingChat.ts
 * 
 * A reusable hook for handling SSE streaming chat with the Catalyst Copilot backend.
 * This hook manages:
 * - SSE connection and parsing
 * - Content block extraction and rendering
 * - Thinking step tracking
 * - Error handling
 * 
 * The backend sends structured events (text_delta, chart_block, etc.) and this hook
 * converts them into ContentBlocks for the UI to render.
 */

import { useState, useRef, useCallback } from 'react';
import type { 
  ContentBlock, 
  ThinkingStep, 
  SSEEvent,
  MetadataEvent,
  DataCard,
  IntelligenceMetadata 
} from '../lib/StreamBlockTypes';

// ============================================
// TYPES
// ============================================

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  dataCards?: DataCard[];
  eventData?: Record<string, any>;
  timestamp: Date;
  thinkingSteps?: ThinkingStep[];
  thinkingDuration?: number;
}

interface StreamingState {
  isStreaming: boolean;
  isTyping: boolean;
  blocks: ContentBlock[];
  thinking: ThinkingStep[];
  dataCards: DataCard[];
  error: string | null;
}

interface UseStreamingChatOptions {
  endpoint?: string;
  selectedTickers?: string[];
  onMessageComplete?: (message: Message) => void;
}

interface UseStreamingChatReturn {
  // State
  isStreaming: boolean;
  isTyping: boolean;
  blocks: ContentBlock[];
  thinking: ThinkingStep[];
  dataCards: DataCard[];
  error: string | null;
  
  // Actions
  sendMessage: (message: string, conversationHistory: Message[]) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_ENDPOINT = 'https://catalyst-copilot-2nndy.ondigitalocean.app/chat';

// Marker patterns for backward compatibility during transition
const MARKER_PATTERNS = {
  CHART: /^\s*\[VIEW_CHART:([A-Z]+):([^\]]+)\]\s*/,
  ARTICLE: /^\s*\[VIEW_ARTICLE:([^\]]+)\]\s*/,
  IMAGE: /^\s*\[IMAGE_CARD:([^\]]+)\]\s*/,
  EVENT: /^\s*\[EVENT_CARD:([^\]]+)\]\s*/,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse SSE stream buffer into complete messages
 */
function parseSSEBuffer(buffer: string): { messages: string[], remaining: string } {
  const messages: string[] = [];
  let currentBuffer = buffer;
  
  while (true) {
    const doubleNewlineIndex = currentBuffer.indexOf('\n\n');
    
    if (doubleNewlineIndex === -1) {
      return { messages, remaining: currentBuffer };
    }
    
    const message = currentBuffer.substring(0, doubleNewlineIndex);
    if (message.trim()) {
      messages.push(message);
    }
    
    currentBuffer = currentBuffer.substring(doubleNewlineIndex + 2);
  }
}

/**
 * Parse a single SSE message into structured data
 */
function parseSSEMessage(rawData: string): SSEEvent | null {
  try {
    let cleanData = rawData.trim();
    
    // Remove "data: " prefix(es)
    while (cleanData.startsWith('data: ')) {
      cleanData = cleanData.substring(6).trim();
    }
    
    if (!cleanData) return null;
    
    if (!cleanData.startsWith('{') && !cleanData.startsWith('[')) {
      console.warn('⚠️ Non-JSON SSE data:', cleanData.substring(0, 50));
      return null;
    }

    return JSON.parse(cleanData);
  } catch (error) {
    console.error('❌ SSE JSON parse error:', error);
    return null;
  }
}

/**
 * Check for incomplete markdown patterns that shouldn't be rendered yet
 */
function hasIncompletePattern(str: string): boolean {
  // Unclosed brackets
  const openBrackets = (str.match(/\[/g) || []).length;
  const closeBrackets = (str.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) return true;
  
  // Unclosed link parentheses
  if (/\]\([^)]*$/.test(str)) return true;
  
  // Unclosed bold markers
  const boldMarkers = (str.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 !== 0) return true;
  
  // Partial marker at end
  if (/\[[^\]]*$/.test(str)) return true;
  
  return false;
}

/**
 * Extract complete, renderable blocks from a content buffer
 * This handles the legacy marker-based content from the backend
 * until we fully migrate to structured events
 */
function extractBlocksFromBuffer(
  buffer: string, 
  dataCards: DataCard[]
): { blocks: ContentBlock[], remaining: string } {
  const blocks: ContentBlock[] = [];
  let remaining = buffer;
  let blockId = 0;
  
  while (remaining.length > 0) {
    // Check for VIEW_CHART marker
    const chartMatch = remaining.match(MARKER_PATTERNS.CHART);
    if (chartMatch) {
      blocks.push({
        id: `chart-${blockId++}`,
        type: 'chart',
        data: { symbol: chartMatch[1], timeRange: chartMatch[2] }
      });
      remaining = remaining.substring(chartMatch[0].length);
      continue;
    }
    
    // Check for VIEW_ARTICLE marker
    const articleMatch = remaining.match(MARKER_PATTERNS.ARTICLE);
    if (articleMatch) {
      const articleId = articleMatch[1];
      const articleCard = dataCards?.find(c => c.type === 'article' && c.data?.id === articleId);
      if (articleCard) {
        blocks.push({
          id: `article-${blockId++}`,
          type: 'article',
          data: articleCard.data
        });
      }
      remaining = remaining.substring(articleMatch[0].length);
      continue;
    }
    
    // Check for IMAGE_CARD marker
    const imageMatch = remaining.match(MARKER_PATTERNS.IMAGE);
    if (imageMatch) {
      const imageId = imageMatch[1];
      const imageCard = dataCards?.find(c => c.type === 'image' && c.data?.id === imageId);
      if (imageCard) {
        blocks.push({
          id: `image-${blockId++}`,
          type: 'image',
          data: imageCard.data
        });
      }
      remaining = remaining.substring(imageMatch[0].length);
      continue;
    }
    
    // Check for EVENT_CARD marker
    const eventMatch = remaining.match(MARKER_PATTERNS.EVENT);
    if (eventMatch) {
      const eventId = eventMatch[1];
      const eventCard = dataCards?.find(c => 
        c.type === 'event' && (c.data?.id === eventId || c.data?.id?.toString() === eventId)
      );
      if (eventCard) {
        blocks.push({
          id: `event-${blockId++}`,
          type: 'event',
          data: eventCard.data
        });
      }
      remaining = remaining.substring(eventMatch[0].length);
      continue;
    }
    
    // Look for the next marker or paragraph break
    const nextMarkerMatch = remaining.match(/\[(?:VIEW_CHART|VIEW_ARTICLE|IMAGE_CARD|EVENT_CARD):[^\]]+\]/);
    const nextDoubleNewline = remaining.indexOf('\n\n');
    
    let cutPoint = -1;
    
    if (nextMarkerMatch && nextMarkerMatch.index !== undefined) {
      if (nextDoubleNewline >= 0 && nextDoubleNewline < nextMarkerMatch.index) {
        cutPoint = nextDoubleNewline + 2;
      } else if (nextMarkerMatch.index === 0) {
        continue;
      } else {
        cutPoint = nextMarkerMatch.index;
      }
    } else if (nextDoubleNewline >= 0) {
      cutPoint = nextDoubleNewline + 2;
    } else {
      const hasIncomplete = hasIncompletePattern(remaining);
      if (hasIncomplete || remaining.trim().length < 20) {
        break;
      }
      cutPoint = remaining.length;
    }
    
    if (cutPoint > 0) {
      const textContent = remaining.substring(0, cutPoint);
      if (textContent.trim()) {
        blocks.push({
          id: `text-${blockId++}`,
          type: 'text',
          content: textContent
        });
      }
      remaining = remaining.substring(cutPoint);
    } else {
      break;
    }
  }
  
  return { blocks, remaining };
}

// ============================================
// HOOK
// ============================================

export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatReturn {
  const {
    endpoint = DEFAULT_ENDPOINT,
    selectedTickers = [],
    onMessageComplete
  } = options;

  // State
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    isTyping: false,
    blocks: [],
    thinking: [],
    dataCards: [],
    error: null,
  });

  // Refs for streaming context
  const abortControllerRef = useRef<AbortController | null>(null);
  const contentBufferRef = useRef<string>('');
  const blockIdCounterRef = useRef<number>(0);
  const sendingRef = useRef<boolean>(false);

  /**
   * Reset streaming state
   */
  const reset = useCallback(() => {
    setState({
      isStreaming: false,
      isTyping: false,
      blocks: [],
      thinking: [],
      dataCards: [],
      error: null,
    });
    contentBufferRef.current = '';
    blockIdCounterRef.current = 0;
  }, []);

  /**
   * Abort current stream
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isStreaming: false,
      isTyping: false,
    }));
    sendingRef.current = false;
  }, []);

  /**
   * Process content buffer and extract blocks
   */
  const processContentBuffer = useCallback((
    forceFlush: boolean,
    dataCards: DataCard[],
    collectedBlocks: ContentBlock[]
  ): ContentBlock[] => {
    const { blocks, remaining } = extractBlocksFromBuffer(contentBufferRef.current, dataCards);
    
    if (blocks.length > 0) {
      const newBlocks = blocks.map(block => ({
        ...block,
        id: `block-${blockIdCounterRef.current++}-${block.id}`
      }));
      
      collectedBlocks.push(...newBlocks);
      
      setState(prev => ({
        ...prev,
        blocks: [...prev.blocks, ...newBlocks]
      }));
    }
    
    contentBufferRef.current = remaining;
    
    if (forceFlush && remaining.trim()) {
      const finalBlock: ContentBlock = {
        id: `block-${blockIdCounterRef.current++}-final`,
        type: 'text',
        content: remaining
      };
      collectedBlocks.push(finalBlock);
      
      setState(prev => ({
        ...prev,
        blocks: [...prev.blocks, finalBlock]
      }));
      
      contentBufferRef.current = '';
    }
    
    return collectedBlocks;
  }, []);

  /**
   * Send a message and stream the response
   */
  const sendMessage = useCallback(async (
    message: string,
    conversationHistory: Message[]
  ): Promise<void> => {
    if (!message.trim()) return;
    
    // Prevent duplicate sends
    if (sendingRef.current || state.isStreaming || state.isTyping) {
      return;
    }
    
    sendingRef.current = true;
    
    // Reset state for new message
    reset();
    setState(prev => ({
      ...prev,
      isTyping: true,
      isStreaming: true,
    }));
    
    // Create abort controller
    abortControllerRef.current = new AbortController();
    
    // Tracking variables
    let collectedThinking: ThinkingStep[] = [];
    let collectedContent = '';
    let collectedBlocks: ContentBlock[] = [];
    let collectedDataCards: DataCard[] = [];
    let eventData: Record<string, any> = {};
    let thinkingStartTime: number | null = null;
    
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        credentials: 'omit',
        body: JSON.stringify({
          message,
          conversationHistory: conversationHistory.map(m => ({ role: m.role, content: m.content })),
          selectedTickers,
          timezone: userTimezone
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        const { messages: completeMessages, remaining } = parseSSEBuffer(buffer);
        buffer = remaining;

        // Process each complete message
        for (const messageBlock of completeMessages) {
          const trimmedBlock = messageBlock.trim();
          
          if (!trimmedBlock || trimmedBlock.startsWith(':')) continue;
          
          if (trimmedBlock.startsWith('data: ')) {
            const data = parseSSEMessage(trimmedBlock);
            if (!data || !data.type) continue;

            switch (data.type) {
              case 'metadata':
                if (data.dataCards) {
                  collectedDataCards = data.dataCards;
                  setState(prev => ({ ...prev, dataCards: data.dataCards }));
                }
                if (data.eventData) {
                  eventData = data.eventData;
                }
                break;

              case 'thinking':
                if (thinkingStartTime === null) {
                  thinkingStartTime = Date.now();
                }
                const newStep: ThinkingStep = { 
                  phase: data.phase || 'thinking', 
                  content: data.content,
                  timestamp: Date.now()
                };
                collectedThinking.push(newStep);
                setState(prev => ({ ...prev, thinking: [...prev.thinking, newStep] }));
                break;

              // Handle new structured block events (future backend)
              case 'text_delta':
                contentBufferRef.current += data.content;
                collectedContent += data.content;
                collectedBlocks = processContentBuffer(false, collectedDataCards, collectedBlocks);
                break;

              case 'chart_block':
                const chartBlock: ContentBlock = {
                  id: `chart-${blockIdCounterRef.current++}`,
                  type: 'chart',
                  data: { symbol: data.symbol, timeRange: data.timeRange }
                };
                collectedBlocks.push(chartBlock);
                setState(prev => ({ ...prev, blocks: [...prev.blocks, chartBlock] }));
                break;

              case 'article_block':
                const articleCard = collectedDataCards.find(c => c.data?.id === data.cardId);
                if (articleCard) {
                  const articleBlock: ContentBlock = {
                    id: `article-${blockIdCounterRef.current++}`,
                    type: 'article',
                    data: articleCard.data
                  };
                  collectedBlocks.push(articleBlock);
                  setState(prev => ({ ...prev, blocks: [...prev.blocks, articleBlock] }));
                }
                break;

              case 'image_block':
                const imageCard = collectedDataCards.find(c => c.data?.id === data.cardId);
                if (imageCard) {
                  const imageBlock: ContentBlock = {
                    id: `image-${blockIdCounterRef.current++}`,
                    type: 'image',
                    data: imageCard.data
                  };
                  collectedBlocks.push(imageBlock);
                  setState(prev => ({ ...prev, blocks: [...prev.blocks, imageBlock] }));
                }
                break;

              case 'event_block':
                const eventCard = collectedDataCards.find(c => c.data?.id === data.cardId);
                if (eventCard) {
                  const eventBlock: ContentBlock = {
                    id: `event-${blockIdCounterRef.current++}`,
                    type: 'event',
                    data: eventCard.data
                  };
                  collectedBlocks.push(eventBlock);
                  setState(prev => ({ ...prev, blocks: [...prev.blocks, eventBlock] }));
                }
                break;

              // Legacy: Handle old 'content' event type (marker-based)
              case 'content':
                contentBufferRef.current += data.content;
                collectedContent += data.content;
                collectedBlocks = processContentBuffer(false, collectedDataCards, collectedBlocks);
                break;

              case 'done':
                // Flush remaining content
                collectedBlocks = processContentBuffer(true, collectedDataCards, collectedBlocks);
                
                const thinkingDuration = thinkingStartTime 
                  ? Math.round((Date.now() - thinkingStartTime) / 1000) 
                  : undefined;
                  
                const aiMessage: Message = {
                  id: `ai-${Date.now()}`,
                  role: 'assistant',
                  content: collectedContent,
                  dataCards: collectedDataCards,
                  eventData: eventData,
                  thinkingSteps: collectedThinking,
                  thinkingDuration: thinkingDuration,
                  timestamp: new Date()
                };
                
                onMessageComplete?.(aiMessage);
                
                setState(prev => ({
                  ...prev,
                  isStreaming: false,
                  isTyping: false,
                  blocks: [],
                  thinking: [],
                }));
                break;

              case 'error':
                setState(prev => ({
                  ...prev,
                  isStreaming: false,
                  isTyping: false,
                  error: data.error || 'An error occurred'
                }));
                break;
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('❌ Error in streaming chat:', error);
        setState(prev => ({
          ...prev,
          isStreaming: false,
          isTyping: false,
          error: (error as Error).message
        }));
      }
    } finally {
      sendingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [endpoint, selectedTickers, state.isStreaming, state.isTyping, reset, processContentBuffer, onMessageComplete]);

  return {
    isStreaming: state.isStreaming,
    isTyping: state.isTyping,
    blocks: state.blocks,
    thinking: state.thinking,
    dataCards: state.dataCards,
    error: state.error,
    sendMessage,
    abort,
    reset,
  };
}

export default useStreamingChat;
