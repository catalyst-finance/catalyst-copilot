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
}

// Markdown Renderer Component
function MarkdownText({ text, dataCards, onEventClick, onImageClick }: { text: string; dataCards?: DataCard[]; onEventClick?: (event: MarketEvent) => void; onImageClick?: (imageUrl: string) => void }) {
  // Don't extract sources into a separate section - keep everything inline
  const mainText = text;
  
  // Helper to extract date/time value from section header for chronological sorting
  const extractDateValue = (headerText: string): number => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const lowerHeader = headerText.toLowerCase();
    
    // Handle intro/context sections - treat as present (-1000 to 0 range to keep them first)
    if (/recent|current|overview|summary|background|introduction|operational|financial|assessment|analysis|developments/i.test(lowerHeader)) {
      return -1000; // Context sections always first
    }
    
    // Handle "Upcoming Catalysts", "Future Timeline", "Roadmap" - treat as present (1) to appear right before timeline
    if (/upcoming.*catalyst|future.*timeline|catalyst.*timeline|^\s*catalysts?\s*$|roadmap/i.test(lowerHeader)) {
      return 1; // Just after context sections, before dated timeline
    }
    
    // Handle quarter formats: "Q1 2026", "Q2 2025", etc.
    const quarterMatch = lowerHeader.match(/q([1-4])\s*(\d{4})/i);
    if (quarterMatch) {
      const quarter = parseInt(quarterMatch[1]);
      const year = parseInt(quarterMatch[2]);
      // Convert to approximate month (Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct)
      const month = (quarter - 1) * 3;
      return new Date(year, month, 1).getTime();
    }
    
    // Handle year formats: "2025", "2026", "FY 2025"
    const yearMatch = lowerHeader.match(/(?:fy\s*)?(\d{4})/i);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      return new Date(year, 6, 1).getTime(); // Mid-year as default
    }
    
    // Handle month-year formats: "January 2026", "Nov 2025", etc.
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthYearMatch = lowerHeader.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{4})/i);
    if (monthYearMatch) {
      const monthStr = monthYearMatch[1].toLowerCase().slice(0, 3);
      const monthIdx = monthNames.indexOf(monthStr);
      const year = parseInt(monthYearMatch[2]);
      if (monthIdx !== -1) {
        return new Date(year, monthIdx, 15).getTime();
      }
    }
    
    // Handle date formats in headers: "May 15, 2026", "2025-11-06"
    const dateMatch = lowerHeader.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})|(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (dateMatch) {
      if (dateMatch[4]) {
        // YYYY-MM-DD format
        return new Date(parseInt(dateMatch[4]), parseInt(dateMatch[5]) - 1, parseInt(dateMatch[6])).getTime();
      } else {
        // MM/DD/YYYY or similar
        return new Date(parseInt(dateMatch[3]), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2])).getTime();
      }
    }
    
    // Handle relative terms
    if (/past|historical|previous|earlier|last\s+(?:year|quarter|month)/i.test(lowerHeader)) {
      return -1; // Past sections
    }
    if (/future|upcoming|outlook|roadmap|next|forecast|projected/i.test(lowerHeader)) {
      return new Date(currentYear + 1, 0, 1).getTime(); // Future sections
    }
    
    // Handle filing dates in headers like "10-Q - Nov 6, 2025"
    const filingDateMatch = lowerHeader.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})/i);
    if (filingDateMatch) {
      const monthStr = filingDateMatch[1].toLowerCase().slice(0, 3);
      const monthIdx = monthNames.indexOf(monthStr);
      const day = parseInt(filingDateMatch[2]);
      const year = parseInt(filingDateMatch[3]);
      if (monthIdx !== -1) {
        return new Date(year, monthIdx, day).getTime();
      }
    }
    
    // Default: no date info, keep original order (use large positive number)
    return Number.MAX_SAFE_INTEGER;
  };
  
  // Parse content into sections based on bold headers, then sort chronologically
  const sortContentChronologically = (content: string): string => {
    const lines = content.split('\n');
    const sections: { header: string; content: string[]; dateValue: number; originalIndex: number }[] = [];
    
    let currentSection: { header: string; content: string[]; dateValue: number; originalIndex: number } | null = null;
    let sectionIndex = 0;
    
    // Regex to detect section headers (bold text on its own line)
    const headerRegex = /^\*\*([^*]+)\*\*$/;
    
    lines.forEach((line) => {
      const trimmedLine = line.trim();
      const headerMatch = trimmedLine.match(headerRegex);
      
      if (headerMatch && trimmedLine.length < 100) {
        // This is a section header - save previous section and start new one
        if (currentSection) {
          sections.push(currentSection);
        }
        const headerText = headerMatch[1];
        currentSection = {
          header: trimmedLine,
          content: [],
          dateValue: extractDateValue(headerText),
          originalIndex: sectionIndex++
        };
      } else if (currentSection) {
        // Add line to current section
        currentSection.content.push(line);
      } else {
        // No section yet - create an intro section
        if (!currentSection) {
          currentSection = {
            header: '',
            content: [line],
            dateValue: -Infinity, // Intro always first
            originalIndex: sectionIndex++
          };
        }
      }
    });
    
    // Push the last section
    if (currentSection) {
      sections.push(currentSection);
    }
    
    // If only one section or no clear sections, return original content
    if (sections.length <= 1) {
      return content;
    }
    
    // Categorize sections by their date values
    const contextSections = sections.filter(s => s.header === '' || s.dateValue < 0); // Intro and context (including -1000 for operational/financial)
    const upcomingCatalystsSection = sections.filter(s => s.dateValue === 1); // "Upcoming Catalysts" header
    const datedSections = sections.filter(s => s.dateValue > 1 && s.dateValue !== Number.MAX_SAFE_INTEGER); // Q1 2026, Q2 2026, etc.
    const undatedSections = sections.filter(s => s.dateValue === Number.MAX_SAFE_INTEGER); // Other undated sections
    
    // Sort dated sections chronologically (past → present → future)
    datedSections.sort((a, b) => a.dateValue - b.dateValue);
    
    // Reconstruct content: context → upcoming catalysts header → dated timeline → other undated
    const sortedSections = [...contextSections, ...upcomingCatalystsSection, ...datedSections, ...undatedSections];
    
    // Rebuild the content string
    const sortedLines: string[] = [];
    sortedSections.forEach((section, idx) => {
      if (section.header) {
        // Add blank line before headers (except first context section)
        if (idx > 0 || contextSections.length > 0) {
          sortedLines.push('');
        }
        sortedLines.push(section.header);
      }
      sortedLines.push(...section.content);
    });
    
    return sortedLines.join('\n');
  };
  
  // Sort content chronologically before rendering
  const sortedText = sortContentChronologically(mainText);
  
  const formatRollCallLink = (linkText: string, url: string) => {
    // Check if this is a Roll Call URL
    if (url.includes('rollcall.com')) {
      // Extract the slug from the URL (last part after last slash)
      const urlParts = url.split('/');
      const slug = urlParts[urlParts.length - 1];
      
      // Parse the slug: expected format is words-words-month-day-year
      const parts = slug.split('-');
      
      // Find where the date starts (looking for pattern: month-day-year)
      let dateStartIndex = -1;
      for (let i = 0; i < parts.length - 2; i++) {
        const possibleMonth = parts[i];
        const possibleDay = parts[i + 1];
        const possibleYear = parts[i + 2];
        
        // Check if this looks like a date (month name, numeric day, 4-digit year)
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                           'july', 'august', 'september', 'october', 'november', 'december'];
        if (monthNames.includes(possibleMonth.toLowerCase()) && 
            /^\d+$/.test(possibleDay) && 
            /^\d{4}$/.test(possibleYear)) {
          dateStartIndex = i;
          break;
        }
      }
      
      if (dateStartIndex > 0) {
        // Extract title parts (before date)
        const titleParts = parts.slice(0, dateStartIndex);
        // Capitalize each word
        const formattedTitle = titleParts
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        
        // Extract and format date
        const month = parts[dateStartIndex];
        const day = parts[dateStartIndex + 1];
        const year = parts[dateStartIndex + 2];
        
        const monthNames: Record<string, string> = {
          'january': 'January', 'february': 'February', 'march': 'March', 'april': 'April',
          'may': 'May', 'june': 'June', 'july': 'July', 'august': 'August',
          'september': 'September', 'october': 'October', 'november': 'November', 'december': 'December'
        };
        
        const formattedMonth = monthNames[month.toLowerCase()] || month;
        const formattedDate = `${formattedMonth} ${day}, ${year}`;
        
        return `${formattedTitle} (${formattedDate})`;
      }
      
      // Fallback: just capitalize and clean up the slug
      return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }
    return linkText;
  };
  
  const renderContent = (content: string) => {
    // PRE-SCAN: Extract all VIEW_CHART markers from the entire text first
    const chartCardRegex = /\[VIEW_CHART:([A-Z]+):([^\]]+)\]/g;
    const allChartCards: ChartCardData[] = [];
    let chartMatch;
    
    while ((chartMatch = chartCardRegex.exec(content)) !== null) {
      const symbol = chartMatch[1];
      const timeRange = chartMatch[2] as '1D' | '5D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y';
      allChartCards.push({
        id: `chart-${symbol}-${timeRange}-${Date.now()}-${allChartCards.length}`,
        symbol,
        timeRange
      });
    }
    
    // Remove all VIEW_CHART markers from content so they don't get parsed again
    const cleanedContent = content.replace(chartCardRegex, '');
    
    const lines = cleanedContent.split('\n');
    const elements: JSX.Element[] = [];
    let uniqueKeyCounter = 0; // Add unique key counter
    
    let currentList: string[] = [];
    let currentParagraph: string[] = [];
    let pendingImageCards: string[] = []; // Track IMAGE_CARD markers to render after paragraph
    let pendingArticleCards: string[] = []; // Track VIEW_ARTICLE markers to render after paragraph
    let chartsInserted = false; // Track if charts have been inserted already
    
    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        elements.push(
          <p key={`para-${uniqueKeyCounter++}`} className="mb-3 leading-relaxed">
            {parseInlineFormatting(currentParagraph.join(' '))}
          </p>
        );
        currentParagraph = [];
        
        // Check if we should insert charts after this paragraph (right after Current Price section)
        if ((elements as any).__insertChartsAfterNextFlush && !chartsInserted && allChartCards.length > 0) {
          // Insert all charts here (after Current Price content)
          allChartCards.forEach(chartData => {
            elements.push(
              <div key={`chart-card-${chartData.id}-${uniqueKeyCounter++}`} className="my-3">
                <InlineChartCard symbol={chartData.symbol} timeRange={chartData.timeRange} />
              </div>
            );
          });
          chartsInserted = true; // Mark as inserted
          delete (elements as any).__insertChartsAfterNextFlush;
        }
        
        // After flushing paragraph, add any pending image cards
        if (pendingImageCards.length > 0) {
          pendingImageCards.forEach(imageId => {
            insertImageCard(imageId);
          });
          pendingImageCards = [];
        }
        
        // After flushing paragraph, add any pending article cards
        if (pendingArticleCards.length > 0) {
          pendingArticleCards.forEach(articleId => {
            insertArticleCard(articleId);
          });
          pendingArticleCards = [];
        }
      }
    };
    
    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(
          <ul key={`list-${uniqueKeyCounter++}`} className="space-y-1 my-3 ml-4">
            {currentList.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5">•</span>
                <span className="flex-1">{parseInlineFormatting(item)}</span>
              </li>
            ))}
          </ul>
        );
        currentList = [];
        
        // After flushing list, add any pending image cards
        if (pendingImageCards.length > 0) {
          pendingImageCards.forEach(imageId => {
            insertImageCard(imageId);
          });
          pendingImageCards = [];
        }
        
        // After flushing list, add any pending article cards
        if (pendingArticleCards.length > 0) {
          pendingArticleCards.forEach(articleId => {
            insertArticleCard(articleId);
          });
          pendingArticleCards = [];
        }
        
        // After flushing list, add any pending chart cards
        if (pendingChartCards.length > 0) {
          pendingChartCards.forEach(chartData => {
            insertChartCard(chartData);
          });
          pendingChartCards = [];
        }
      }
    };
    
    const insertEventCard = (eventId: string) => {
      // Find the matching event card
      if (dataCards) {
        const eventCard = dataCards.find(card => 
          card.type === 'event' && (card.data.id === eventId || card.data.id?.toString() === eventId)
        );
        
        if (eventCard) {
          elements.push(
            <div key={`event-card-${eventId}-${uniqueKeyCounter++}`} className="my-3">
              <DataCardComponent card={eventCard} onEventClick={onEventClick} onImageClick={onImageClick} />
            </div>
          );
        }
      }
    };
    
    const insertImageCard = (imageId: string) => {
      // Find the matching image card
      if (dataCards) {
        const imageCard = dataCards.find(card => 
          card.type === 'image' && card.data.id === imageId
        );
        
        if (imageCard) {
          elements.push(
            <div key={`image-card-${imageId}-${uniqueKeyCounter++}`} className="my-3">
              <DataCardComponent card={imageCard} onEventClick={onEventClick} onImageClick={onImageClick} />
            </div>
          );
        }
      }
    };
    
    const insertArticleCard = (articleId: string) => {
      // Find the matching article card
      if (dataCards) {
        const articleCard = dataCards.find(card => 
          card.type === 'article' && card.data.id === articleId
        );
        
        if (articleCard) {
          elements.push(
            <div key={`article-card-${articleId}-${uniqueKeyCounter++}`} className="my-3">
              <DataCardComponent card={articleCard} onEventClick={onEventClick} onImageClick={onImageClick} />
            </div>
          );
        }
      }
    };
    
    const insertChartCard = (chartData: ChartCardData) => {
      // Render an inline mini chart for the symbol
      elements.push(
        <div key={`chart-card-${chartData.id}-${uniqueKeyCounter++}`} className="my-3">
          <InlineChartCard symbol={chartData.symbol} timeRange={chartData.timeRange} />
        </div>
      );
    };
    
    const parseInlineFormatting = (line: string) => {
      const parts: (string | JSX.Element)[] = [];
      let currentText = line;
      let key = 0;
      
      // STEP 1: Extract IMAGE_CARD markers FIRST (before backtick stripping)
      // This handles cases where IMAGE_CARD is inside backticks with citation:
      // `[MNMD 10-Q](url) [IMAGE_CARD:...]` → need to extract IMAGE_CARD first
      const imageCardRegex = /\[IMAGE_CARD:([^\]]+)\]/g;
      const extractedImageCardIds: string[] = [];
      let imageMatch;
      
      while ((imageMatch = imageCardRegex.exec(currentText)) !== null) {
        extractedImageCardIds.push(imageMatch[1]);
      }
      
      // Add extracted image cards to pendingImageCards for rendering after paragraph
      if (extractedImageCardIds.length > 0) {
        pendingImageCards.push(...extractedImageCardIds);
      }
      
      // Remove IMAGE_CARD markers from text
      currentText = currentText.replace(imageCardRegex, '');
      
      // Store extracted image cards  (similar to IMAGE_CARD handling)
      const articleCardRegex = /\[VIEW_ARTICLE:([^\]]+)\]/g;
      const extractedArticleCardIds: string[] = [];
      let articleMatch;
      
      while ((articleMatch = articleCardRegex.exec(currentText)) !== null) {
        extractedArticleCardIds.push(articleMatch[1]);
      }
      
      // Store extracted article cards in pendingArticleCards to render after paragraph/list
      // NOTE: We ONLY use pending mechanism now (no immediate render) to prevent duplicates
      if (extractedArticleCardIds.length > 0) {
        pendingArticleCards.push(...extractedArticleCardIds);
      }
      
      // Remove VIEW_ARTICLE markers from text
      currentText = currentText.replace(articleCardRegex, '');
      
      // NOTE: VIEW_CHART markers are pre-processed at the top of renderContent()
      // and already removed from the text, so no need to extract them here
      
      // Remove "Read more" links that appear right before VIEW_ARTICLE markers
      // Pattern: ([Read more](URL)) or (Read more) right before where marker was
      currentText = currentText.replace(/\(\[Read more\]\([^)]+\)\)\s*/g, '').replace(/\(Read more\)\s*/g, '');
      
      // STEP 2: Clean up whitespace artifacts from IMAGE_CARD removal
      // Handle pattern: `[text](url) ` → `[text](url)` (trailing space before backtick)
      currentText = currentText.replace(/(\]|\))\s+`/g, '$1`');
      
      // STEP 3: Strip backticks from around bracket patterns: `[text](url)` → [text](url) and `[text]` → [text]
      currentText = currentText.replace(/`\[([^\]]+)\]\(([^)]+)\)`/g, '[$1]($2)');
      currentText = currentText.replace(/`\[([^\]]+)\]`/g, '[$1]');
      
      currentText = currentText.trim();
      
      // First, parse [text](url) patterns - these become clickable blue badges (for sources with URLs)
      const linkWithBracketRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let segments: (string | JSX.Element)[] = [];
      let lastIndex = 0;
      let match;
      
      while ((match = linkWithBracketRegex.exec(currentText)) !== null) {
        if (match.index > lastIndex) {
          segments.push(currentText.substring(lastIndex, match.index));
        }
        
        const linkText = match[1];
        const linkUrl = match[2];
        
        // Check if this looks like a source citation (contains form type like 10-Q, 10-K, 8-K, etc.)
        const isSourceCitation = /\b(10-[KQ]|8-K|Form\s+[0-9]+|S-[0-9]+|DEF\s+14A|13F|424B)\b/i.test(linkText);
        
        // Check if this is a generic source/article link (should be rendered as grey badge)
        // This includes: "source", "Read more", or links to news/data sites without article cards
        const isGenericSource = linkText.toLowerCase() === 'source' || 
                               linkText.toLowerCase() === 'read more' ||
                               /\b(tradingeconomics|reuters|bloomberg|cnbc|marketwatch|seekingalpha|benzinga|barrons)\b/i.test(linkUrl);
        
        if (isSourceCitation || isGenericSource) {
          // Render as grey rounded badge with link (ChatGPT style)
          const formattedLinkText = formatRollCallLink(linkText, linkUrl);
          segments.push(
            <a
              key={`source-badge-${key++}`}
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-xs font-medium border border-border/40 hover:bg-muted hover:border-border transition-colors cursor-pointer"
            >
              <FileText className="w-3 h-3" />
              {formattedLinkText}
            </a>
          );
        } else {
          // Regular link (not a source citation)
          const formattedLinkText = formatRollCallLink(linkText, linkUrl);
          segments.push(
            <a
              key={`link-${key++}`}
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline hover:text-blue-400 transition-colors"
            >
              {formattedLinkText}
            </a>
          );
        }
        lastIndex = match.index + match[0].length;
      }
      
      if (lastIndex < currentText.length) {
        segments.push(currentText.substring(lastIndex));
      }
      
      // If no links were found, use the original text
      if (segments.length === 0) {
        segments.push(currentText);
      }
      
      // Now parse remaining [text] patterns (without URLs) as non-clickable badges
      const sourceSegments: (string | JSX.Element)[] = [];
      segments.forEach((segment) => {
        if (typeof segment === 'string') {
          // Match any [text] pattern (these are sources without URLs)
          const sourceRegex = /\[([^\]]+)\]/g;
          let sourceLastIndex = 0;
          let sourceMatch;
          const sourceParts: (string | JSX.Element)[] = [];
          
          while ((sourceMatch = sourceRegex.exec(segment)) !== null) {
            if (sourceMatch.index > sourceLastIndex) {
              sourceParts.push(segment.substring(sourceLastIndex, sourceMatch.index));
            }
            
            const sourceText = sourceMatch[1];
            
            sourceParts.push(
              <span key={`source-${key++}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-xs font-medium border border-border/40">
                <FileText className="w-3 h-3" />
                {sourceText}
              </span>
            );
            sourceLastIndex = sourceMatch.index + sourceMatch[0].length;
          }
          
          if (sourceLastIndex < segment.length) {
            sourceParts.push(segment.substring(sourceLastIndex));
          }
          
          if (sourceParts.length > 0) {
            sourceSegments.push(...sourceParts);
          } else {
            sourceSegments.push(segment);
          }
        } else {
          sourceSegments.push(segment);
        }
      });
      
      // Now parse bold text in each segment
      const finalParts: (string | JSX.Element)[] = [];
      sourceSegments.forEach((segment) => {
        if (typeof segment === 'string') {
          const boldRegex = /\*\*(.+?)\*\*/g;
          let boldLastIndex = 0;
          let boldMatch;
          const boldParts: (string | JSX.Element)[] = [];
          
          while ((boldMatch = boldRegex.exec(segment)) !== null) {
            if (boldMatch.index > boldLastIndex) {
              boldParts.push(segment.substring(boldLastIndex, boldMatch.index));
            }
            boldParts.push(<strong key={`bold-${key++}`} className="font-semibold">{boldMatch[1]}</strong>);
            boldLastIndex = boldMatch.index + boldMatch[0].length;
          }
          
          if (boldLastIndex < segment.length) {
            boldParts.push(segment.substring(boldLastIndex));
          }
          
          if (boldParts.length > 0) {
            finalParts.push(...boldParts);
          } else {
            finalParts.push(segment);
          }
        } else {
          finalParts.push(segment);
        }
      });
      
      // Image cards are now handled separately via pendingImageCards - don't add them inline
      
      return finalParts.length > 0 ? finalParts : currentText;
    };
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Check for EVENT_CARD marker - but handle it differently if it's in a list item
      const eventCardMatch = trimmedLine.match(/\[EVENT_CARD:([^\]]+)\]/);
      const hasEventCard = eventCardMatch !== null;
      
      // Check for IMAGE_CARD marker
      const imageCardMatch = trimmedLine.match(/\[IMAGE_CARD:([^\]]+)\]/);
      const hasImageCard = imageCardMatch !== null;
      
      // Check if line is ONLY an IMAGE_CARD (standalone) - not mixed with text
      const isStandaloneImageCard = hasImageCard && trimmedLine.replace(/\[IMAGE_CARD:([^\]]+)\]/, '').trim().length === 0;
      
      // Check if this is a list item (with or without event card)
      const isListItem = trimmedLine.match(/^\d+\.\s+/) || trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ');
      
      if (line.startsWith('### ')) {
        flushParagraph();
        flushList();
        elements.push(
          <h3 key={`h3-${index}`} className="font-semibold mt-4 mb-2">
            {parseInlineFormatting(line.substring(4))}
          </h3>
        );
      } else if (line.startsWith('## ')) {
        flushParagraph();
        flushList();
        elements.push(
          <h2 key={`h2-${index}`} className="font-semibold text-base mt-4 mb-2">
            {parseInlineFormatting(line.substring(3))}
          </h2>
        );
      } else if (line.startsWith('# ')) {
        flushParagraph();
        flushList();
        elements.push(
          <h1 key={`h1-${index}`} className="font-semibold text-lg mt-4 mb-2">
            {parseInlineFormatting(line.substring(2))}
          </h1>
        );
      } else if (trimmedLine.match(/^\*\*[^*]+\*\*$/) && trimmedLine.length < 100) {
        // Detect bold text on its own line as a subheading (e.g., **Q4 2025**, **2026 Roadmap**)
        flushParagraph();
        flushList();
        
        const headerText = trimmedLine.replace(/^\*\*|\*\*$/g, '');
        const isCurrentPriceHeader = /^current price$/i.test(headerText.trim());
        
        elements.push(
          <h3 key={`h3-bold-${index}`} className="font-semibold mt-4 mb-2">
            {parseInlineFormatting(trimmedLine)}
          </h3>
        );
        
        // If this is "Current Price" header and we have pending charts, mark for insertion
        if (isCurrentPriceHeader) {
          // Set a flag to insert charts after the next content flush
          (elements as any).__insertChartsAfterNextFlush = true;
        }
      } else if (isListItem) {
        flushParagraph();
        // List item - extract text and remove EVENT_CARD/IMAGE_CARD markers if present
        let itemText = trimmedLine.replace(/^(\d+\.\s+|-\s+|•\s+)/, '');
        
        if (hasEventCard) {
          // Remove the EVENT_CARD marker from the text
          itemText = itemText.replace(/\[EVENT_CARD:[^\]]+\]/, '').trim();
        }
        if (hasImageCard) {
          // Remove the IMAGE_CARD marker from the text
          itemText = itemText.replace(/\[IMAGE_CARD:[^\]]+\]/, '').trim();
        }
        
        currentList.push(itemText);
        
        // If there's an event card, flush the list and insert it
        if (hasEventCard && eventCardMatch) {
          flushList();
          insertEventCard(eventCardMatch[1]);
        }
        // If there's an image card, flush the list and insert it
        if (hasImageCard && imageCardMatch) {
          flushList();
          insertImageCard(imageCardMatch[1]);
        }
      } else if (hasEventCard && eventCardMatch) {
        // Event card on its own line (not in a list item)
        flushParagraph();
        flushList();
        insertEventCard(eventCardMatch[1]);
      } else if (isStandaloneImageCard && imageCardMatch) {
        // Image card on its own line (not in a list item) - ONLY if standalone
        flushParagraph();
        flushList();
        insertImageCard(imageCardMatch[1]);
      } else if (trimmedLine) {
        flushList();
        // Regular paragraph text - IMAGE_CARD markers will be extracted by parseInlineFormatting
        currentParagraph.push(trimmedLine);
      } else {
        // Empty line - flush current paragraph
        flushParagraph();
        flushList();
      }
    });
    
    flushParagraph();
    flushList();
    
    return elements;
  };
  
  const parseSources = (sourcesText: string) => {
    // Parse pattern: [Title] (URL)
    const sourceRegex = /\[([^\]]+)\]\s*\(([^)]+)\)/g;
    const sources: { title: string; url: string }[] = [];
    let match;
    
    while ((match = sourceRegex.exec(sourcesText)) !== null) {
      const formattedTitle = formatRollCallLink(match[1], match[2]);
      sources.push({
        title: formattedTitle,
        url: match[2]
      });
    }
    
    return sources;
  };
  
  return (
    <div className="space-y-0.5">
      <div>{renderContent(sortedText)}</div>
    </div>
  );
}

export function CatalystCopilot({ selectedTickers = [], onEventClick }: CatalystCopilotProps) {
  const [chatState, setChatState] = useState<ChatState>('collapsed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const sendingRef = useRef(false); // Add ref to prevent duplicate sends
  
  // Streaming states
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [streamedContent, setStreamedContent] = useState('');
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

  const scrollToBottom = () => {
    if (!isRestoringScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToLatestMessage = () => {
    if (!isRestoringScroll.current && latestMessageRef.current) {
      latestMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (!isRestoringScroll.current) {
      // Check if streaming just finished (was true, now false)
      if (prevIsStreamingRef.current && !isStreaming) {
        // Streaming just completed - stay at bottom
        scrollToBottom();
      } else if (isStreaming) {
        // Still streaming - scroll to bottom
        scrollToBottom();
      }
      // Update previous streaming state
      prevIsStreamingRef.current = isStreaming;
    }
  }, [messages, streamedContent, thinkingSteps, isStreaming]);

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
    setStreamedContent('');
    setStreamingDataCards([]);
    setThinkingCollapsed(true);

    if (chatState === 'inline-expanded') {
      setChatState('full-window');
    }

    try {
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
          selectedTickers
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
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null; // Track thinking start time
      
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
                collectedContent += data.content;
                setStreamedContent(prev => prev + data.content);
                break;

              case 'done':
                // Calculate thinking duration
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
                setMessages(prev => [...prev, aiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedContent('');
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
    setStreamedContent('');
    setStreamingDataCards([]);
    setThinkingCollapsed(true);

    try {
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
          selectedTickers
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
      let collectedDataCards: DataCard[] = [];
      let eventData: Record<string, any> = {};
      let thinkingStartTime: number | null = null; // Track thinking start time
      
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
                collectedContent += data.content;
                setStreamedContent(prev => prev + data.content);
                break;

              case 'done':
                // Calculate thinking duration
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
                setMessages(prev => [...prev, aiMessage]);
                setIsStreaming(false);
                setThinkingSteps([]);
                setStreamedContent('');
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
                      <MarkdownText text={msg.content} dataCards={msg.dataCards} onEventClick={onEventClick} onImageClick={setFullscreenImage} />
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
                              <DataCardComponent card={card} onEventClick={onEventClick} onImageClick={setFullscreenImage} />
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
                <motion.div 
                  ref={latestMessageRef}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="flex items-center gap-2 mb-2"
                >
                  <span className="text-xs font-medium text-muted-foreground">Catalyst AI</span>
                </motion.div>

                {/* Streaming Non-Inline Data Cards - Show First (stock cards, charts that aren't referenced inline) */}
                {streamingDataCards.filter(card => {
                  // Exclude event cards (they're inline)
                  if (card.type === 'event') return false;
                  // Exclude image cards completely - they should only appear inline
                  if (card.type === 'image') return false;
                  // Exclude article cards - they're rendered inline via VIEW_ARTICLE markers
                  if (card.type === 'article') return false;
                  return true;
                }).length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="space-y-2"
                  >
                    {streamingDataCards.filter(card => {
                      if (card.type === 'event') return false;
                      if (card.type === 'image') return false;
                      if (card.type === 'article') return false;
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
                        <motion.div
                          key={cardKey}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: 0.1 + (index * 0.05) }}
                        >
                          <DataCardComponent card={card} onEventClick={onEventClick} onImageClick={setFullscreenImage} />
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}

                {/* Loading indicator before thinking starts */}
                {thinkingSteps.length === 0 && !streamedContent && streamingDataCards.length === 0 && (
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
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border border-border/50 overflow-hidden bg-gradient-to-br from-muted/40 to-muted/20 backdrop-blur-sm max-w-[85%]`}
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
                          <motion.div
                            key={`streaming-thinking-${index}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3 }}
                            className="text-xs text-muted-foreground flex items-start gap-2"
                          >
                            <div className="w-1 h-1 rounded-full bg-ai-accent mt-1.5 flex-shrink-0" />
                            <span>{step.content}</span>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Streamed Content with Typing Cursor - Full Width, No Background */}
                {streamedContent && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-foreground"
                  >
                    <MarkdownText text={streamedContent} dataCards={streamingDataCards} onEventClick={onEventClick} onImageClick={setFullscreenImage} />
                    <motion.span
                      className="inline-block w-[2px] h-4 bg-foreground/60 ml-0.5"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  </motion.div>
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

function DataCardComponent({ card, onEventClick, onImageClick }: { card: DataCard; onEventClick?: (event: MarketEvent) => void; onImageClick?: (imageUrl: string) => void }) {
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
      <motion.div
        whileHover={{ scale: 1.02, y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <Card 
          className="p-3 cursor-pointer hover:shadow-lg transition-all border-2 hover:border-ai-accent/30 bg-gradient-to-br from-background to-muted/20"
          onClick={handleClick}
        >
          <div className="flex items-start gap-3">
            <motion.div 
              whileHover={{ rotate: 5, scale: 1.1 }}
              className={`w-10 h-10 rounded-full ${eventConfig.color} flex items-center justify-center flex-shrink-0 shadow-md`}
            >
              <EventIcon className="w-5 h-5 text-white" />
            </motion.div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="!bg-gradient-to-r !from-ai-accent !to-ai-accent/80 !text-white !border-none text-xs shadow-sm">
                  {ticker}
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">{eventConfig.label}</span>
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
          <p className="text-[10px] text-muted-foreground/60 mt-[-15px] mr-[0px] mb-[0px] ml-[0px]">Data from Catalyst (Supabase)</p>
        </Card>
      </motion.div>
    );
  }

  if (card.type === 'event-list') {
    const { events } = card.data;

    return (
      <motion.div
        whileHover={{ scale: 1.02, y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="p-3 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-ai-accent" />
            Upcoming Events
          </h4>
          <div className="space-y-2">
            {events.slice(0, 3).map((event: any, index: number) => (
              <motion.div 
                key={event.id || `event-${index}`} 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${event.color || 'bg-muted-foreground'} shadow-sm`} />
                <span className="font-medium">{formatEventDateTime(event.date)}</span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">{getEventTypeConfig(event.type)?.label || event.type}</span>
              </motion.div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-2">Data from Catalyst (Supabase)</p>
        </Card>
      </motion.div>
    );
  }

  if (card.type === 'image') {
    const imageData = card.data as ImageCardData;
    
    return (
      <motion.div
        whileHover={{ scale: 1.01, y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="p-4 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg overflow-hidden">
          {/* SEC Filing Image Label */}
          <h4 className="font-semibold mb-2" style={{ fontSize: '12pt' }}>
            SEC Filing Image
          </h4>

          {/* Header with ticker and filing info */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge className="!bg-gradient-to-r !from-ai-accent !to-ai-accent/80 !text-white !border-none text-xs shadow-sm">
              {imageData.ticker}
            </Badge>
            {imageData.filingType && (
              <Badge variant="outline" className="text-xs border-green-500 text-green-600 dark:text-green-400">
                {imageData.filingType}
              </Badge>
            )}
            {imageData.filingDate && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {imageData.filingDate}
              </span>
            )}
          </div>

          {/* SEC Filing Image */}
          <div 
            className="rounded-lg overflow-hidden border border-border/50 mb-2 bg-white dark:bg-muted/20 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => onImageClick?.(imageData.imageUrl)}
          >
            <img 
              src={imageData.imageUrl} 
              alt="SEC Filing Image" 
              className="w-full h-auto"
              loading="lazy"
            />
          </div>

          {/* Context/Caption */}
          {imageData.context && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-3">
              {imageData.context}
            </p>
          )}

          {/* View Full Filing Link */}
          {imageData.filingUrl && (
            <a 
              href={imageData.filingUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-ai-accent hover:text-ai-accent/80 transition-colors font-medium"
            >
              View Full Filing
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </Card>
      </motion.div>
    );
  }

  if (card.type === 'article') {
    const articleData = card.data as ArticleCardData;
    
    return (
      <motion.div
        whileHover={{ scale: 1.01, y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="p-3 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg overflow-hidden">
          <div className="flex gap-3">
            {/* Article image or site logo */}
            <div className="flex-shrink-0">
              {articleData.imageUrl ? (
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-border/50 bg-white dark:bg-muted/20">
                  <img 
                    src={articleData.imageUrl} 
                    alt={articleData.title} 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : articleData.logoUrl ? (
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-border/50 bg-white dark:bg-muted/20">
                  <img 
                    src={articleData.logoUrl} 
                    alt={articleData.source} 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg border border-border/50 bg-muted/40 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Article content */}
            <div className="flex-1 min-w-0">
              {/* Article title */}
              <h4 className="font-semibold text-sm mb-1 leading-tight">
                {articleData.title}
              </h4>

              {/* Date */}
              {articleData.publishedAt && (
                <span className="text-xs text-muted-foreground block mb-0.5">
                  {new Date(articleData.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}

              {/* Source site */}
              <span className="text-xs text-muted-foreground font-medium block mb-1">
                {articleData.source || articleData.domain}
              </span>

              {/* Country and Category for macro_economics */}
              {(articleData.country || articleData.category) && (
                <div className="flex gap-2 mb-2">
                  {articleData.country && (
                    <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-full text-center">
                      {articleData.country}
                    </span>
                  )}
                  {articleData.category && (
                    <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-full text-center">
                      {articleData.category}
                    </span>
                  )}
                </div>
              )}

              {/* Content preview */}

              {/* Read article link */}
              <a 
                href={articleData.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-ai-accent hover:text-ai-accent/80 transition-colors font-medium"
              >
                Read Article
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  return null;
}

/**
 * InlineChartCard - Renders a mini price chart for a symbol inline in the response
 * Used when VIEW_CHART markers are detected in AI responses
 */
function InlineChartCard({ symbol, timeRange }: { symbol: string; timeRange: string }) {
  const [chartData, setChartData] = useState<any[] | null>(null);
  const [quoteData, setQuoteData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  // Subscribe to real-time price updates
  useEffect(() => {
    // Import realtimePriceService when this component is copied into the mobile app
    // Assumes realtimePriceService is available in the mobile app's services
    if (typeof window !== 'undefined' && (window as any).realtimePriceService) {
      const service = (window as any).realtimePriceService;
      
      const handlePriceUpdate = (update: any) => {
        if (update.symbol === symbol) {
          // Update quote data with new current price
          setQuoteData((prev: any) => {
            if (!prev) return null;
            return {
              ...prev,
              close: update.close,
              change: update.close - (prev.previous_close || prev.close),
              change_percent: prev.previous_close 
                ? ((update.close - prev.previous_close) / prev.previous_close) * 100 
                : 0
            };
          });
        }
      };

      service.on('priceUpdate', handlePriceUpdate);

      return () => {
        service.off('priceUpdate', handlePriceUpdate);
      };
    }
  }, [symbol]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(false);

      try {
        // Determine date range based on timeRange
        // CRITICAL: Always use actual current time to fetch latest data
        const now = new Date();
        let startDate: Date;
        let table = 'one_minute_prices';
        let limit = 500;

        switch (timeRange) {
          case '1D':
            // For 1D, fetch from start of today (not 24h ago) to ensure we get current day's data
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            startDate = todayStart;
            table = 'one_minute_prices';
            limit = 390; // ~6.5 hours of trading
            break;
          case '5D':
            startDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
            table = 'one_minute_prices';
            limit = 1950;
            break;
          case '1W':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 7;
            break;
          case '1M':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 30;
            break;
          case '3M':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 90;
            break;
          case '6M':
            startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 180;
            break;
          case '1Y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 365;
            break;
          case '5Y':
            startDate = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
            table = 'daily_prices';
            limit = 1825;
            break;
          default:
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        // Fetch price data
        const priceParams = new URLSearchParams();
        priceParams.append('select', 'timestamp,open,high,low,close,volume');
        priceParams.append('symbol', `eq.${symbol}`);
        priceParams.append('timestamp', `gte.${startDate.toISOString()}`);
        priceParams.append('order', 'timestamp.asc');
        priceParams.append('limit', limit.toString());

        const priceUrl = `https://${projectId}.supabase.co/rest/v1/${table}?${priceParams}`;
        
        // Fetch real-time current quote from stock_quote_now (live price)
        const currentQuoteParams = new URLSearchParams();
        currentQuoteParams.append('select', '*');
        currentQuoteParams.append('symbol', `eq.${symbol}`);
        currentQuoteParams.append('limit', '1');
        
        const currentQuoteUrl = `https://${projectId}.supabase.co/rest/v1/stock_quote_now?${currentQuoteParams}`;
        
        // Fetch historical snapshot for previous_close
        const snapshotParams = new URLSearchParams();
        snapshotParams.append('select', 'previous_close');
        snapshotParams.append('symbol', `eq.${symbol}`);
        snapshotParams.append('order', 'timestamp.desc');
        snapshotParams.append('limit', '1');
        
        const snapshotUrl = `https://${projectId}.supabase.co/rest/v1/finnhub_quote_snapshots?${snapshotParams}`;

        const [priceRes, currentQuoteRes, snapshotRes] = await Promise.all([
          fetch(priceUrl, {
            headers: {
              'apikey': publicAnonKey,
              'Authorization': `Bearer ${publicAnonKey}`
            }
          }),
          fetch(currentQuoteUrl, {
            headers: {
              'apikey': publicAnonKey,
              'Authorization': `Bearer ${publicAnonKey}`
            }
          }),
          fetch(snapshotUrl, {
            headers: {
              'apikey': publicAnonKey,
              'Authorization': `Bearer ${publicAnonKey}`
            }
          })
        ]);

        if (!priceRes.ok) throw new Error('Failed to fetch price data');
        
        const prices = await priceRes.json();
        const currentQuotes = await currentQuoteRes.json();
        const snapshots = await snapshotRes.json();

        // Map to chart format - convert ISO timestamp strings to Unix milliseconds
        const mappedData = prices.map((row: any) => ({
          timestamp: typeof row.timestamp === 'string' 
            ? new Date(row.timestamp).getTime() 
            : row.timestamp,
          price: row.close,
          value: row.close,
          volume: row.volume
        }));

        setChartData(mappedData);
        
        // Combine real-time current price with historical previous_close
        if (currentQuotes && currentQuotes.length > 0 && snapshots && snapshots.length > 0) {
          setQuoteData({
            ...currentQuotes[0],
            previous_close: snapshots[0].previous_close
          });
        } else if (currentQuotes && currentQuotes.length > 0) {
          setQuoteData(currentQuotes[0]);
        }
        setIsLoading(false);
      } catch (err) {
        console.error('InlineChartCard fetch error:', err);
        setError(true);
        setIsLoading(false);
      }
    };

    fetchData();
  }, [symbol, timeRange]);

  // finnhub_quote_snapshots uses snake_case columns: close, change_percent, previous_close
  const isPositive = quoteData ? (quoteData.change_percent || 0) >= 0 : true;
  const isIntraday = timeRange === '1D' || timeRange === '5D';

  return (
    <motion.div
      whileHover={{ scale: 1.01, y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="p-3 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            Unable to load chart
          </div>
        ) : chartData && chartData.length > 0 ? (
          <>
            {isIntraday && quoteData?.previous_close && quoteData?.close ? (
              <IntradayMiniChart 
                data={chartData}
                ticker={symbol}
                previousClose={quoteData.previous_close}
                currentPrice={quoteData.close}
                width={350}
                height={120}
              />
            ) : (
              <SimpleMiniChart data={chartData} ticker={symbol} />
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            No data available
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function StockCard({ data }: { data: StockCardData }) {
  const { ticker, company, price, change, changePercent, chartData, chartMetadata, chartReference, previousClose, open, high, low } = data;
  const [loadedChartData, setLoadedChartData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const isPositive = (change || 0) >= 0;

  // Calculate previous close if not provided
  const calculatedPreviousClose = previousClose || (change != null ? price - change : null);

  // NEW: Fetch data directly from Supabase if chartReference is provided
  useEffect(() => {
    if (chartReference && !chartData && !loadedChartData && !isLoading && !error) {
      setIsLoading(true);
      
      // Build Supabase URL dynamically
      const params = new URLSearchParams();
      params.append('select', chartReference.columns.join(','));
      params.append(chartReference.columns[0], `gte.${chartReference.dateRange.start}`);
      params.append(chartReference.columns[0], `lte.${chartReference.dateRange.end}`);
      params.append('symbol', `eq.${chartReference.symbol}`);
      params.append('order', chartReference.orderBy);
      params.append('limit', '5000');
      
      const url = `https://${projectId}.supabase.co/rest/v1/${chartReference.table}?${params}`;
      
      fetch(url, {
        headers: {
          'apikey': publicAnonKey,
          'Authorization': `Bearer ${publicAnonKey}`
        }
      })
        .then(res => {
          if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
          return res.json();
        })
        .then((result: any[]) => {
          // Map Supabase response to chartData format
          const mappedData = result.map(row => ({
            timestamp_et: row.timestamp_et,
            timestamp: row.timestamp,
            price: row.price,
            value: row.price,
            volume: row.volume
          }));
          
          setLoadedChartData(mappedData);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('❌ Supabase query error:', err);
          setError(true);
          setIsLoading(false);
        });
    }
  }, [chartReference, chartData, loadedChartData, isLoading, error, ticker]);

  // EXISTING: Fetch chart data if metadata is available but chartData is not provided
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
    const firstTimestamp = effectiveChartData[0].timestamp || effectiveChartData[0].timestamp_et;
    const firstDate = new Date(typeof firstTimestamp === 'string' ? firstTimestamp : firstTimestamp);
    const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    
    return effectiveChartData.every((point: any) => {
      const pointTimestamp = point.timestamp || point.timestamp_et;
      const pointDate = new Date(typeof pointTimestamp === 'string' ? pointTimestamp : pointTimestamp);
      const pointDay = new Date(pointDate.getFullYear(), pointDate.getMonth(), pointDate.getDate());
      return pointDay.getTime() === firstDay.getTime();
    });
  })();

  const hasChart = chartMetadata?.available || (effectiveChartData && effectiveChartData.length > 0);

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="p-3 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg">
        {!isIntradayOnly && (
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-gradient-to-r from-ai-accent to-ai-accent/80 text-primary-foreground text-xs shadow-sm">
                  {ticker}
                </Badge>
                {company && company !== ticker && (
                  <span className="text-xs text-muted-foreground font-medium">{company}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <motion.div 
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="font-semibold"
              >
                {formatCurrency(price)}
              </motion.div>
              {changePercent != null && (
                <motion.div 
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-xs flex items-center gap-1 justify-end font-medium ${isPositive ? 'text-positive' : 'text-negative'}`}
                >
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                </motion.div>
              )}
            </div>
          </div>
        )}
      {hasChart && (
        <>
          {isLoading ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-24 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <Loader2 className="w-5 h-5 text-ai-accent" />
              </motion.div>
              <span className="font-medium">Loading chart...</span>
            </motion.div>
          ) : error ? (
            <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
              Chart unavailable
            </div>
          ) : effectiveChartData && effectiveChartData.length > 0 ? (
            <>
              {isIntradayOnly && calculatedPreviousClose != null ? (
                <div className="w-full">
                  <IntradayMiniChart 
                    data={effectiveChartData.map((point: any) => {
                      // Handle timestamp conversion - timestamp_et is in ET timezone but labeled as UTC
                      // Example: "2025-11-21T08:00:27.296+00:00" means 8:00 AM ET (not UTC)
                      // We need to add 5 hours to get actual UTC timestamp for chart rendering
                      let timestamp;
                      
                      if (typeof point.timestamp === 'string') {
                        // Regular UTC timestamp
                        timestamp = new Date(point.timestamp).getTime();
                      } else if (typeof point.timestamp_et === 'string') {
                        // timestamp_et is ET time mislabeled as UTC
                        // Parse and add 5 hours (EST offset) to get correct UTC time
                        const etDate = new Date(point.timestamp_et);
                        timestamp = etDate.getTime() + (5 * 60 * 60 * 1000); // Add 5 hours
                      } else {
                        // Already a number
                        timestamp = point.timestamp || point.timestamp_et || 0;
                      }
                      
                      return {
                        timestamp,
                        value: point.price || point.value || 0
                        // Charts will calculate session from timestamp
                      };
                    })}
                    previousClose={calculatedPreviousClose}
                    currentPrice={price}
                    ticker={ticker}
                    company={company}
                    upcomingEventsCount={0}
                    width={350}
                    height={120}
                  />
                </div>
              ) : (
                <div className="h-12">
                  <SimpleMiniChart data={effectiveChartData} ticker={ticker} />
                </div>
              )}
            </>
          ) : null}
        </>
      )}
        <p className="text-[10px] text-muted-foreground/60 mt-2">Data from Catalyst (Supabase)</p>
      </Card>
    </motion.div>
  );
}