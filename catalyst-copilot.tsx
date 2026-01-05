import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Send, 
  X, 
  Minimize2, 
  MoreVertical,
  TrendingUp,
  TrendingDown,
  Package,
  BarChart3,
  Users,
  Shield,
  ShoppingCart,
  Handshake,
  Target,
  AlertCircle,
  Building,
  Tag,
  DollarSign,
  Calendar,
  Circle,
  Presentation,
  Edit2,
  Check,
  XCircle,
  Scale,
  Landmark,
  Loader2
} from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { SimpleMiniChart } from './simple-mini-chart';
import { IntradayMiniChart } from './intraday-mini-chart';
import { formatCurrency, getEventTypeConfig, formatEventDateTime } from '../utils/formatting';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { MarketEvent } from '../utils/supabase/events-api';

type ChatState = 'collapsed' | 'inline-expanded' | 'full-window' | 'minimized';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  dataCards?: DataCard[];
  eventData?: Record<string, any>;
  timestamp: Date;
}

interface DataCard {
  type: 'stock' | 'event-list' | 'event' | 'chart';
  data: any;
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
  previousClose?: number;
}

interface CatalystCopilotProps {
  selectedTickers?: string[];
  onEventClick?: (event: MarketEvent) => void;
}

// Markdown Renderer Component
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  
  let currentList: string[] = [];
  
  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="space-y-1 my-2 ml-4">
          {currentList.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5">•</span>
              <span className="flex-1">{parseInlineFormatting(item)}</span>
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };
  
  const parseInlineFormatting = (line: string) => {
    const parts: (string | JSX.Element)[] = [];
    let currentText = line;
    let key = 0;
    
    const boldRegex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    
    while ((match = boldRegex.exec(currentText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(currentText.substring(lastIndex, match.index));
      }
      parts.push(<strong key={`bold-${key++}`}>{match[1]}</strong>);
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < currentText.length) {
      parts.push(currentText.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : currentText;
  };
  
  lines.forEach((line, index) => {
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${index}`} className="font-semibold mt-3 mb-1">
          {parseInlineFormatting(line.substring(4))}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${index}`} className="font-semibold text-base mt-3 mb-1">
          {parseInlineFormatting(line.substring(3))}
        </h2>
      );
    } else if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={`h1-${index}`} className="font-semibold text-lg mt-3 mb-1">
          {parseInlineFormatting(line.substring(2))}
        </h1>
      );
    } else if (line.trim().startsWith('- ')) {
      currentList.push(line.trim().substring(2));
    } else if (line.trim()) {
      flushList();
      elements.push(
        <p key={`p-${index}`} className="my-1">
          {parseInlineFormatting(line)}
        </p>
      );
    } else {
      flushList();
    }
  });
  
  flushList();
  
  return <div className="space-y-0.5">{elements}</div>;
}

export function CatalystCopilot({ selectedTickers = [], onEventClick }: CatalystCopilotProps) {
  const [chatState, setChatState] = useState<ChatState>('collapsed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isRestoringScroll = useRef(false);

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

  const scrollToBottom = () => {
    if (!isRestoringScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (!isRestoringScroll.current) {
      scrollToBottom();
    }
  }, [messages]);

  const quickStartChips = [
    "What moved TSLA today?",
    "Biggest movers in my watchlist?",
    "Explain today's market in simple terms"
  ];

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;

    console.log('User input message:', message);

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    if (chatState === 'inline-expanded') {
      setChatState('full-window');
    }

    try {
      console.log('🌐 Current origin:', window.location.origin);
      console.log('🌐 Current hostname:', window.location.hostname);
      console.log('🚀 Sending chat request to DigitalOcean...');
      console.log('Message:', inputValue);
      console.log('Selected tickers:', selectedTickers);
      
      const response = await fetch('https://catalyst-copilot-2nndy.ondigitalocean.app/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'omit', // Don't send credentials
        body: JSON.stringify({
          message: inputValue,
          conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
          selectedTickers
        })
      });

      console.log('📥 Response status:', response.status);
      console.log('📥 Response headers:', [...response.headers.entries()]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Chat response:', data);

      // Detect if this is an event listing query where user expects data cards
      const isEventListingQuery = /what are.*event|list.*event|show.*event|upcoming event|legal.*event|regulatory.*event/i.test(message);

      const tickersInResponse = new Set<string>();
      const tickerPattern = /\b([A-Z]{2,5})\b/g;
      const tickerMatches = data.response.match(tickerPattern);
      if (tickerMatches) {
        const excludeWords = ['AI', 'US', 'IT', 'CEO', 'CFO', 'CTO', 'IPO', 'ETF', 'REIT', 'SEC', 'FDA', 'FTC', 'DOJ'];
        tickerMatches.forEach((ticker: string) => {
          if (!excludeWords.includes(ticker) && ticker.length >= 2 && ticker.length <= 5) {
            tickersInResponse.add(ticker);
          }
        });
      }

      // For event listing queries, also extract tickers from data cards themselves
      if (isEventListingQuery && data.dataCards && data.dataCards.length > 0) {
        data.dataCards.forEach((card: DataCard) => {
          if (card.type === 'event' && card.data?.ticker) {
            tickersInResponse.add(card.data.ticker);
          }
        });
      }

      if (tickersInResponse.size === 0 && selectedTickers.length > 0) {
        selectedTickers.forEach(ticker => tickersInResponse.add(ticker));
      }

      let filteredDataCards = data.dataCards || [];
      // Skip filtering for event listing queries - show all cards the backend returned
      if (!isEventListingQuery && tickersInResponse.size > 0 && filteredDataCards.length > 0) {
        filteredDataCards = filteredDataCards.filter((card: DataCard) => {
          if (card.type === 'event' && card.data?.ticker) {
            return tickersInResponse.has(card.data.ticker);
          }
          if (card.type === 'stock' && card.data?.ticker) {
            return tickersInResponse.has(card.data.ticker);
          }
          return true;
        });
      }

      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        dataCards: filteredDataCards,
        eventData: data.eventData || {},
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      
      // More detailed error logging
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
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickStart = (question: string) => {
    handleSendMessage(question);
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

    console.log('User edited message:', editingValue);

    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

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

    try {
      const response = await fetch('https://catalyst-copilot-2nndy.ondigitalocean.app/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: editingValue,
          conversationHistory: messagesBeforeEdit.map(m => ({ role: m.role, content: m.content })),
          selectedTickers
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Chat API error:', response.status, response.statusText, errorText);
        throw new Error(`Failed to get response from AI: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('Chat response:', data);

      // Detect if this is an event listing query where user expects data cards
      const isEventListingQuery = /what are.*event|list.*event|show.*event|upcoming event|legal.*event|regulatory.*event/i.test(editingValue);

      const tickersInResponse = new Set<string>();
      const tickerPattern = /\b([A-Z]{2,5})\b/g;
      const tickerMatches = data.response.match(tickerPattern);
      if (tickerMatches) {
        const excludeWords = ['AI', 'US', 'IT', 'CEO', 'CFO', 'CTO', 'IPO', 'ETF', 'REIT', 'SEC', 'FDA', 'FTC', 'DOJ'];
        tickerMatches.forEach((ticker: string) => {
          if (!excludeWords.includes(ticker) && ticker.length >= 2 && ticker.length <= 5) {
            tickersInResponse.add(ticker);
          }
        });
      }

      // For event listing queries, also extract tickers from data cards themselves
      if (isEventListingQuery && data.dataCards && data.dataCards.length > 0) {
        data.dataCards.forEach((card: DataCard) => {
          if (card.type === 'event' && card.data?.ticker) {
            tickersInResponse.add(card.data.ticker);
          }
        });
      }

      if (tickersInResponse.size === 0 && selectedTickers.length > 0) {
        selectedTickers.forEach(ticker => tickersInResponse.add(ticker));
      }

      let filteredDataCards = data.dataCards || [];
      // Skip filtering for event listing queries - show all cards the backend returned
      if (!isEventListingQuery && tickersInResponse.size > 0 && filteredDataCards.length > 0) {
        filteredDataCards = filteredDataCards.filter((card: DataCard) => {
          if (card.type === 'event' && card.data?.ticker) {
            return tickersInResponse.has(card.data.ticker);
          }
          if (card.type === 'stock' && card.data?.ticker) {
            return tickersInResponse.has(card.data.ticker);
          }
          return true;
        });
      }

      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        dataCards: filteredDataCards,
        eventData: data.eventData || {},
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
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
                <p className="text-xs text-muted-foreground mb-3">Quick start:</p>
                <div className="flex flex-wrap gap-2">
                  {quickStartChips.map((chip, index) => (
                    <Badge
                      key={index}
                      variant="outline"
                      className="cursor-pointer hover:bg-accent rounded"
                      onClick={() => handleQuickStart(chip)}
                    >
                      {chip}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(inputValue);
                    }
                  }}
                  placeholder="Ask about any stock or your watchlist…"
                  className="flex-1 bg-input-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => handleSendMessage(inputValue)}
                  disabled={!inputValue.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
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
    <AnimatePresence>
      <motion.div
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
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-16 h-16 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="font-semibold mb-2">Start a conversation</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-xs">
                Ask me anything about your stocks, watchlist, or market events
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {quickStartChips.map((chip, index) => (
                  <Badge
                    key={index}
                    variant="outline"
                    className="cursor-pointer hover:bg-accent rounded"
                    onClick={() => handleQuickStart(chip)}
                  >
                    {chip}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] ${msg.role === 'assistant' ? 'space-y-3' : ''}`}>
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
                  <div className="space-y-2">
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-ai-accent text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      <MarkdownText text={msg.content} />
                    </div>

                    {msg.role === 'user' && !isTyping && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditMessage(msg.id, msg.content)}
                          className="h-7 text-xs"
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}

                    {msg.dataCards && msg.dataCards.length > 0 && (
                      <div className="space-y-2">
                        {msg.dataCards.map((card, index) => (
                          <DataCardComponent key={index} card={card} onEventClick={onEventClick} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 pb-24 border-t border-border bg-background">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(inputValue);
                }
              }}
              placeholder="Ask anything about your stocks, watchlist, or events…"
              className="flex-1 bg-input-background rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              size="sm"
              className="h-11 w-11 p-0 rounded-full"
              onClick={() => handleSendMessage(inputValue)}
              disabled={!inputValue.trim() || isTyping}
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-[8px] text-center mr-[0px] mb-[-30px] ml-[0px]">
            Powered by OpenAI + Catalyst data (Supabase)
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function DataCardComponent({ card, onEventClick }: { card: DataCard; onEventClick?: (event: MarketEvent) => void }) {
  const eventTypeIcons: Record<string, any> = {
    earnings: BarChart3,
    fda: AlertCircle,
    merger: Target,
    split: TrendingUp,
    dividend: DollarSign,
    launch: Sparkles,
    product: Package,
    capital_markets: DollarSign,
    legal: Scale,
    commerce_event: ShoppingCart,
    investor_day: Presentation,
    conference: Users,
    regulatory: Landmark,
    guidance_update: TrendingUp,
    partnership: Handshake,
    corporate: Building,
    pricing: Tag,
    defense_contract: Shield,
    guidance: TrendingUp
  };

  if (card.type === 'stock') {
    return <StockCard data={card.data as StockCardData} />;
  }

  if (card.type === 'event') {
    const { id, ticker, title, type, datetime, aiInsight, impact } = card.data;
    const eventConfig = getEventTypeConfig(type) || getEventTypeConfig('launch');
    
    const EventIcon = eventTypeIcons[type as keyof typeof eventTypeIcons] || eventTypeIcons.launch;
    
    const eventDate = datetime ? new Date(datetime) : null;
    const formattedDate = eventDate 
      ? eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'TBD';

    const handleClick = () => {
      if (onEventClick && id) {
        const marketEvent: MarketEvent = {
          id: id,
          ticker: ticker,
          title: title,
          type: type,
          actualDateTime: datetime,
          actualDateTime_et: datetime,
          aiInsight: aiInsight,
          impact: impact,
          description: aiInsight || '',
          company: ticker
        };
        onEventClick(marketEvent);
      }
    };

    return (
      <Card 
        className="p-3 cursor-pointer hover:shadow-md transition-shadow"
        onClick={handleClick}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full ${eventConfig.color} flex items-center justify-center flex-shrink-0`}>
            <EventIcon className="w-5 h-5 text-white" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="!bg-black !text-white !border-black text-xs rounded">
                {ticker}
              </Badge>
              <span className="text-xs text-muted-foreground">{eventConfig.label}</span>
            </div>
            <p className="text-sm font-medium mb-1 line-clamp-2">{title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span>{formattedDate}</span>
            </div>
            {aiInsight && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{aiInsight}</p>
            )}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-[-15px] mr-[0px] mb-[0px] ml-[0px]">Data from Catalyst (Supabase)</p>
      </Card>
    );
  }

  if (card.type === 'event-list') {
    const { events } = card.data;

    return (
      <Card className="p-3">
        <h4 className="font-semibold text-sm mb-2">Upcoming Events</h4>
        <div className="space-y-2">
          {events.slice(0, 3).map((event: any, index: number) => (
            <div key={index} className="flex items-center gap-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${event.color || 'bg-muted-foreground'}`} />
              <span className="font-medium">{formatEventDateTime(event.date)}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{getEventTypeConfig(event.type)?.label || event.type}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Data from Catalyst (Supabase)</p>
      </Card>
    );
  }

  return null;
}

function StockCard({ data }: { data: StockCardData }) {
  const { ticker, company, price, change, changePercent, chartData, chartMetadata, previousClose } = data;
  const [loadedChartData, setLoadedChartData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const isPositive = (change || 0) >= 0;

  // Calculate previous close if not provided
  const calculatedPreviousClose = previousClose || (change != null ? price - change : null);

  // Fetch chart data if metadata is available but chartData is not provided
  useEffect(() => {
    if (chartMetadata?.available && !chartData && !loadedChartData && !isLoading && !error) {
      setIsLoading(true);
      fetch(`https://${projectId}.supabase.co/functions/v1${chartMetadata.endpoint}`, {
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`
        }
      })
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch chart data');
          return res.json();
        })
        .then(result => {
          console.log('Fetched intraday chart data:', result);
          setLoadedChartData(result.prices || []);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Chart fetch error:', err);
          setError(true);
          setIsLoading(false);
        });
    }
  }, [chartMetadata, chartData, loadedChartData, isLoading, error, ticker]);

  // Use loaded chart data if available, otherwise fall back to chartData
  const effectiveChartData = loadedChartData || chartData;

  // Detect if this is intraday-only data (all timestamps from the same calendar day)
  const isIntradayOnly = effectiveChartData && effectiveChartData.length > 0 && (() => {
    const firstDate = new Date(typeof effectiveChartData[0].timestamp === 'string' ? effectiveChartData[0].timestamp : effectiveChartData[0].timestamp);
    const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    
    return effectiveChartData.every((point: any) => {
      const pointDate = new Date(typeof point.timestamp === 'string' ? point.timestamp : point.timestamp);
      const pointDay = new Date(pointDate.getFullYear(), pointDate.getMonth(), pointDate.getDate());
      return pointDay.getTime() === firstDay.getTime();
    });
  })();

  const hasChart = chartMetadata?.available || (effectiveChartData && effectiveChartData.length > 0);

  return (
    <Card className="p-3">
      {!isIntradayOnly && (
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-ai-accent text-primary-foreground text-xs rounded">
                {ticker}
              </Badge>
              {company && company !== ticker && (
                <span className="text-xs text-muted-foreground">{company}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold">{formatCurrency(price)}</div>
            {changePercent != null && (
              <div className={`text-xs flex items-center gap-1 justify-end ${isPositive ? 'text-positive' : 'text-negative'}`}>
                {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      )}
      {hasChart && (
        <>
          {isLoading ? (
            <div className="h-24 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading chart...</span>
            </div>
          ) : error ? (
            <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
              Chart unavailable
            </div>
          ) : effectiveChartData && effectiveChartData.length > 0 ? (
            <>
              {isIntradayOnly ? (
                <IntradayMiniChart 
                  data={effectiveChartData.map((point: any) => ({
                    timestamp: typeof point.timestamp === 'string' ? new Date(point.timestamp).getTime() : point.timestamp,
                    value: point.price || point.value || 0
                  }))}
                  previousClose={calculatedPreviousClose}
                  currentPrice={price}
                  ticker={ticker}
                  company={company}
                  upcomingEventsCount={0}
                />
              ) : (
                <div className="h-12">
                  <SimpleMiniChart data={effectiveChartData} ticker={ticker} />
                </div>
              )}
            </>
          ) : null}
        </>
      )}
      <p className="text-[10px] text-muted-foreground mt-2">Data from Catalyst (Supabase)</p>
    </Card>
  );
}