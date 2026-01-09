import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Sparkles,
  Send,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  X,
  Minimize2,
  Edit2,
  Check,
  XCircle,
} from "lucide-react";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { MarketEvent } from "../../utils/supabase/events-api";
import {
  DataCard,
  ThinkingStep,
  ContentBlock as StreamBlock,
} from "./lib/StreamBlockTypes";
import MarkdownText from "./MarkdownText";
import InlineChartCard from "./InlineChartCard";
import DataCardComponent from "./DataCardComponent";
import { AnimatedTextBlock } from "./components/AnimatedTextBlock";

type ChatState =
  | "collapsed"
  | "inline-expanded"
  | "full-window"
  | "minimized";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentBlocks?: StreamBlock[]; // Pre-processed blocks from streaming (charts, articles, etc.)
  dataCards?: DataCard[];
  eventData?: Record<string, any>;
  timestamp: Date;
  thinkingSteps?: ThinkingStep[];
  thinkingDuration?: number; // Duration in seconds
}

interface CatalystCopilotProps {
  selectedTickers?: string[];
  onEventClick?: (event: MarketEvent) => void;
  onTickerClick?: (ticker: string) => void;
}

/**
 * Extract complete, renderable blocks from a content buffer
 * Returns blocks ready to render and remaining buffer content
 */
function extractStreamBlocks(
  buffer: string,
  dataCards: DataCard[],
): { blocks: StreamBlock[]; remaining: string } {
  const blocks: StreamBlock[] = [];
  let remaining = buffer;
  let blockId = 0;
  let iterationCount = 0;
  const maxIterations = 100; // Safety limit to prevent infinite loops

  console.log(`🔍 [extractStreamBlocks] Called with:`, {
    bufferLength: buffer.length,
    bufferPreview: buffer.substring(0, 200),
    dataCardsCount: dataCards?.length || 0,
    articleCardsAvailable:
      dataCards
        ?.filter((c) => c.type === "article")
        .map((c) => c.data.id) || [],
  });

  // Process the buffer looking for complete blocks
  while (remaining.length > 0) {
    iterationCount++;
    if (iterationCount > maxIterations) {
      console.error(
        "⚠️ [extractStreamBlocks] Hit maximum iteration limit! Breaking out of loop.",
      );
      break;
    }

    // First, check if there are ANY markers in the buffer (including [HR])
    const anyMarkerMatch = remaining.match(
      /\[(?:VIEW_CHART|VIEW_ARTICLE|IMAGE_CARD|EVENT_CARD):[^\]]+\]|\[HR\]/,
    );

    // If we have a marker that's NOT at the start, extract text before it first
    if (
      anyMarkerMatch &&
      anyMarkerMatch.index &&
      anyMarkerMatch.index > 0
    ) {
      const textContent = remaining.substring(
        0,
        anyMarkerMatch.index,
      );
      if (textContent.trim()) {
        blocks.push({
          id: `text-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
          type: "text",
          content: textContent,
        });
      }
      remaining = remaining.substring(anyMarkerMatch.index);
      continue;
    }

    // Check for [HR] (horizontal rule) marker - PRIORITIZE THIS EARLY
    const hrMatch = remaining.match(/^\s*\[HR\]\s*/);
    if (hrMatch) {
      console.log(
        `✅ [extractStreamBlocks] Creating HORIZONTAL_RULE block`,
      );
      blocks.push({
        id: `hr-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
        type: "horizontal_rule",
        content: "",
      });
      remaining = remaining.substring(hrMatch[0].length);
      continue;
    }

    // Check for VIEW_CHART marker at the start or after newlines
    const chartMatch = remaining.match(
      /^\s*\[VIEW_CHART:([^\]]+)\]\s*/,
    );
    if (chartMatch) {
      const chartData = chartMatch[1];
      let symbol, timeRange;

      // Parse format: either "SYMBOL:TIMERANGE" or "chart-SYMBOL"
      if (chartData.includes(":")) {
        const parts = chartData.split(":");
        symbol = parts[0];
        timeRange = parts[1];
      } else if (chartData.startsWith("chart-")) {
        symbol = chartData.replace("chart-", "");
        timeRange = "1D";
      } else {
        symbol = chartData;
        timeRange = "1D";
      }

      blocks.push({
        id: `chart-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
        type: "chart",
        content: "",
        data: { symbol, timeRange },
      });
      remaining = remaining.substring(chartMatch[0].length);
      continue;
    }

    // Check for VIEW_ARTICLE marker
    const articleMatch = remaining.match(
      /^(\s*)\[VIEW_ARTICLE:([^\]]+)\](\s*)/,
    );
    if (articleMatch) {
      const articleId = articleMatch[2].trim();
      console.log(
        `🎯 [extractStreamBlocks] Found VIEW_ARTICLE marker: ${articleId}`,
        {
          dataCardsCount: dataCards?.length || 0,
          articleCardsCount:
            dataCards?.filter((c) => c.type === "article")
              .length || 0,
        },
      );
      const articleCard = dataCards?.find(
        (c) => c.type === "article" && c.data.id === articleId,
      );
      if (articleCard) {
        console.log(
          `✅ [extractStreamBlocks] Creating ARTICLE block for: ${articleId}`,
          {
            blockType: "article",
            articleTitle: articleCard.data.title?.substring(
              0,
              50,
            ),
          },
        );
        blocks.push({
          id: `article-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
          type: "article",
          content: "",
          data: articleCard.data,
        });
        remaining = remaining.substring(articleMatch[0].length);
        continue;
      } else {
        // Card not found - the marker will be left in the content buffer
        // and rendered inline by MarkdownText component which also handles these markers
        console.log(
          `ℹ️ [extractStreamBlocks] Article card not found for ID: ${articleId}`,
          {
            articleId,
            availableArticleCards: dataCards
              ?.filter((c) => c.type === "article")
              .map((c) => c.data.id),
            totalDataCards: dataCards?.length || 0,
          },
        );
        // Don't break - continue processing other content
        break;
      }
    }

    // Check for IMAGE_CARD marker
    const imageMatch = remaining.match(
      /^(\s*)\[IMAGE_CARD:([^\]]+)\](\s*)/,
    );
    if (imageMatch) {
      const imageId = imageMatch[2].trim();
      const imageCard = dataCards?.find(
        (c) => c.type === "image" && c.data.id === imageId,
      );
      if (imageCard) {
        blocks.push({
          id: `image-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
          type: "image",
          content: "",
          data: imageCard.data,
        });
        remaining = remaining.substring(imageMatch[0].length);
        continue;
      } else {
        break;
      }
    }

    // Check for EVENT_CARD marker
    const eventMatch = remaining.match(
      /^(\s*)\[EVENT_CARD:([^\]]+)\](\s*)/,
    );
    if (eventMatch) {
      const eventId = eventMatch[2].trim();
      const eventCard = dataCards?.find(
        (c) =>
          c.type === "event" &&
          (c.data.id === eventId ||
            c.data.id?.toString() === eventId),
      );
      if (eventCard) {
        blocks.push({
          id: `event-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
          type: "event",
          content: "",
          data: eventCard.data,
        });
        remaining = remaining.substring(eventMatch[0].length);
        continue;
      } else {
        break;
      }
    }

    // Look for the next marker or paragraph break (include [HR] in the pattern)
    const nextMarkerMatch = remaining.match(
      /\[(?:VIEW_CHART|VIEW_ARTICLE|IMAGE_CARD|EVENT_CARD):[^\]]+\]|\[HR\]/,
    );
    const nextDoubleNewline = remaining.indexOf("\n\n");

    // Determine where to cut the text block
    let cutPoint = -1;

    if (
      nextMarkerMatch &&
      nextMarkerMatch.index !== undefined
    ) {
      if (
        nextDoubleNewline >= 0 &&
        nextDoubleNewline < nextMarkerMatch.index
      ) {
        cutPoint = nextDoubleNewline + 2;
      } else if (nextMarkerMatch.index === 0) {
        break;
      } else {
        cutPoint = nextMarkerMatch.index;
      }
    } else if (nextDoubleNewline >= 0) {
      cutPoint = nextDoubleNewline + 2;
    } else {
      // No markers found in the remaining buffer
      const hasIncomplete = hasIncompletePattern(remaining);
      if (hasIncomplete) {
        // Buffer ends with incomplete pattern - keep it for next chunk
        break;
      } else {
        // Check if buffer might start with a partial marker
        // Keep the buffer if it's less than 20 chars or if it ends with a potential marker start
        if (remaining.trim().length < 20) {
          break;
        }

        // Check if the buffer ends with something that might be the start of a marker
        // e.g., ends with "[", "[V", "[VI", "[VIEW", "[VIEW_", "[VIEW_A", "[VIEW_AR", etc.
        const potentialMarkerStart =
          /\[V?I?E?W?_?A?R?T?I?C?L?E?$/;
        if (potentialMarkerStart.test(remaining)) {
          // Might be a partial marker - keep it in buffer
          break;
        }

        cutPoint = remaining.length;
      }
    }

    if (cutPoint > 0) {
      const textContent = remaining.substring(0, cutPoint);
      if (textContent.trim()) {
        blocks.push({
          id: `text-${blockId++}-${Math.random().toString(36).substr(2, 5)}`,
          type: "text",
          content: textContent,
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
  const openBrackets = (str.match(/\[/g) || []).length;
  const closeBrackets = (str.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) return true;

  if (/\]\([^)]*$/.test(str)) return true;

  const boldMarkers = (str.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 !== 0) return true;

  if (/\[[^\]]*$/.test(str)) return true;

  return false;
}

export function CatalystCopilot({
  selectedTickers = [],
  onEventClick,
  onTickerClick,
}: CatalystCopilotProps) {
  const [chatState, setChatState] =
    useState<ChatState>("collapsed");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<
    string | null
  >(null);
  const [editingValue, setEditingValue] = useState("");
  const [fullscreenImage, setFullscreenImage] = useState<
    string | null
  >(null);
  const sendingRef = useRef(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<
    ThinkingStep[]
  >([]);
  const [streamedBlocks, setStreamedBlocks] = useState<
    StreamBlock[]
  >([]);
  const [streamingDataCards, setStreamingDataCards] = useState<
    DataCard[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isRestoringScroll = useRef(false);
  const prevIsStreamingRef = useRef(false);
  const userHasScrolledUp = useRef(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const savedChatState = localStorage.getItem(
        "catalyst_chat_state",
      );
      const savedMessages = localStorage.getItem(
        "catalyst_chat_messages",
      );
      const savedScrollPosition = localStorage.getItem(
        "catalyst_chat_scroll_position",
      );

      if (savedChatState) {
        setChatState(savedChatState as ChatState);
      }

      if (savedMessages) {
        const parsedMessages = JSON.parse(savedMessages);
        setMessages(parsedMessages);
      }

      if (
        savedScrollPosition &&
        savedChatState !== "collapsed"
      ) {
        isRestoringScroll.current = true;
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = parseInt(
              savedScrollPosition,
              10,
            );
          }
          setTimeout(() => {
            isRestoringScroll.current = false;
          }, 100);
        }, 50);
      }
    } catch (error) {
      console.error("Error restoring chat state:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("catalyst_chat_state", chatState);
    } catch (error) {
      console.error("Error saving chat state:", error);
    }
  }, [chatState]);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem(
          "catalyst_chat_messages",
          JSON.stringify(messages),
        );
      }
    } catch (error) {
      console.error("Error saving chat messages:", error);
    }
  }, [messages]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      // Track if user has scrolled up away from bottom (for smart auto-scroll)
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      userHasScrolledUp.current = distanceFromBottom > 100; // 100px threshold
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        try {
          localStorage.setItem(
            "catalyst_chat_scroll_position",
            container.scrollTop.toString(),
          );
        } catch (error) {
          console.error("Error saving scroll position:", error);
        }
      }, 100);
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [chatState]);

  const scrollToBottom = (
    behavior: ScrollBehavior = "auto",
  ) => {
    if (
      !isRestoringScroll.current &&
      chatContainerRef.current
    ) {
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: behavior,
          });
        }
      });
    }
  };

  const scrollToLatestMessage = () => {
    if (
      !isRestoringScroll.current &&
      latestMessageRef.current
    ) {
      requestAnimationFrame(() => {
        latestMessageRef.current?.scrollIntoView({
          behavior: "auto",
          block: "start",
        });
      });
    }
  };

  const contentBufferRef = useRef<string>("");
  const contentFlushTimeoutRef = useRef<NodeJS.Timeout | null>(
    null,
  );

  useEffect(() => {
    if (!isRestoringScroll.current) {
      if (prevIsStreamingRef.current && !isStreaming) {
        // Only scroll to bottom when streaming ends if user hasn't scrolled up
        if (!userHasScrolledUp.current) {
          scrollToBottom("smooth");
        }
        // Reset for next message
        userHasScrolledUp.current = false;
      }
      prevIsStreamingRef.current = isStreaming;
    }
  }, [isStreaming]);

  // Auto-scroll during streaming only when user is near bottom
  useEffect(() => {
    if (isStreaming && !userHasScrolledUp.current && !isRestoringScroll.current) {
      scrollToBottom("smooth");
    }
  }, [streamedBlocks, isStreaming]);

  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullscreenImage) {
        setFullscreenImage(null);
      }
    };

    window.addEventListener("keydown", handleEscKey);
    return () =>
      window.removeEventListener("keydown", handleEscKey);
  }, [fullscreenImage]);

  const quickStartChips = [
    "What moved TSLA today?",
    "Biggest movers in my watchlist?",
    "Explain today's market in simple terms",
  ];

  const processSSEData = (rawData: string): any | null => {
    try {
      let cleanData = rawData.trim();
      while (cleanData.startsWith("data: ")) {
        cleanData = cleanData.substring(6).trim();
      }
      if (!cleanData) return null;
      if (
        !cleanData.startsWith("{") &&
        !cleanData.startsWith("[")
      )
        return null;
      return JSON.parse(cleanData);
    } catch (error) {
      return null;
    }
  };

  const parseSSEStream = (
    buffer: string,
  ): { messages: string[]; remaining: string } => {
    const messages: string[] = [];
    let currentBuffer = buffer;
    while (true) {
      const doubleNewlineIndex = currentBuffer.indexOf("\n\n");
      if (doubleNewlineIndex === -1) {
        return { messages, remaining: currentBuffer };
      }
      const message = currentBuffer.substring(
        0,
        doubleNewlineIndex,
      );
      if (message.trim()) {
        messages.push(message);
      }
      currentBuffer = currentBuffer.substring(
        doubleNewlineIndex + 2,
      );
    }
  };

  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    if (sendingRef.current || isStreaming || isTyping) return;

    sendingRef.current = true;

    const userMessage: Message = {
      id: `user-${generateId()}`,
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);
    setIsStreaming(true);
    setThinkingSteps([]);
    setStreamedBlocks([]);
    setStreamingDataCards([]);

    contentBufferRef.current = "";
    if (contentFlushTimeoutRef.current) {
      clearTimeout(contentFlushTimeoutRef.current);
      contentFlushTimeoutRef.current = null;
    }

    if (chatState === "inline-expanded") {
      setChatState("full-window");
    }

    try {
      const userTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(
        "https://catalyst-copilot-2nndy.ondigitalocean.app/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          credentials: "omit",
          body: JSON.stringify({
            message: message,
            conversationHistory: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            selectedTickers,
            timezone: userTimezone,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Chat request failed: ${response.status}`,
        );
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let collectedThinking: ThinkingStep[] = [];
      let collectedContent = "";
      let collectedBlocks: StreamBlock[] = [];
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null;
      let blockIdCounter = 0;
      let hasReprocessedForMetadata = false;

      const processContentBuffer = (
        forceFlush: boolean = false,
      ) => {
        const { blocks, remaining } = extractStreamBlocks(
          contentBufferRef.current,
          collectedDataCards,
        );

        if (blocks.length > 0) {
          const newBlocks = blocks.map((block) => ({
            ...block,
            id: `block-${generateId()}-${blockIdCounter++}`,
          }));
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks((prev) => [...prev, ...newBlocks]);
        }

        contentBufferRef.current = remaining;

        if (forceFlush && remaining.trim()) {
          const finalBlock: StreamBlock = {
            id: `block-${generateId()}-final`,
            type: "text",
            content: remaining,
          };
          collectedBlocks.push(finalBlock);
          setStreamedBlocks((prev) => [...prev, finalBlock]);
          contentBufferRef.current = "";
        }
      };

      const reprocessStreamedBlocks = () => {
        console.log(
          `🔍 [reprocessStreamedBlocks] Scanning ${collectedBlocks.length} blocks for article markers`,
        );

        const newBlocks: StreamBlock[] = [];
        let hasChanges = false;

        for (const block of collectedBlocks) {
          if (block.type === "text") {
            // Try to extract article markers from this text block
            const { blocks, remaining } = extractStreamBlocks(
              block.content,
              collectedDataCards,
            );

            if (blocks.length > 0) {
              // We found article markers! Replace this text block with the extracted blocks
              console.log(
                `✅ [reprocessStreamedBlocks] Extracted ${blocks.length} blocks from text block`,
              );
              newBlocks.push(
                ...blocks.map((b) => ({
                  ...b,
                  id: `block-${generateId()}-${blockIdCounter++}`,
                })),
              );

              // Add remaining text if any
              if (remaining.trim()) {
                newBlocks.push({
                  id: `block-${generateId()}-${blockIdCounter++}`,
                  type: "text",
                  content: remaining,
                });
              }
              hasChanges = true;
            } else {
              // No markers found, keep the original block
              newBlocks.push(block);
            }
          } else {
            // Non-text blocks pass through unchanged
            newBlocks.push(block);
          }
        }

        if (hasChanges) {
          console.log(
            `🔄 [reprocessStreamedBlocks] Updating blocks: ${collectedBlocks.length} → ${newBlocks.length}`,
          );
          collectedBlocks.length = 0;
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks([...newBlocks]);
        } else {
          console.log(
            `ℹ️ [reprocessStreamedBlocks] No article markers found in existing blocks`,
          );
        }
      };

      const processMessages = (msgs: string[]) => {
        for (const messageBlock of msgs) {
          const trimmedBlock = messageBlock.trim();
          if (!trimmedBlock || trimmedBlock.startsWith(":"))
            continue;

          if (trimmedBlock.startsWith("data: ")) {
            const data = processSSEData(trimmedBlock);
            if (!data || !data.type) continue;

            switch (data.type) {
              case "metadata":
                if (data.dataCards) {
                  collectedDataCards = data.dataCards;
                  setStreamingDataCards(data.dataCards);
                  console.log(
                    `📦 [StreamingChat] Received metadata with ${data.dataCards.length} dataCards:`,
                    {
                      articleCards: data.dataCards
                        .filter((c) => c.type === "article")
                        .map((c) => c.data.id),
                      currentStreamedBlocks:
                        streamedBlocks.length,
                      currentTextContent:
                        contentBufferRef.current.substring(
                          0,
                          200,
                        ),
                    },
                  );

                  // Re-process existing text blocks to extract article markers that are now available
                  console.log(
                    `🔄 [StreamingChat] Re-processing existing blocks with newly available dataCards`,
                  );
                  reprocessStreamedBlocks();
                  hasReprocessedForMetadata = true;
                }
                if (data.eventData) {
                  eventData = data.eventData;
                }
                break;

              case "thinking":
                if (thinkingStartTime === null) {
                  thinkingStartTime = Date.now();
                }
                const newStep = {
                  phase: data.phase || "thinking",
                  content: data.content,
                  timestamp: Date.now(),
                };
                collectedThinking.push(newStep);
                setThinkingSteps((prev) => [...prev, newStep]);
                break;

              case "content":
                contentBufferRef.current += data.content;
                collectedContent += data.content;

                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processContentBuffer(false);

                // Only reprocess once when metadata first arrives, not on every content chunk
                if (
                  collectedDataCards.length > 0 &&
                  !hasReprocessedForMetadata
                ) {
                  reprocessStreamedBlocks();
                  hasReprocessedForMetadata = true;
                }

                contentFlushTimeoutRef.current = setTimeout(
                  () => {
                    if (contentBufferRef.current.trim()) {
                      processContentBuffer(false);
                    }
                    contentFlushTimeoutRef.current = null;
                  },
                  150,
                );
                break;

              case "chart_block":
                const chartBlock: StreamBlock = {
                  id: `chart-${generateId()}-${blockIdCounter++}`,
                  type: "chart",
                  content: "",
                  data: {
                    symbol: data.symbol,
                    timeRange: data.timeRange,
                  },
                };
                collectedBlocks.push(chartBlock);
                setStreamedBlocks((prev) => [
                  ...prev,
                  chartBlock,
                ]);
                break;

              case "image_block":
                const imageCard = collectedDataCards.find(
                  (c) =>
                    c.type === "image" &&
                    c.data?.id === data.cardId,
                );
                if (imageCard) {
                  const imageBlock: StreamBlock = {
                    id: `image-${generateId()}-${blockIdCounter++}`,
                    type: "image",
                    content: "",
                    data: imageCard.data,
                  };
                  collectedBlocks.push(imageBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    imageBlock,
                  ]);
                }
                break;

              case "article_block":
                // Flush any pending text content before adding article card
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processContentBuffer(false);

                const articleCard = collectedDataCards.find(
                  (c) =>
                    c.type === "article" &&
                    c.data?.id === data.cardId,
                );
                if (articleCard) {
                  const articleBlock: StreamBlock = {
                    id: `article-${generateId()}-${blockIdCounter++}`,
                    type: "article",
                    content: "",
                    data: articleCard.data,
                  };
                  collectedBlocks.push(articleBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    articleBlock,
                  ]);
                }
                break;

              case "event_block":
                const eventCard = collectedDataCards.find(
                  (c) =>
                    c.type === "event" &&
                    (c.data?.id === data.cardId ||
                      c.data?.id?.toString() === data.cardId),
                );
                if (eventCard) {
                  const eventBlock: StreamBlock = {
                    id: `event-${generateId()}-${blockIdCounter++}`,
                    type: "event",
                    content: "",
                    data: eventCard.data,
                  };
                  collectedBlocks.push(eventBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    eventBlock,
                  ]);
                }
                break;

              case "horizontal_rule":
                const hrBlock: StreamBlock = {
                  id: `hr-${generateId()}-${blockIdCounter++}`,
                  type: "horizontal_rule",
                  content: "",
                };
                collectedBlocks.push(hrBlock);
                setStreamedBlocks((prev) => [...prev, hrBlock]);
                break;

              case "done":
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processContentBuffer(true);

                const thinkingDuration = thinkingStartTime
                  ? Math.round(
                      (Date.now() - thinkingStartTime) / 1000,
                    )
                  : undefined;

                const aiMessage: Message = {
                  id: `ai-${generateId()}`,
                  role: "assistant",
                  content: collectedContent,
                  contentBlocks: collectedBlocks,
                  dataCards: collectedDataCards,
                  eventData: eventData,
                  thinkingSteps: collectedThinking,
                  thinkingDuration: thinkingDuration,
                  timestamp: new Date(),
                };
                setMessages((prev) => [...prev, aiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedBlocks([]);
                setStreamingDataCards([]);
                break;
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const { messages: completeMessages, remaining } =
          parseSSEStream(buffer);
        buffer = remaining;
        processMessages(completeMessages);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: `error-${generateId()}`,
        role: "assistant",
        content:
          "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsStreaming(false);
    } finally {
      setIsTyping(false);
      sendingRef.current = false;
    }
  };

  const handleQuickStart = (question: string) => {
    if (!sendingRef.current && !isStreaming && !isTyping) {
      handleSendMessage(question);
    }
  };

  const handleCollapse = () => {
    setChatState("collapsed");
  };

  const handleExpand = () => {
    setChatState("inline-expanded");
  };

  const handleOpenFullWindow = () => {
    setChatState("full-window");
  };

  const handleMinimize = () => {
    setChatState("minimized");
  };

  const handleClose = () => {
    setChatState("collapsed");
    setMessages([]);
    localStorage.removeItem("catalyst_chat_messages");
    localStorage.setItem("catalyst_chat_state", "collapsed");
  };

  const handleEditMessage = (
    messageId: string,
    content: string,
  ) => {
    setEditingMessageId(messageId);
    setEditingValue(content);
    setTimeout(() => {
      editInputRef.current?.focus();
    }, 10);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingValue("");
  };

  const handleSubmitEdit = async (messageId: string) => {
    if (!editingValue.trim()) return;
    if (sendingRef.current || isStreaming || isTyping) return;

    sendingRef.current = true;

    const messageIndex = messages.findIndex(
      (m) => m.id === messageId,
    );
    if (messageIndex === -1) {
      sendingRef.current = false;
      return;
    }

    const messagesBeforeEdit = messages.slice(0, messageIndex);
    const editedMessage: Message = {
      ...messages[messageIndex],
      content: editingValue,
      timestamp: new Date(),
    };

    setMessages([...messagesBeforeEdit, editedMessage]);
    setEditingMessageId(null);
    setEditingValue("");
    setIsTyping(true);
    setIsStreaming(true);
    setThinkingSteps([]);
    setStreamedBlocks([]);
    setStreamingDataCards([]);

    contentBufferRef.current = "";
    if (contentFlushTimeoutRef.current) {
      clearTimeout(contentFlushTimeoutRef.current);
      contentFlushTimeoutRef.current = null;
    }

    try {
      const userTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(
        "https://catalyst-copilot-2nndy.ondigitalocean.app/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          credentials: "omit",
          body: JSON.stringify({
            message: editingValue,
            conversationHistory: messagesBeforeEdit.map(
              (m) => ({ role: m.role, content: m.content }),
            ),
            selectedTickers,
            timezone: userTimezone,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to get response from AI: ${response.status}`,
        );
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let collectedThinking: ThinkingStep[] = [];
      let collectedContent = "";
      let collectedBlocks: StreamBlock[] = [];
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null;
      let editBlockIdCounter = 0;
      let hasReprocessedEditForMetadata = false;

      const processEditContentBuffer = (
        forceFlush: boolean = false,
      ) => {
        const { blocks, remaining } = extractStreamBlocks(
          contentBufferRef.current,
          collectedDataCards,
        );
        if (blocks.length > 0) {
          const newBlocks = blocks.map((block) => ({
            ...block,
            id: `edit-block-${generateId()}-${editBlockIdCounter++}`,
          }));
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks((prev) => [...prev, ...newBlocks]);
        }
        contentBufferRef.current = remaining;
        if (forceFlush && remaining.trim()) {
          const finalBlock: StreamBlock = {
            id: `edit-block-${generateId()}-final`,
            type: "text",
            content: remaining,
          };
          collectedBlocks.push(finalBlock);
          setStreamedBlocks((prev) => [...prev, finalBlock]);
          contentBufferRef.current = "";
        }
      };

      const reprocessEditStreamedBlocks = () => {
        console.log(
          `🔍 [reprocessEditStreamedBlocks] Scanning ${collectedBlocks.length} blocks for article markers`,
        );

        const newBlocks: StreamBlock[] = [];
        let hasChanges = false;

        for (const block of collectedBlocks) {
          if (block.type === "text") {
            const { blocks, remaining } = extractStreamBlocks(
              block.content,
              collectedDataCards,
            );

            if (blocks.length > 0) {
              console.log(
                `✅ [reprocessEditStreamedBlocks] Extracted ${blocks.length} blocks from text block`,
              );
              newBlocks.push(
                ...blocks.map((b) => ({
                  ...b,
                  id: `edit-block-${generateId()}-${editBlockIdCounter++}`,
                })),
              );

              if (remaining.trim()) {
                newBlocks.push({
                  id: `edit-block-${generateId()}-${editBlockIdCounter++}`,
                  type: "text",
                  content: remaining,
                });
              }
              hasChanges = true;
            } else {
              newBlocks.push(block);
            }
          } else {
            newBlocks.push(block);
          }
        }

        if (hasChanges) {
          console.log(
            `🔄 [reprocessEditStreamedBlocks] Updating blocks: ${collectedBlocks.length} → ${newBlocks.length}`,
          );
          collectedBlocks.length = 0;
          collectedBlocks.push(...newBlocks);
          setStreamedBlocks([...newBlocks]);
        } else {
          console.log(
            `ℹ️ [reprocessEditStreamedBlocks] No article markers found in existing blocks`,
          );
        }
      };

      const processMessages = (msgs: string[]) => {
        for (const messageBlock of msgs) {
          const trimmedBlock = messageBlock.trim();
          if (!trimmedBlock || trimmedBlock.startsWith(":"))
            continue;

          if (trimmedBlock.startsWith("data: ")) {
            const data = processSSEData(trimmedBlock);
            if (!data || !data.type) continue;

            switch (data.type) {
              case "metadata":
                if (data.dataCards) {
                  collectedDataCards = data.dataCards;
                  setStreamingDataCards(data.dataCards);

                  // Re-process existing text blocks to extract article markers that are now available
                  console.log(
                    `🔄 [EditStreamingChat] Re-processing existing blocks with newly available dataCards`,
                  );
                  reprocessEditStreamedBlocks();
                  hasReprocessedEditForMetadata = true;
                }
                if (data.eventData) eventData = data.eventData;
                break;
              case "thinking":
                if (thinkingStartTime === null)
                  thinkingStartTime = Date.now();
                const newStep = {
                  phase: data.phase || "thinking",
                  content: data.content,
                  timestamp: Date.now(),
                };
                collectedThinking.push(newStep);
                setThinkingSteps((prev) => [...prev, newStep]);
                break;
              case "content":
                contentBufferRef.current += data.content;
                collectedContent += data.content;
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processEditContentBuffer(false);

                // Only reprocess once when metadata first arrives, not on every content chunk
                if (
                  collectedDataCards.length > 0 &&
                  !hasReprocessedEditForMetadata
                ) {
                  reprocessEditStreamedBlocks();
                  hasReprocessedEditForMetadata = true;
                }

                contentFlushTimeoutRef.current = setTimeout(
                  () => {
                    if (contentBufferRef.current.trim())
                      processEditContentBuffer(false);
                    contentFlushTimeoutRef.current = null;
                  },
                  150,
                );
                break;
              case "chart_block":
                const editChartBlock: StreamBlock = {
                  id: `edit-chart-${generateId()}-${editBlockIdCounter++}`,
                  type: "chart",
                  content: "",
                  data: {
                    symbol: data.symbol,
                    timeRange: data.timeRange,
                  },
                };
                collectedBlocks.push(editChartBlock);
                setStreamedBlocks((prev) => [
                  ...prev,
                  editChartBlock,
                ]);
                break;
              case "image_block":
                const editImageCard = collectedDataCards.find(
                  (c) =>
                    c.type === "image" &&
                    c.data?.id === data.cardId,
                );
                if (editImageCard) {
                  const editImageBlock: StreamBlock = {
                    id: `edit-image-${generateId()}-${editBlockIdCounter++}`,
                    type: "image",
                    content: "",
                    data: editImageCard.data,
                  };
                  collectedBlocks.push(editImageBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    editImageBlock,
                  ]);
                }
                break;
              case "article_block":
                // Flush any pending text content before adding article card
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processEditContentBuffer(false);

                const editArticleCard = collectedDataCards.find(
                  (c) =>
                    c.type === "article" &&
                    c.data?.id === data.cardId,
                );
                if (editArticleCard) {
                  const editArticleBlock: StreamBlock = {
                    id: `edit-article-${generateId()}-${editBlockIdCounter++}`,
                    type: "article",
                    content: "",
                    data: editArticleCard.data,
                  };
                  collectedBlocks.push(editArticleBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    editArticleBlock,
                  ]);
                }
                break;
              case "event_block":
                const editEventCard = collectedDataCards.find(
                  (c) =>
                    c.type === "event" &&
                    (c.data?.id === data.cardId ||
                      c.data?.id?.toString() === data.cardId),
                );
                if (editEventCard) {
                  const editEventBlock: StreamBlock = {
                    id: `edit-event-${generateId()}-${editBlockIdCounter++}`,
                    type: "event",
                    content: "",
                    data: editEventCard.data,
                  };
                  collectedBlocks.push(editEventBlock);
                  setStreamedBlocks((prev) => [
                    ...prev,
                    editEventBlock,
                  ]);
                }
                break;
              case "horizontal_rule":
                const editHrBlock: StreamBlock = {
                  id: `edit-hr-${generateId()}-${editBlockIdCounter++}`,
                  type: "horizontal_rule",
                  content: "",
                };
                collectedBlocks.push(editHrBlock);
                setStreamedBlocks((prev) => [
                  ...prev,
                  editHrBlock,
                ]);
                break;
              case "done":
                if (contentFlushTimeoutRef.current) {
                  clearTimeout(contentFlushTimeoutRef.current);
                  contentFlushTimeoutRef.current = null;
                }
                processEditContentBuffer(true);
                const editThinkingDuration = thinkingStartTime
                  ? Math.round(
                      (Date.now() - thinkingStartTime) / 1000,
                    )
                  : undefined;
                const editAiMessage: Message = {
                  id: `ai-${generateId()}`,
                  role: "assistant",
                  content: collectedContent,
                  contentBlocks: collectedBlocks,
                  dataCards: collectedDataCards,
                  eventData: eventData,
                  thinkingSteps: collectedThinking,
                  thinkingDuration: editThinkingDuration,
                  timestamp: new Date(),
                };
                setMessages((prev) => [...prev, editAiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedBlocks([]);
                setStreamingDataCards([]);
                break;
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const { messages: completeMessages, remaining } =
          parseSSEStream(buffer);
        buffer = remaining;
        processMessages(completeMessages);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: `error-${generateId()}`,
        role: "assistant",
        content:
          "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsStreaming(false);
    } finally {
      setIsTyping(false);
      sendingRef.current = false;
    }
  };

  if (chatState === "collapsed") {
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
              <p className="text-xs text-muted-foreground">
                Chat about your stocks and events
              </p>
            </div>
            <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </div>
        </Card>
      </div>
    );
  }

  if (chatState === "inline-expanded") {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="inline-expanded"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 200,
          }}
          className="my-6 overflow-hidden"
        >
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <h3 className="font-semibold">
                  Catalyst Copilot
                </h3>
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
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-ai-accent text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      <p className="line-clamp-2">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {messages.length === 0 && (
              <div className="p-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium">
                  Quick start:
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickStartChips.map((chip) => (
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
                    e.target.style.height = "auto";
                    e.target.style.height =
                      Math.min(e.target.scrollHeight, 120) +
                      "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (
                        !sendingRef.current &&
                        !isStreaming &&
                        !isTyping &&
                        inputValue.trim()
                      ) {
                        handleSendMessage(inputValue);
                      }
                      if (inputRef.current) {
                        (inputRef.current as any).style.height =
                          "auto";
                      }
                    }
                  }}
                  placeholder={
                    isStreaming
                      ? "AI is thinking..."
                      : "Ask about any stock or your watchlist…"
                  }
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
                        ? "bg-gradient-to-r from-ai-accent to-ai-accent/80 shadow-md"
                        : ""
                    }`}
                    onClick={() => {
                      if (
                        !sendingRef.current &&
                        !isStreaming &&
                        !isTyping &&
                        inputValue.trim()
                      ) {
                        handleSendMessage(inputValue);
                      }
                    }}
                    disabled={
                      !inputValue.trim() ||
                      isStreaming ||
                      isTyping
                    }
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

  if (chatState === "minimized") {
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
                <h3 className="font-semibold">
                  Ask Catalyst AI
                </h3>
                <p className="text-xs text-muted-foreground">
                  Chat about your stocks and events
                </p>
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
        ref={modalRef}
        key="full-window"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{
          type: "spring",
          damping: 30,
          stiffness: 300,
        }}
        className="fixed inset-0 z-[100] bg-background flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-ai-accent to-muted-foreground rounded-full flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <h2>Catalyst Copilot</h2>
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

        <div
          className="flex-1 overflow-y-auto p-4 pb-4 space-y-6"
          ref={(el) => {
            chatContainerRef.current = el;
            messagesContainerRef.current = el;
          }}
        >
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
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.2,
                }}
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
                Ask me anything about your stocks, watchlist, or
                market events
              </motion.p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {quickStartChips.map((chip, index) => (
                  <motion.div
                    key={chip}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + index * 0.05 }}
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
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} -mb-2`}
            >
              <div
                className={`${msg.role === "user" ? "max-w-[85%]" : "w-full"} ${msg.role === "assistant" ? "space-y-3 mb-8" : "mb-3"}`}
              >
                {msg.role === "assistant" && (
                  <motion.div
                    ref={
                      index === messages.length - 1 &&
                      msg.role === "assistant"
                        ? latestMessageRef
                        : null
                    }
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 20,
                    }}
                    className="mb-2"
                  >
                    {msg.thinkingDuration !== undefined && (
                      <div className="text-xs text-muted-foreground mt-0.5 mb-5 not-italic">
                        Thought for {msg.thinkingDuration}s
                      </div>
                    )}
                  </motion.div>
                )}

                {editingMessageId === msg.id &&
                msg.role === "user" ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editInputRef as any}
                      value={editingValue}
                      onChange={(e) =>
                        setEditingValue(e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmitEdit(msg.id);
                        } else if (e.key === "Escape") {
                          handleCancelEdit();
                        }
                      }}
                      className="w-full bg-input-background rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none min-h-[44px]"
                      rows={Math.max(
                        2,
                        editingValue.split("\n").length,
                      )}
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
                        disabled={
                          !editingValue.trim() || isTyping
                        }
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
                    <div
                      className={`${
                        msg.role === "user"
                          ? "rounded-2xl px-4 py-3 bg-gradient-to-br from-ai-accent to-ai-accent/90 text-primary-foreground shadow-md"
                          : "text-foreground"
                      }`}
                    >
                      {msg.contentBlocks &&
                      msg.contentBlocks.length > 0 ? (
                        <StreamBlockRenderer
                          blocks={msg.contentBlocks}
                          dataCards={msg.dataCards}
                          onEventClick={onEventClick}
                          onImageClick={setFullscreenImage}
                          onTickerClick={onTickerClick}
                          isUserMessage={msg.role === "user"}
                        />
                      ) : (
                        <MarkdownText
                          text={msg.content}
                          dataCards={msg.dataCards}
                          onEventClick={onEventClick}
                          onImageClick={setFullscreenImage}
                          onTickerClick={onTickerClick}
                          isUserMessage={msg.role === "user"}
                        />
                      )}
                    </div>

                    {msg.role === "user" && !isTyping && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleEditMessage(
                              msg.id,
                              msg.content,
                            )
                          }
                          className="h-7 text-xs opacity-60 hover:opacity-100 transition-opacity"
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}

                    {msg.dataCards &&
                      msg.dataCards.filter((card) => {
                        if (card.type === "event") return false;
                        if (card.type === "image") return false;
                        if (card.type === "article")
                          return false;
                        if (card.type === "chart") return false;
                        return true;
                      }).length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.3,
                            delay: 0.1,
                          }}
                          className="space-y-2"
                        >
                          {msg.dataCards
                            .filter((card) => {
                              if (card.type === "event")
                                return false;
                              if (card.type === "image")
                                return false;
                              if (card.type === "article")
                                return false;
                              if (card.type === "chart")
                                return false;
                              return true;
                            })
                            .map((card, idx) => {
                              const cardKey =
                                card.type === "stock"
                                  ? `${msg.id}-stock-${card.data?.ticker || "unknown"}-${idx}`
                                  : card.type === "chart"
                                    ? `${msg.id}-chart-${card.data?.ticker || "unknown"}-${idx}`
                                    : card.type === "event-list"
                                      ? `${msg.id}-event-list-${idx}`
                                      : `${msg.id}-card-${idx}`;

                              return (
                                <motion.div
                                  key={cardKey}
                                  initial={{
                                    opacity: 0,
                                    x: -20,
                                  }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{
                                    duration: 0.3,
                                    delay: 0.1 + idx * 0.05,
                                  }}
                                >
                                  <DataCardComponent
                                    card={card}
                                    onEventClick={onEventClick}
                                    onImageClick={
                                      setFullscreenImage
                                    }
                                    onTickerClick={
                                      onTickerClick
                                    }
                                  />
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

          {isStreaming && (
            <div className="flex justify-start">
              <div
                ref={latestMessageRef}
                className="w-full space-y-3 mt-2.5"
              >
                {streamingDataCards.filter((card) => {
                  if (card.type === "event") return false;
                  if (card.type === "image") return false;
                  if (card.type === "article") return false;
                  if (card.type === "chart") return false;
                  return true;
                }).length > 0 && (
                  <div
                    className="space-y-2"
                    style={{ willChange: "contents" }}
                  >
                    {streamingDataCards
                      .filter((card) => {
                        if (card.type === "event") return false;
                        if (card.type === "image") return false;
                        if (card.type === "article")
                          return false;
                        if (card.type === "chart") return false;
                        return true;
                      })
                      .map((card, idx) => {
                        const cardKey =
                          card.type === "stock"
                            ? `streaming-stock-${card.data?.ticker || "unknown"}-${idx}`
                            : card.type === "chart"
                              ? `streaming-chart-${card.data?.ticker || "unknown"}-${idx}`
                              : card.type === "event-list"
                                ? `streaming-event-list-${idx}`
                                : `streaming-card-${idx}`;

                        return (
                          <div
                            key={cardKey}
                            style={{ willChange: "opacity" }}
                          >
                            <DataCardComponent
                              card={card}
                              onEventClick={onEventClick}
                              onImageClick={setFullscreenImage}
                              onTickerClick={onTickerClick}
                            />
                          </div>
                        );
                      })}
                  </div>
                )}

                {thinkingSteps.length === 0 &&
                  streamedBlocks.length === 0 &&
                  streamingDataCards.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-1.5 px-2 py-1"
                    >
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0,
                        }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0.2,
                        }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0.4,
                        }}
                      />
                    </motion.div>
                  )}

                {thinkingSteps.length > 0 && (
                  <div
                    className={`overflow-hidden max-w-[85%]`}
                    style={{ willChange: "contents" }}
                  >
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-medium thinking-text-animated truncate text-[14px]">
                          {thinkingSteps.length > 0
                            ? thinkingSteps[
                                thinkingSteps.length - 1
                              ].content
                            : "Thinking..."}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {streamedBlocks.length > 0 && (
                  <div
                    className="text-foreground"
                    style={{
                      willChange: "contents",
                      contain: "layout style",
                      contentVisibility: "auto",
                    }}
                  >
                    <StreamBlockRenderer
                      blocks={streamedBlocks}
                      dataCards={streamingDataCards}
                      onEventClick={onEventClick}
                      onImageClick={setFullscreenImage}
                      onTickerClick={onTickerClick}
                      isUserMessage={false}
                      isStreaming={isStreaming}
                    />
                    {isStreaming && (
                      <span className="inline-block w-[2px] h-4 bg-foreground/60 ml-0.5 animate-pulse" />
                    )}
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
              <div className="w-full space-y-3">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 20,
                  }}
                  className="flex items-center gap-2 mb-2"
                >
                  <span className="text-[15px] font-medium text-black mb-0">
                    Catalyst AI
                  </span>
                </motion.div>

                <div className="rounded-2xl mb-2 inline-block">
                  <div className="flex items-center gap-2 py-1.5 pr-3">
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0,
                        }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0.2,
                        }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-ai-accent rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: 0.4,
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground ml-1 whitespace-nowrap">
                      Analyzing your question...
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} className="mb-6" />
        </div>

        <div
          ref={inputContainerRef}
          className="flex-shrink-0 p-3 border-t border-border bg-background"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef as any}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (
                    !sendingRef.current &&
                    !isStreaming &&
                    !isTyping &&
                    inputValue.trim()
                  ) {
                    handleSendMessage(inputValue);
                  }
                  if (inputRef.current) {
                    (inputRef.current as any).style.height =
                      "auto";
                  }
                }
              }}
              placeholder={
                isStreaming
                  ? "AI is thinking..."
                  : "Ask anything"
              }
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
                    ? "bg-gradient-to-r from-ai-accent to-ai-accent/80 shadow-lg"
                    : ""
                }`}
                onClick={() => {
                  if (
                    !sendingRef.current &&
                    !isStreaming &&
                    !isTyping &&
                    inputValue.trim()
                  ) {
                    handleSendMessage(inputValue);
                  }
                }}
                disabled={
                  !inputValue.trim() || isTyping || isStreaming
                }
              >
                <motion.div
                  animate={
                    inputValue.trim() && !isTyping
                      ? {
                          scale: [1, 1.1, 1],
                        }
                      : {}
                  }
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <Send className="w-5 h-5" />
                </motion.div>
              </Button>
            </motion.div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Powered by OpenAI + Catalyst data (Supabase)
          </p>
        </div>
      </motion.div>

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
              transition={{
                type: "spring",
                damping: 25,
                stiffness: 300,
              }}
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

function StreamBlockRenderer({
  blocks,
  dataCards,
  onEventClick,
  onImageClick,
  onTickerClick,
  isUserMessage,
  isStreaming = false,
}: {
  blocks: StreamBlock[];
  dataCards?: DataCard[];
  onEventClick?: (event: MarketEvent) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
  isUserMessage?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="space-y-0">
      {blocks.map((block, index) => {
        // Only animate the last text block during streaming
        const isLastBlock = index === blocks.length - 1;
        const shouldAnimate = isStreaming && isLastBlock && block.type === 'text';
        
        switch (block.type) {
          case "text":
            // DEBUG: Check if this text block contains VIEW_ARTICLE markers
            const hasArticleMarkers =
              block.content.includes("[VIEW_ARTICLE:");
            if (hasArticleMarkers) {
              console.log(
                `📝 [StreamBlockRenderer] Rendering text block with VIEW_ARTICLE markers`,
                {
                  blockId: block.id,
                  dataCardsCount: dataCards?.length || 0,
                  articleCardsCount:
                    dataCards?.filter(
                      (c) => c.type === "article",
                    ).length || 0,
                  contentPreview: block.content.substring(
                    0,
                    200,
                  ),
                },
              );
            }

            // Animate text during streaming for smoother feel
            if (shouldAnimate) {
              return (
                <div key={block.id}>
                  <AnimatedTextBlock
                    text={block.content}
                    isStreaming={isStreaming}
                    speed={10}
                    charsPerTick={3}
                  >
                    {(animatedText) => (
                      <MarkdownText
                        text={animatedText}
                        dataCards={dataCards}
                        onEventClick={onEventClick}
                        onImageClick={onImageClick}
                        onTickerClick={onTickerClick}
                        isUserMessage={isUserMessage}
                      />
                    )}
                  </AnimatedTextBlock>
                </div>
              );
            }

            return (
              <div key={block.id}>
                <MarkdownText
                  text={block.content}
                  dataCards={dataCards}
                  onEventClick={onEventClick}
                  onImageClick={onImageClick}
                  onTickerClick={onTickerClick}
                  isUserMessage={isUserMessage}
                />
              </div>
            );

          case "chart":
            return (
              <div key={block.id} className="my-3">
                <InlineChartCard
                  symbol={block.data.symbol}
                  timeRange={block.data.timeRange}
                  onTickerClick={onTickerClick}
                />
              </div>
            );

          case "article":
            const articleCard: DataCard = {
              type: "article",
              data: block.data,
            };
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

          case "image":
            const imageCard: DataCard = {
              type: "image",
              data: block.data,
            };
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

          case "event":
            const eventCard: DataCard = {
              type: "event",
              data: block.data,
            };
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

          case "horizontal_rule":
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