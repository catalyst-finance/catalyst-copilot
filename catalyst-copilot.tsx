import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, Send, ChevronDown, ChevronUp, X, Minimize2, Edit2, Check, XCircle, TrendingUp, TrendingDown, Calendar, BarChart3, AlertCircle, Target, DollarSign, Package, ShoppingCart, Presentation, Users, Landmark, Handshake, Building, Tag, Shield, Scale, Loader2, ExternalLink, FileText } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { SimpleMiniChart, IntradayMiniChart } from './charts';
import { formatCurrency, getEventTypeConfig, formatEventDateTime } from '../utils/formatting';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { MarketEvent } from '../utils/supabase/events-api';

type ChatState = 'collapsed' | 'inline-expanded' | 'full-window' | 'minimized';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentBlocks?: StreamBlock[];  // Pre-processed blocks from streaming (charts, articles, etc.)
  dataCards?: DataCard[];
  eventData?: Record<string, any>;
  timestamp: Date;
  thinkingSteps?: ThinkingStep[];
  thinkingDuration?: number; // Duration in seconds
}

interface ThinkingStep {
  phase: string;
  content: string;
}

interface DataCard {
  type: 'stock' | 'event-list' | 'event' | 'chart' | 'image' | 'article';
  data: any;
}

interface ImageCardData {
  id: string;
  ticker: string;
  source: string;
  title: string;
  imageUrl: string;
  context?: string;
  filingType?: string;
  filingDate?: string;
  filingUrl?: string;
}

interface ArticleCardData {
  id: string;
  title: string;
  url: string;
  source: string;
  domain: string;
  ticker?: string;
  publishedAt?: string;
  logoUrl?: string;
  imageUrl?: string;
  content?: string;
  country?: string;
  category?: string;
}

interface ChartCardData {
  id: string;
  symbol: string;
  timeRange: '1D' | '5D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y';
  chartData?: any[]; // Pre-loaded chart data from backend
  previousClose?: number; // Pre-loaded previous close from backend
}

interface StockCardData {
  ticker: string;
  company: string;
  price: number;
  change: number;
  changePercent: number;
  chartData?: any[]; // Legacy support
  chartMetadata?: {
    available: boolean;
    count: number;
    date: string;
    endpoint: string;
  } | null;
  chartReference?: {
    table: string;
    symbol: string;
    dateRange: {
      start: string;
      end: string;
    };
    columns: string[];
    orderBy: string;
  };
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
}

interface CatalystCopilotProps {
  selectedTickers?: string[];
  onEventClick?: (event: MarketEvent) => void;
  onTickerClick?: (ticker: string) => void;
}

/**
 * StreamBlock - Represents a pre-processed, renderable unit of content
 * Each block is ready to render in its final form (text, chart, article card, etc.)
 */
interface StreamBlock {
  id: string;
  type: 'text' | 'chart' | 'article' | 'image' | 'event' | 'separator';
  content: string;  // For text blocks, the markdown content
  data?: any;       // For cards/charts, the structured data
}

/**
 * Extract complete, renderable blocks from a content buffer
 * Returns blocks ready to render and remaining buffer content
 */
function extractStreamBlocks(buffer: string, dataCards: DataCard[]): { blocks: StreamBlock[], remaining: string } {
  const blocks: StreamBlock[] = [];
  let remaining = buffer;
  let blockId = 0;
  
  // Process the buffer looking for complete blocks
  while (remaining.length > 0) {
    // Check for VIEW_CHART marker at the start or after newlines
    const chartMatch = remaining.match(/^(\s*)\[VIEW_CHART:([A-Z]+):([^\]]+)\](\s*)/);
    if (chartMatch) {
      // Found a complete chart marker - extract it as a block
      blocks.push({
        id: `chart-${blockId++}`,
        type: 'chart',
        content: '',
        data: { symbol: chartMatch[2], timeRange: chartMatch[3] }
      });
      remaining = remaining.substring(chartMatch[0].length);
      continue;
    }
    
    // Check for VIEW_ARTICLE marker
    const articleMatch = remaining.match(/^(\s*)\[VIEW_ARTICLE:([^\]]+)\](\s*)/);
    if (articleMatch) {
      const articleId = articleMatch[2];
      const articleCard = dataCards?.find(c => c.type === 'article' && c.data.id === articleId);
      if (articleCard) {
        blocks.push({
          id: `article-${blockId++}`,
          type: 'article',
          content: '',
          data: articleCard.data
        });
      }
      remaining = remaining.substring(articleMatch[0].length);
      continue;
    }
    
    // Check for IMAGE_CARD marker
    const imageMatch = remaining.match(/^(\s*)\[IMAGE_CARD:([^\]]+)\](\s*)/);
    if (imageMatch) {
      const imageId = imageMatch[2];
      const imageCard = dataCards?.find(c => c.type === 'image' && c.data.id === imageId);
      if (imageCard) {
        blocks.push({
          id: `image-${blockId++}`,
          type: 'image',
          content: '',
          data: imageCard.data
        });
      }
      remaining = remaining.substring(imageMatch[0].length);
      continue;
    }
    
    // Check for EVENT_CARD marker
    const eventMatch = remaining.match(/^(\s*)\[EVENT_CARD:([^\]]+)\](\s*)/);
    if (eventMatch) {
      const eventId = eventMatch[2];
      const eventCard = dataCards?.find(c => c.type === 'event' && (c.data.id === eventId || c.data.id?.toString() === eventId));
      if (eventCard) {
        blocks.push({
          id: `event-${blockId++}`,
          type: 'event',
          content: '',
          data: eventCard.data
        });
      }
      remaining = remaining.substring(eventMatch[0].length);
      continue;
    }
    
    // Look for the next marker or paragraph break
    const nextMarkerMatch = remaining.match(/\[(?:VIEW_CHART|VIEW_ARTICLE|IMAGE_CARD|EVENT_CARD):[^\]]+\]/);
    const nextDoubleNewline = remaining.indexOf('\n\n');
    
    // Determine where to cut the text block
    let cutPoint = -1;
    
    if (nextMarkerMatch && nextMarkerMatch.index !== undefined) {
      // There's a marker coming up
      if (nextDoubleNewline >= 0 && nextDoubleNewline < nextMarkerMatch.index) {
        // Paragraph break comes first
        cutPoint = nextDoubleNewline + 2;
      } else if (nextMarkerMatch.index === 0) {
        // Marker is right at the start - this shouldn't happen due to matches above
        // but handle it just in case
        continue;
      } else {
        // Text before the marker
        cutPoint = nextMarkerMatch.index;
      }
    } else if (nextDoubleNewline >= 0) {
      // No marker, but there's a paragraph break
      cutPoint = nextDoubleNewline + 2;
    } else {
      // No marker or paragraph break - check if we have an incomplete pattern
      const hasIncomplete = hasIncompletePattern(remaining);
      if (hasIncomplete) {
        // Buffer the rest until more content arrives
        break;
      } else {
        // Content looks complete enough to render
        // But wait for more if it's very short
        if (remaining.trim().length < 20) {
          break;
        }
        cutPoint = remaining.length;
      }
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

/**
 * Check for incomplete markdown patterns that shouldn't be rendered yet
 */
function hasIncompletePattern(str: string): boolean {
  // Check for unclosed brackets (but not if it looks like a complete marker)
  const openBrackets = (str.match(/\[/g) || []).length;
  const closeBrackets = (str.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) return true;
  
  // Check for unclosed parentheses after ]
  if (/\]\([^)]*$/.test(str)) return true;
  
  // Check for unclosed bold markers
  const boldMarkers = (str.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 !== 0) return true;
  
  // Check for partial marker at end
  if (/\[[^\]]*$/.test(str)) return true;
  
  return false;
}

export function CatalystCopilot({ selectedTickers = [], onEventClick, onTickerClick }: CatalystCopilotProps) {
  const [chatState, setChatState] = useState<ChatState>('collapsed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const sendingRef = useRef(false); // Add ref to prevent duplicate sends
  
  // Streaming states - using pre-processed blocks for clean inline rendering
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [streamedBlocks, setStreamedBlocks] = useState<StreamBlock[]>([]);  // Pre-processed renderable blocks
  const [streamingDataCards, setStreamingDataCards] = useState<DataCard[]>([]);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null); // Add ref for latest message start
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isRestoringScroll = useRef(false);
  const prevIsStreamingRef = useRef(false); // Track previous streaming state

  useEffect(() => {
    try {
      const savedChatState = localStorage.getItem('catalyst_chat_state');
      const savedMessages = localStorage.getItem('catalyst_chat_messages');
      const savedScrollPosition = localStorage.getItem('catalyst_chat_scroll_position');
      
      if (savedChatState) {
        setChatState(savedChatState as ChatState);
      }
      
      if (savedMessages) {
        const parsedMessages = JSON.parse(savedMessages);
        setMessages(parsedMessages);
      }

      if (savedScrollPosition && savedChatState !== 'collapsed') {
        isRestoringScroll.current = true;
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = parseInt(savedScrollPosition, 10);
          }
          setTimeout(() => {
            isRestoringScroll.current = false;
          }, 100);
        }, 50);
      }
    } catch (error) {
      console.error('Error restoring chat state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('catalyst_chat_state', chatState);
    } catch (error) {
      console.error('Error saving chat state:', error);
    }
  }, [chatState]);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem('catalyst_chat_messages', JSON.stringify(messages));
      }
    } catch (error) {
      console.error('Error saving chat messages:', error);
    }
  }, [messages]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        try {
          localStorage.setItem('catalyst_chat_scroll_position', container.scrollTop.toString());
        } catch (error) {
          console.error('Error saving scroll position:', error);
        }
      }, 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [chatState]);

  // Use requestAnimationFrame for smooth, non-blocking scrolling
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!isRestoringScroll.current && chatContainerRef.current) {
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: behavior
          });
        }
      });
    }
  };

  const scrollToLatestMessage = () => {
    if (!isRestoringScroll.current && latestMessageRef.current) {
      requestAnimationFrame(() => {
        latestMessageRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
  };

  // Progressive scroll that follows streaming text smoothly
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contentBufferRef = useRef<string>('');  // Buffer for incoming content before block extraction
  const contentFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (!isRestoringScroll.current) {
      // Check if streaming just finished (was true, now false)
      if (prevIsStreamingRef.current && !isStreaming) {
        // Streaming just completed - immediate instant scroll to bottom
        scrollToBottom('auto');
      } else if (isStreaming) {
        // Still streaming - progressively follow with smooth scroll on every update
        // Browser's smooth scroll animation naturally throttles excessive calls
        scrollToBottom('smooth');
      }
      // Update previous streaming state
      prevIsStreamingRef.current = isStreaming;
    }
  }, [messages, streamedBlocks, thinkingSteps, isStreaming]);

  // Handle ESC key to close fullscreen image
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenImage) {
        setFullscreenImage(null);
      }
    };

    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
  }, [fullscreenImage]);

  const quickStartChips = [
    "What moved TSLA today?",
    "Biggest movers in my watchlist?",
    "Explain today's market in simple terms"
  ];

  // Centralized function to process SSE data with robust error handling
  const processSSEData = (rawData: string): any | null => {
    try {
      // Handle potential "data: " prefix variations and strip them
      let cleanData = rawData.trim();
      
      // Remove "data: " prefix(es) - handles buffering edge cases
      while (cleanData.startsWith('data: ')) {
        cleanData = cleanData.substring(6).trim();
      }
      
      // Skip empty data
      if (!cleanData) {
        return null;
      }
      
      // Validate JSON format before parsing
      if (!cleanData.startsWith('{') && !cleanData.startsWith('[')) {
        console.warn('⚠️ Non-JSON SSE data:', cleanData.substring(0, 50));
        return null;
      }

      return JSON.parse(cleanData);
    } catch (error) {
      console.error('❌ SSE JSON parse error:', error);
      console.error('📝 Raw message (first 200 chars):', rawData.substring(0, 200));
      console.error('🧹 After cleaning (first 200 chars):', cleanData.substring(0, 200));
      console.error('📏 Raw length:', rawData.length, 'Clean length:', cleanData.length);
      console.error('🔍 Full raw message:', rawData);
      console.error('🔍 Full clean message:', cleanData);
      return null;
    }
  };

  // Helper function to parse SSE stream - split on double newlines
  const parseSSEStream = (buffer: string): { messages: string[], remaining: string } => {
    const messages: string[] = [];
    let currentBuffer = buffer;
    
    // Keep finding and extracting complete messages until we can't find more
    while (true) {
      const doubleNewlineIndex = currentBuffer.indexOf('\n\n');
      
      if (doubleNewlineIndex === -1) {
        // No more complete messages, return what we have
        return { messages, remaining: currentBuffer };
      }
      
      // Extract one complete message
      const message = currentBuffer.substring(0, doubleNewlineIndex);
      if (message.trim()) {
        messages.push(message);
      }
      
      // Move past the double newline
      currentBuffer = currentBuffer.substring(doubleNewlineIndex + 2);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    
    // Prevent duplicate sends - check both ref and state
    if (sendingRef.current || isStreaming || isTyping) {
      return;
    }
    
    sendingRef.current = true;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    setIsStreaming(true);
    setThinkingSteps([]);
    setStreamedBlocks([]);  // Reset to empty blocks array
    setStreamingDataCards([]);
    setThinkingCollapsed(true);
    
    // Reset content buffer ref
    contentBufferRef.current = '';
    if (contentFlushTimeoutRef.current) {
      clearTimeout(contentFlushTimeoutRef.current);
      contentFlushTimeoutRef.current = null;
    }

    if (chatState === 'inline-expanded') {
      setChatState('full-window');
    }

    try {
      // Get user's timezone for accurate date interpretation
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const response = await fetch('https://catalyst-copilot-2nndy.ondigitalocean.app/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        credentials: 'omit',
        body: JSON.stringify({
          message: message,
          conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
          selectedTickers,
          timezone: userTimezone
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
      }

      // ALWAYS handle as SSE stream - this endpoint ONLY streams
      console.log('📡 SSE stream handler initialized');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let collectedThinking: ThinkingStep[] = [];
      let collectedContent = '';
      let collectedBlocks: StreamBlock[] = [];  // Track all blocks for final message
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null; // Track thinking start time
      let blockIdCounter = 0;  // Unique ID counter for blocks
      
      // Helper to extract and render blocks from buffer
      const processContentBuffer = (forceFlush: boolean = false) => {
        const { blocks, remaining } = extractStreamBlocks(contentBufferRef.current, collectedDataCards);
        
        if (blocks.length > 0) {
          // Assign unique IDs to new blocks
          const newBlocks = blocks.map(block => ({
            ...block,
            id: `block-${blockIdCounter++}-${block.id}`
          }));
          
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks(prev => [...prev, ...newBlocks]);
        }
        
        contentBufferRef.current = remaining;
        
        // If force flush and there's remaining content, add it as a text block
        if (forceFlush && remaining.trim()) {
          const finalBlock: StreamBlock = {
            id: `block-${blockIdCounter++}-final`,
            type: 'text',
            content: remaining
          };
          collectedBlocks.push(finalBlock);
          setStreamedBlocks(prev => [...prev, finalBlock]);
          contentBufferRef.current = '';
        }
      };
      
      // Helper to process a batch of messages
      const processMessages = (msgs: string[]) => {
        for (const messageBlock of msgs) {
          // Each message block should be a complete SSE message
          // Don't split by \n - the entire block is one message
          const trimmedBlock = messageBlock.trim();
          
          // Skip empty blocks and comments
          if (!trimmedBlock || trimmedBlock.startsWith(':')) continue;
          
          // Process the entire message block as one SSE message
          if (trimmedBlock.startsWith('data: ')) {
            const data = processSSEData(trimmedBlock);
            if (!data || !data.type) continue;

            console.log('📥 SSE:', data.type);

            switch (data.type) {
              case 'metadata':
                if (data.dataCards) {
                  collectedDataCards = data.dataCards;
                  setStreamingDataCards(data.dataCards);
                }
                if (data.eventData) {
                  eventData = data.eventData;
                }
                break;

              case 'thinking':
                // Track start time on first thinking step
                if (thinkingStartTime === null) {
                  thinkingStartTime = Date.now();
                }
                const newStep = { phase: data.phase || 'thinking', content: data.content };
                collectedThinking.push(newStep);
                setThinkingSteps(prev => [...prev, newStep]);
                break;

              case 'content':
                // Add content to buffer and track full content
                contentBufferRef.current += data.content;
                collectedContent += data.content;
                
                // Process buffer to extract complete blocks
                // Clear any pending timeout since we're processing now
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                
                // Try to extract blocks immediately
                processContentBuffer(false);
                
                // Set a fallback timeout to flush partial content if no more data arrives
                // Increased delay to slow down rendering for smoother scrolling experience
                contentFlushTimeoutRef.current = setTimeout(() => {
                  if (contentBufferRef.current.trim()) {
                    processContentBuffer(false);
                  }
                  contentFlushTimeoutRef.current = null;
                }, 150);
                break;

              // Handle structured block events from backend StreamProcessor
              case 'chart_block':
                // Chart block - render immediately as a chart
                const chartBlock: StreamBlock = {
                  id: `chart-${blockIdCounter++}`,
                  type: 'chart',
                  content: '',
                  data: { symbol: data.symbol, timeRange: data.timeRange }
                };
                collectedBlocks.push(chartBlock);
                setStreamedBlocks(prev => [...prev, chartBlock]);
                break;

              case 'article_block':
                // Article block - find card data and render
                const articleCard = collectedDataCards.find(c => c.type === 'article' && c.data?.id === data.cardId);
                if (articleCard) {
                  const articleBlock: StreamBlock = {
                    id: `article-${blockIdCounter++}`,
                    type: 'article',
                    content: '',
                    data: articleCard.data
                  };
                  collectedBlocks.push(articleBlock);
                  setStreamedBlocks(prev => [...prev, articleBlock]);
                }
                break;

              case 'horizontal_rule':
                // Horizontal separator - styled divider after article discussions
                const separatorBlock: StreamBlock = {
                  id: `separator-${blockIdCounter++}`,
                  type: 'separator',
                  content: ''
                };
                collectedBlocks.push(separatorBlock);
                setStreamedBlocks(prev => [...prev, separatorBlock]);
                break;

              case 'image_block':
                // Image block - find card data and render
                const imageCard = collectedDataCards.find(c => c.type === 'image' && c.data?.id === data.cardId);
                if (imageCard) {
                  const imageBlock: StreamBlock = {
                    id: `image-${blockIdCounter++}`,
                    type: 'image',
                    content: '',
                    data: imageCard.data
                  };
                  collectedBlocks.push(imageBlock);
                  setStreamedBlocks(prev => [...prev, imageBlock]);
                }
                break;

              case 'event_block':
                // Event block - find card data and render
                const eventCard = collectedDataCards.find(c => c.type === 'event' && (c.data?.id === data.cardId || c.data?.id?.toString() === data.cardId));
                if (eventCard) {
                  const eventBlock: StreamBlock = {
                    id: `event-${blockIdCounter++}`,
                    type: 'event',
                    content: '',
                    data: eventCard.data
                  };
                  collectedBlocks.push(eventBlock);
                  setStreamedBlocks(prev => [...prev, eventBlock]);
                }
                break;

              case 'done':
                // Flush any remaining buffered content as final blocks
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processContentBuffer(true);  // Force flush remaining content
                
                // Calculate thinking duration
                const thinkingDuration = thinkingStartTime 
                  ? Math.round((Date.now() - thinkingStartTime) / 1000) 
                  : undefined;
                  
                const aiMessage: Message = {
                  id: `ai-${Date.now()}`,
                  role: 'assistant',
                  content: collectedContent,
                  contentBlocks: collectedBlocks,  // Store blocks for final rendering
                  dataCards: collectedDataCards,
                  eventData: eventData,
                  thinkingSteps: collectedThinking,
                  thinkingDuration: thinkingDuration,
                  timestamp: new Date()
                };
                setMessages(prev => [...prev, aiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedBlocks([]);  // Clear streamed blocks
                setStreamingDataCards([]);
                break;
            }
          }
        }
      };

      // Continue reading the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.log('📦 Received chunk (length:', chunk.length, '):', chunk.substring(0, 100));
        
        buffer += chunk;
        console.log('📚 Buffer before parse (length:', buffer.length, '):', buffer.substring(0, 150));
        
        const { messages: completeMessages, remaining } = parseSSEStream(buffer);
        console.log('✅ Found', completeMessages.length, 'complete messages, remaining buffer length:', remaining.length);
        
        buffer = remaining;

        processMessages(completeMessages);
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      console.error('❌ Error name:', (error as Error).name);
      console.error('❌ Error message:', (error as Error).message);
      console.error('❌ Error stack:', (error as Error).stack);
      
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        console.error('❌ Network error - possible causes:');
        console.error('  1. CORS not configured on DigitalOcean app');
        console.error('  2. DigitalOcean app is not running');
        console.error('  3. Network connectivity issue');
        console.error('  4. Invalid endpoint URL');
      }
      
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsStreaming(false);
    } finally {
      setIsTyping(false);
      sendingRef.current = false; // Reset the flag
    }
  };

  const handleQuickStart = (question: string) => {
    // Don't send if already sending
    if (!sendingRef.current && !isStreaming && !isTyping) {
      handleSendMessage(question);
    }
  };

  const handleCollapse = () => {
    setChatState('collapsed');
  };

  const handleExpand = () => {
    setChatState('inline-expanded');
  };

  const handleOpenFullWindow = () => {
    setChatState('full-window');
  };

  const handleMinimize = () => {
    setChatState('minimized');
  };

  const handleClose = () => {
    setChatState('collapsed');
    setMessages([]);
    try {
      localStorage.removeItem('catalyst_chat_messages');
      localStorage.setItem('catalyst_chat_state', 'collapsed');
    } catch (error) {
      console.error('Error clearing chat state:', error);
    }
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingValue(content);
    setTimeout(() => {
      editInputRef.current?.focus();
    }, 10);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingValue('');
  };

  const handleSubmitEdit = async (messageId: string) => {
    if (!editingValue.trim()) return;
    
    // Prevent duplicate submits - check both ref and state
    if (sendingRef.current || isStreaming || isTyping) {
      return;
    }
    
    sendingRef.current = true;

    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      sendingRef.current = false;
      return;
    }

    const messagesBeforeEdit = messages.slice(0, messageIndex);

    const editedMessage: Message = {
      ...messages[messageIndex],
      content: editingValue,
      timestamp: new Date()
    };

    setMessages([...messagesBeforeEdit, editedMessage]);
    setEditingMessageId(null);
    setEditingValue('');
    setIsTyping(true);
    setIsStreaming(true);
    setThinkingSteps([]);
    setStreamedBlocks([]);  // Reset to empty blocks array
    setStreamingDataCards([]);
    setThinkingCollapsed(true);
    
    // Reset content buffer ref
    contentBufferRef.current = '';
    if (contentFlushTimeoutRef.current) {
      clearTimeout(contentFlushTimeoutRef.current);
      contentFlushTimeoutRef.current = null;
    }

    try {
      // Get user's timezone for accurate date interpretation
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const response = await fetch('https://catalyst-copilot-2nndy.ondigitalocean.app/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        credentials: 'omit',
        body: JSON.stringify({
          message: editingValue,
          conversationHistory: messagesBeforeEdit.map(m => ({ role: m.role, content: m.content })),
          selectedTickers,
          timezone: userTimezone
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Chat API error:', response.status, response.statusText, errorText);
        throw new Error(`Failed to get response from AI: ${response.status} ${errorText}`);
      }

      // Handle as SSE stream
      console.log('📡 SSE stream handler initialized (edit mode)');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let collectedThinking: ThinkingStep[] = [];
      let collectedContent = '';
      let collectedBlocks: StreamBlock[] = [];  // Track all blocks for final message
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null; // Track thinking start time
      let editBlockIdCounter = 0;  // Unique ID counter for blocks
      
      // Helper to extract and render blocks from buffer (edit mode)
      const processEditContentBuffer = (forceFlush: boolean = false) => {
        const { blocks, remaining } = extractStreamBlocks(contentBufferRef.current, collectedDataCards);
        
        if (blocks.length > 0) {
          const newBlocks = blocks.map(block => ({
            ...block,
            id: `edit-block-${editBlockIdCounter++}-${block.id}`
          }));
          
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks(prev => [...prev, ...newBlocks]);
        }
        
        contentBufferRef.current = remaining;
        
        if (forceFlush && remaining.trim()) {
          const finalBlock: StreamBlock = {
            id: `edit-block-${editBlockIdCounter++}-final`,
            type: 'text',
            content: remaining
          };
          collectedBlocks.push(finalBlock);
          setStreamedBlocks(prev => [...prev, finalBlock]);
          contentBufferRef.current = '';
        }
      };
      
      // Helper to process a batch of messages
      const processMessages = (msgs: string[]) => {
        for (const messageBlock of msgs) {
          const trimmedBlock = messageBlock.trim();
          
          // Skip empty blocks and comments
          if (!trimmedBlock || trimmedBlock.startsWith(':')) continue;
          
          // Process the entire message block as one SSE message
          if (trimmedBlock.startsWith('data: ')) {
            const data = processSSEData(trimmedBlock);
            if (!data || !data.type) continue;

            console.log('📥 SSE (edit):', data.type);

            switch (data.type) {
              case 'metadata':
                if (data.dataCards) {
                  collectedDataCards = data.dataCards;
                  setStreamingDataCards(data.dataCards);
                }
                if (data.eventData) {
                  eventData = data.eventData;
                }
                break;

              case 'thinking':
                // Track start time on first thinking step
                if (thinkingStartTime === null) {
                  thinkingStartTime = Date.now();
                }
                const newStep = { phase: data.phase || 'thinking', content: data.content };
                collectedThinking.push(newStep);
                setThinkingSteps(prev => [...prev, newStep]);
                break;

              case 'content':
                // Add content to buffer and track full content
                contentBufferRef.current += data.content;
                collectedContent += data.content;
                
                // Process buffer to extract complete blocks
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                
                processEditContentBuffer(false);
                
                // Increased delay to slow down rendering for smoother scrolling experience
                contentFlushTimeoutRef.current = setTimeout(() => {
                  if (contentBufferRef.current.trim()) {
                    processEditContentBuffer(false);
                  }
                  contentFlushTimeoutRef.current = null;
                }, 150);
                break;

              // Handle structured block events from backend StreamProcessor
              case 'chart_block':
                const editChartBlock: StreamBlock = {
                  id: `edit-chart-${editBlockIdCounter++}`,
                  type: 'chart',
                  content: '',
                  data: { symbol: data.symbol, timeRange: data.timeRange }
                };
                collectedBlocks.push(editChartBlock);
                setStreamedBlocks(prev => [...prev, editChartBlock]);
                break;

              case 'article_block':
                const editArticleCard = collectedDataCards.find(c => c.type === 'article' && c.data?.id === data.cardId);
                if (editArticleCard) {
                  const editArticleBlock: StreamBlock = {
                    id: `edit-article-${editBlockIdCounter++}`,
                    type: 'article',
                    content: '',
                    data: editArticleCard.data
                  };
                  collectedBlocks.push(editArticleBlock);
                  setStreamedBlocks(prev => [...prev, editArticleBlock]);
                }
                break;

              case 'horizontal_rule':
                // Horizontal separator - styled divider after article discussions
                const editSeparatorBlock: StreamBlock = {
                  id: `edit-separator-${editBlockIdCounter++}`,
                  type: 'separator',
                  content: ''
                };
                collectedBlocks.push(editSeparatorBlock);
                setStreamedBlocks(prev => [...prev, editSeparatorBlock]);
                break;

              case 'image_block':
                const editImageCard = collectedDataCards.find(c => c.type === 'image' && c.data?.id === data.cardId);
                if (editImageCard) {
                  const editImageBlock: StreamBlock = {
                    id: `edit-image-${editBlockIdCounter++}`,
                    type: 'image',
                    content: '',
                    data: editImageCard.data
                  };
                  collectedBlocks.push(editImageBlock);
                  setStreamedBlocks(prev => [...prev, editImageBlock]);
                }
                break;

              case 'event_block':
                const editEventCard = collectedDataCards.find(c => c.type === 'event' && (c.data?.id === data.cardId || c.data?.id?.toString() === data.cardId));
                if (editEventCard) {
                  const editEventBlock: StreamBlock = {
                    id: `edit-event-${editBlockIdCounter++}`,
                    type: 'event',
                    content: '',
                    data: editEventCard.data
                  };
                  collectedBlocks.push(editEventBlock);
                  setStreamedBlocks(prev => [...prev, editEventBlock]);
                }
                break;

              case 'done':
                // Flush any remaining buffered content
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processEditContentBuffer(true);
                
                // Calculate thinking duration
                const editThinkingDuration = thinkingStartTime 
                  ? Math.round((Date.now() - thinkingStartTime) / 1000) 
                  : undefined;
                  
                const editAiMessage: Message = {
                  id: `ai-${Date.now()}`,
                  role: 'assistant',
                  content: collectedContent,
                  contentBlocks: collectedBlocks,  // Store blocks for final rendering
                  dataCards: collectedDataCards,
                  eventData: eventData,
                  thinkingSteps: collectedThinking,
                  thinkingDuration: editThinkingDuration,
                  timestamp: new Date()
                };
                setMessages(prev => [...prev, editAiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedBlocks([]);  // Clear streamed blocks
                setStreamingDataCards([]);
                break;
            }
          }
        }
      };

      // Continue reading the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.log('📦 Received chunk (edit mode, length:', chunk.length, ')');
        
        buffer += chunk;
        
        const { messages: completeMessages, remaining } = parseSSEStream(buffer);
        console.log('✅ Found', completeMessages.length, 'complete messages (edit mode)');
        
        buffer = remaining;

        processMessages(completeMessages);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsStreaming(false);
    } finally {
      setIsTyping(false);
      sendingRef.current = false; // Reset the flag
    }
  };

  if (chatState === 'collapsed') {
    return (
      <div className="mb-6 mt-1">
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={handleExpand}
        >
          <div className="flex items-center gap-3 p-4">
            <div className="w-10 h-10 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Ask Catalyst AI</h3>
              <p className="text-xs text-muted-foreground">Chat about your stocks and events</p>
            </div>
            <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </div>
        </Card>
      </div>
    );
  }

  if (chatState === 'inline-expanded') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="inline-expanded"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="my-6 overflow-hidden"
        >
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <h3 className="font-semibold">Catalyst Copilot</h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={handleCollapse}
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {messages.length > 0 && (
              <div className="max-h-32 overflow-y-auto p-4 space-y-2">
                {messages.slice(-2).map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-ai-accent text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      <p className="line-clamp-2">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {messages.length === 0 && (
              <div className="p-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium">Quick start:</p>
                <div className="flex flex-wrap gap-2">
                  {quickStartChips.map((chip, index) => (
                    <Badge
                      key={chip}
                      variant="outline"
                      className="cursor-pointer hover:bg-ai-accent hover:text-white transition-all hover:scale-105 rounded-full border-2"
                      onClick={() => handleQuickStart(chip)}
                    >
                      {chip}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 border-t border-border">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef as any}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    // Auto-resize textarea
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      // Don't send if already sending or if input is empty
                      if (!sendingRef.current && !isStreaming && !isTyping && inputValue.trim()) {
                        handleSendMessage(inputValue);
                      }
                      // Reset height after sending
                      if (inputRef.current) {
                        (inputRef.current as any).style.height = 'auto';
                      }
                    }
                  }}
                  placeholder={isStreaming ? "AI is thinking..." : "Ask about any stock or your watchlist…"}
                  className="flex-1 bg-input-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none overflow-y-auto min-h-[36px] max-h-[120px]"
                  rows={1}
                  disabled={isStreaming || isTyping}
                />
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    size="sm"
                    className={`h-9 w-9 p-0 rounded-full transition-all ${
                      inputValue.trim() 
                        ? 'bg-gradient-to-r from-ai-accent to-ai-accent/80 shadow-md' 
                        : ''
                    }`}
                    onClick={() => {
                      // Don't send if already sending or if input is empty
                      if (!sendingRef.current && !isStreaming && !isTyping && inputValue.trim()) {
                        handleSendMessage(inputValue);
                      }
                    }}
                    disabled={!inputValue.trim() || isStreaming || isTyping}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </motion.div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                Powered by OpenAI + Catalyst data
              </p>
            </div>
          </Card>
        </motion.div>
      </AnimatePresence>
    );
  }

  if (chatState === 'minimized') {
    return (
      <>
        <div className="mb-6 mt-1">
          <Card 
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={handleOpenFullWindow}
          >
            <div className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">Ask Catalyst AI</h3>
                <p className="text-xs text-muted-foreground">Chat about your stocks and events</p>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </div>
          </Card>
        </div>
        
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          className="fixed bottom-20 right-4 z-50"
        >
          <button
            onClick={handleOpenFullWindow}
            className="w-14 h-14 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow"
          >
            <Sparkles className="w-6 h-6 text-primary-foreground" />
            {messages.length > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center text-[10px] text-white font-semibold">
                !
              </div>
            )}
          </button>
        </motion.div>
      </>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="full-window"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-0 z-50 bg-background flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <h2 className="font-semibold">Catalyst Copilot</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleMinimize}
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleClose}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={chatContainerRef}>
          {messages.length === 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center justify-center h-full"
            >
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
                className="w-16 h-16 bg-gradient-to-br from-ai-accent via-purple-500 to-blue-500 rounded-full flex items-center justify-center mb-4 shadow-lg"
              >
                <Sparkles className="w-8 h-8 text-white" />
              </motion.div>
              <motion.h3 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="font-semibold mb-2 text-lg"
              >
                Start a conversation
              </motion.h3>
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-muted-foreground mb-6 text-center max-w-xs"
              >
                Ask me anything about your stocks, watchlist, or market events
              </motion.p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {quickStartChips.map((chip, index) => (
                  <motion.div
                    key={chip}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + (index * 0.05) }}
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-ai-accent hover:text-white transition-all hover:scale-105 rounded-full px-4 py-1.5 border-2"
                      onClick={() => handleQuickStart(chip)}
                    >
                      {chip}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {messages.map((msg, index) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`${msg.role === 'user' ? 'max-w-[85%]' : 'w-full'} ${msg.role === 'assistant' ? 'space-y-3' : ''}`}>
                {/* AI Avatar for assistant messages */}
                {msg.role === 'assistant' && (
                  <motion.div 
                    ref={index === messages.length - 1 && msg.role === 'assistant' ? latestMessageRef : null}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="flex items-center gap-2 mb-2"
                  >
                    <span className="text-xs font-medium text-muted-foreground">Catalyst AI</span>
                  </motion.div>
                )}
                
                {editingMessageId === msg.id && msg.role === 'user' ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editInputRef as any}
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmitEdit(msg.id);
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      className="w-full bg-input-background rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none min-h-[44px]"
                      rows={Math.max(2, editingValue.split('\n').length)}
                      disabled={isTyping}
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={isTyping}
                        className="h-8"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSubmitEdit(msg.id)}
                        disabled={!editingValue.trim() || isTyping}
                        className="h-8"
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Submit
                      </Button>
                    </div>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2"
                  >
                    {/* Show thinking steps for assistant messages if available */}
                    {msg.role === 'assistant' && msg.thinkingSteps && msg.thinkingSteps.length > 0 && (() => {
                      // Check if this is the currently streaming message
                      const isCurrentlyStreaming = index === messages.length - 1 && isStreaming && thinkingSteps.length > 0;
                      // Get the current thinking step (last one in the array during streaming)
                      const currentThinkingText = isCurrentlyStreaming && thinkingSteps.length > 0
                        ? thinkingSteps[thinkingSteps.length - 1].content
                        : null;
                      
                      return (
                        <details className="rounded-2xl border border-border/50 overflow-hidden bg-gradient-to-br from-muted/40 to-muted/20 backdrop-blur-sm mb-2 max-w-[85%]">
                          <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors list-none">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Sparkles className="w-4 h-4 text-ai-accent flex-shrink-0" />
                              <span className={`text-xs font-medium ${
                                isCurrentlyStreaming && currentThinkingText
                                  ? 'thinking-text-animated'
                                  : 'text-muted-foreground'
                              } truncate`}>
                                {isCurrentlyStreaming && currentThinkingText
                                  ? currentThinkingText
                                  : msg.thinkingDuration
                                    ? `Thought for ${msg.thinkingDuration}s`
                                    : 'View thinking process'
                                }
                              </span>
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          </summary>
                          <div className="px-4 pb-3 space-y-2">
                            {msg.thinkingSteps.map((step, index) => (
                              <div
                                key={`${msg.id}-thinking-${index}`}
                                className="text-xs text-muted-foreground flex items-start gap-2"
                              >
                                <div className="w-1 h-1 rounded-full bg-ai-accent mt-1.5 flex-shrink-0" />
                                <span>{step.content}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      );
                    })()}

                    <div
                      className={`${
                        msg.role === 'user'
                          ? 'rounded-2xl px-4 py-3 bg-gradient-to-br from-ai-accent to-ai-accent/90 text-primary-foreground shadow-md'
                          : 'text-foreground'
                      }`}
                    >
                      {/* Use contentBlocks if available (from streaming), otherwise parse content with MarkdownText */}
                      {msg.contentBlocks && msg.contentBlocks.length > 0 ? (
                        <StreamBlockRenderer 
                          blocks={msg.contentBlocks} 
                          dataCards={msg.dataCards} 
                          onEventClick={onEventClick} 
                          onImageClick={setFullscreenImage} 
                          onTickerClick={onTickerClick} 
                        />
                      ) : (
                        <MarkdownText text={msg.content} dataCards={msg.dataCards} onEventClick={onEventClick} onImageClick={setFullscreenImage} onTickerClick={onTickerClick} />
                      )}
                    </div>

                    {msg.role === 'user' && !isTyping && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditMessage(msg.id, msg.content)}
                          className="h-7 text-xs opacity-60 hover:opacity-100 transition-opacity"
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}

                    {/* Render non-inline cards at the bottom (stock cards, charts that aren't referenced inline) */}
                    {msg.dataCards && msg.dataCards.filter(card => {
                      // Exclude event cards (they're inline)
                      if (card.type === 'event') return false;
                      // Exclude image cards completely - they should only appear inline
                      if (card.type === 'image') return false;
                      // Exclude article cards - they're rendered inline via VIEW_ARTICLE markers
                      if (card.type === 'article') return false;
                      // Exclude chart cards - they're rendered inline via VIEW_CHART markers
                      if (card.type === 'chart') return false;
                      return true;
                    }).length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className="space-y-2"
                      >
                        {msg.dataCards.filter(card => {
                          if (card.type === 'event') return false;
                          if (card.type === 'image') return false;
                          if (card.type === 'article') return false;
                          if (card.type === 'chart') return false;
                          return true;
                        }).map((card, index) => {
                          // Generate a unique key based on card type, data, and index
                          const cardKey = card.type === 'stock' 
                            ? `${msg.id}-stock-${card.data?.ticker || 'unknown'}-${index}` 
                            : card.type === 'chart'
                            ? `${msg.id}-chart-${card.data?.ticker || 'unknown'}-${index}`
                            : card.type === 'event-list'
                            ? `${msg.id}-event-list-${index}`
                            : `${msg.id}-card-${index}`;
                          
                          return (
                            <motion.div
                              key={cardKey}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3, delay: 0.1 + (index * 0.05) }}
                            >
                              <DataCardComponent card={card} onEventClick={onEventClick} onImageClick={setFullscreenImage} onTickerClick={onTickerClick} />
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming Message with Thinking Box */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="w-full space-y-3">
                {/* AI Avatar */}
                <div 
                  ref={latestMessageRef}
                  className="flex items-center gap-2 mb-2"
                >
                  <span className="text-xs font-medium text-muted-foreground">Catalyst AI</span>
                </div>

                {/* Streaming Non-Inline Data Cards - Show First (stock cards, charts that aren't referenced inline) */}
                {streamingDataCards.filter(card => {
                  // Exclude event cards (they're inline)
                  if (card.type === 'event') return false;
                  // Exclude image cards completely - they should only appear inline
                  if (card.type === 'image') return false;
                  // Exclude article cards - they're rendered inline via VIEW_ARTICLE markers
                  if (card.type === 'article') return false;
                  // Exclude chart cards - they're rendered inline via VIEW_CHART markers
                  if (card.type === 'chart') return false;
                  return true;
                }).length > 0 && (
                  <div 
                    className="space-y-2"
                    style={{ willChange: 'contents' }}
                  >
                    {streamingDataCards.filter(card => {
                      if (card.type === 'event') return false;
                      if (card.type === 'image') return false;
                      if (card.type === 'article') return false;
                      if (card.type === 'chart') return false;
                      return true;
                    }).map((card, index) => {
                      // Generate a unique key based on card type, data, and index
                      const cardKey = card.type === 'stock' 
                        ? `streaming-stock-${card.data?.ticker || 'unknown'}-${index}` 
                        : card.type === 'chart'
                        ? `streaming-chart-${card.data?.ticker || 'unknown'}-${index}`
                        : card.type === 'event-list'
                        ? `streaming-event-list-${index}`
                        : `streaming-card-${index}`;
                      
                      return (
                        <div
                          key={cardKey}
                          style={{ willChange: 'opacity' }}
                        >
                          <DataCardComponent card={card} onEventClick={onEventClick} onImageClick={setFullscreenImage} onTickerClick={onTickerClick} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Loading indicator before thinking starts */}
                {thinkingSteps.length === 0 && streamedBlocks.length === 0 && streamingDataCards.length === 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-1.5 px-2 py-1"
                  >
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                    />
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                    />
                  </motion.div>
                )}

                {/* Thinking Box (ChatGPT style) */}
                {thinkingSteps.length > 0 && (
                  <div 
                    className={`rounded-2xl border border-border/50 overflow-hidden bg-gradient-to-br from-muted/40 to-muted/20 backdrop-blur-sm max-w-[85%]`}
                    style={{ willChange: 'contents' }}
                  >
                    <div 
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setThinkingCollapsed(!thinkingCollapsed)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          className="flex-shrink-0"
                        >
                          <Sparkles className="w-4 h-4 text-ai-accent" />
                        </motion.div>
                        <span className="text-xs font-medium thinking-text-animated truncate">
                          {thinkingSteps.length > 0 ? thinkingSteps[thinkingSteps.length - 1].content : 'Thinking...'}
                        </span>
                      </div>
                      <motion.div
                        animate={{ rotate: thinkingCollapsed ? -90 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex-shrink-0"
                      >
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </motion.div>
                    </div>
                    
                    {!thinkingCollapsed && (
                      <div className="px-4 pb-3 space-y-2">
                        {thinkingSteps.map((step, index) => (
                          <div
                            key={`streaming-thinking-${index}`}
                            className="text-xs text-muted-foreground flex items-start gap-2"
                          >
                            <div className="w-1 h-1 rounded-full bg-ai-accent mt-1.5 flex-shrink-0" />
                            <span>{step.content}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Streamed Content Blocks - Rendered inline in final form with Typing Cursor */}
                {streamedBlocks.length > 0 && (
                  <div 
                    className="text-foreground"
                    style={{ 
                      willChange: 'contents',
                      contain: 'layout style',
                      contentVisibility: 'auto'
                    }}
                  >
                    <StreamBlockRenderer 
                      blocks={streamedBlocks} 
                      dataCards={streamingDataCards} 
                      onEventClick={onEventClick} 
                      onImageClick={setFullscreenImage} 
                      onTickerClick={onTickerClick} 
                    />
                    <span
                      className="inline-block w-[2px] h-4 bg-foreground/60 ml-0.5 animate-pulse"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {isTyping && !isStreaming && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="flex items-center gap-2">
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="w-7 h-7 bg-gradient-to-br from-ai-accent via-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-md"
                >
                  <Sparkles className="w-4 h-4 text-white" />
                </motion.div>
                <div className="bg-gradient-to-br from-muted/80 to-muted/60 backdrop-blur-sm rounded-2xl px-4 py-3 border border-border/50">
                  <div className="flex items-center gap-1.5">
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                    />
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.div 
                      className="w-2 h-2 bg-ai-accent rounded-full"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 pb-24 border-t border-border bg-background">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef as any}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                // Auto-grow height
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Don't send if already sending or if input is empty
                  if (!sendingRef.current && !isStreaming && !isTyping && inputValue.trim()) {
                    handleSendMessage(inputValue);
                  }
                  // Reset height after sending
                  if (inputRef.current) {
                    (inputRef.current as any).style.height = 'auto';
                  }
                }
              }}
              placeholder={isStreaming ? "AI is thinking..." : "Ask anything"}
              className="flex-1 bg-input-background rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none overflow-y-auto min-h-[44px] max-h-[120px]"
              rows={1}
              disabled={isStreaming || isTyping}
            />
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                size="sm"
                className={`h-11 w-11 p-0 rounded-full transition-all ${
                  inputValue.trim() && !isTyping && !isStreaming
                    ? 'bg-gradient-to-r from-ai-accent to-ai-accent/80 shadow-lg' 
                    : ''
                }`}
                onClick={() => {
                  // Don't send if already sending or if input is empty
                  if (!sendingRef.current && !isStreaming && !isTyping && inputValue.trim()) {
                    handleSendMessage(inputValue);
                  }
                }}
                disabled={!inputValue.trim() || isTyping || isStreaming}
              >
                <motion.div
                  animate={inputValue.trim() && !isTyping ? { 
                    scale: [1, 1.1, 1],
                  } : {}}
                  transition={{ 
                    duration: 1.5, 
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  <Send className="w-5 h-5" />
                </motion.div>
              </Button>
            </motion.div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-[8px] text-center mr-[0px] mb-[-30px] ml-[0px]">
            Powered by OpenAI + Catalyst data (Supabase)
          </p>
        </div>
      </motion.div>

      {/* Fullscreen Image Modal */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4"
            onClick={() => setFullscreenImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setFullscreenImage(null)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                aria-label="Close fullscreen image"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={fullscreenImage}
                alt="SEC Filing Image - Fullscreen"
                className="max-w-full max-h-full object-contain rounded-lg"
                onClick={() => setFullscreenImage(null)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}

/**
 * StreamBlockRenderer - Renders pre-processed streaming blocks in their final form
 * Each block renders immediately as text, chart, or card - no post-processing needed
 */
function StreamBlockRenderer({ 
  blocks, 
  dataCards,
  onEventClick, 
  onImageClick, 
  onTickerClick 
}: { 
  blocks: StreamBlock[];
  dataCards?: DataCard[];
  onEventClick?: (event: MarketEvent) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
}) {
  return (
    <div className="space-y-0">
      {blocks.map((block) => {
        switch (block.type) {
          case 'text':
            return (
              <div key={block.id}>
                <MarkdownText 
                  text={block.content} 
                  dataCards={dataCards} 
                  onEventClick={onEventClick} 
                  onImageClick={onImageClick} 
                  onTickerClick={onTickerClick} 
                />
              </div>
            );
          
          case 'chart':
            return (
              <div key={block.id} className="my-3">
                <InlineChartCard 
                  symbol={block.data.symbol} 
                  timeRange={block.data.timeRange} 
                  onTickerClick={onTickerClick} 
                />
              </div>
            );
          
          case 'article':
            const articleCard: DataCard = { type: 'article', data: block.data };
            return (
              <div key={block.id} className="my-3">
                <DataCardComponent 
                  card={articleCard} 
                  onEventClick={onEventClick} 
                  onImageClick={onImageClick} 
                  onTickerClick={onTickerClick} 
                />
              </div>
            );
          
          case 'image':
            const imageCard: DataCard = { type: 'image', data: block.data };
            return (
              <div key={block.id} className="my-3">
                <DataCardComponent 
                  card={imageCard} 
                  onEventClick={onEventClick} 
                  onImageClick={onImageClick} 
                  onTickerClick={onTickerClick} 
                />
              </div>
            );
          
          case 'event':
            const eventCard: DataCard = { type: 'event', data: block.data };
            return (
              <div key={block.id} className="my-3">
                <DataCardComponent 
                  card={eventCard} 
                  onEventClick={onEventClick} 
                  onImageClick={onImageClick} 
                  onTickerClick={onTickerClick} 
                />
              </div>
            );
          
          case 'separator':
            return (
              <div key={block.id} className="my-4">
                <div className="h-px bg-gradient-to-r from-transparent via-neutral-300 dark:via-neutral-700 to-transparent" />
              </div>
            );
          
          default:
            return null;
        }
      })}
    </div>
  );
}

