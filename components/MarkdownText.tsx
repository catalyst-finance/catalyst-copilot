import { FileText } from 'lucide-react';
import type { DataCard, ImageCardData, ArticleCardData } from './lib/StreamBlockTypes';
import { MarketEvent } from '../../utils/supabase/events-api';
import DataCardComponent from './DataCardComponent';
import InlineChartCard from './InlineChartCard';
import { useEffect } from 'react';

interface MarkdownTextProps {
  text: string;
  dataCards?: DataCard[];
  onEventClick?: (event: MarketEvent) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
  isUserMessage?: boolean;
}

export default function MarkdownText({ text, dataCards, onEventClick, onImageClick, onTickerClick, isUserMessage }: MarkdownTextProps) {
  // Text is already pre-processed by the streaming block extractor
  const mainText = text;
  
  // DEBUG: Log dataCards and article markers
  useEffect(() => {
    const articleMarkers = text.match(/\[VIEW_ARTICLE:([^\]]+)\]/g);
    if (articleMarkers && articleMarkers.length > 0) {
      const extractedIds = articleMarkers.map(m => m.match(/\[VIEW_ARTICLE:([^\]]+)\]/)?.[1]).filter(Boolean);
      const articleCards = dataCards?.filter(c => c.type === 'article') || [];
      const articleCardIds = articleCards.map(c => c.data.id);
      
      console.log(`🔍 [MarkdownText] Found ${articleMarkers.length} VIEW_ARTICLE markers in text:`, extractedIds);
      console.log(`🔍 [MarkdownText] Available article dataCards (${articleCards.length}):`, articleCardIds);
      console.log(`🔍 [MarkdownText] Marker/Card matching:`, {
        markersInText: extractedIds,
        cardsAvailable: articleCardIds,
        missing: extractedIds.filter(id => !articleCardIds.includes(id)),
        timestamp: new Date().toISOString().split('T')[1]
      });
    }
  }, [text, dataCards]);
  
  // ARTICLE RENDERING STRATEGY:
  // Articles are rendered ONLY from inline [VIEW_ARTICLE:...] markers in the content text.
  // The backend's article_block SSE events are DISABLED because they arrive before the content,
  // causing articles to render in the wrong position (before the text that discusses them).
  // 
  // This component handles three scenarios:
  // 1. Inline markers in paragraphs: "text here [VIEW_ARTICLE:id]" → renders text, then card
  // 2. Inline markers in list items: "1. text [VIEW_ARTICLE:id]" → renders list, then card  
  // 3. Standalone markers: "[VIEW_ARTICLE:id]" on own line → renders card directly
  
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
    const lines = content.split('\n');
    const elements: JSX.Element[] = [];
    let uniqueKeyCounter = 0;
    
    let currentList: string[] = [];
    let currentParagraph: string[] = [];
    let pendingImageCards: string[] = []; // Track IMAGE_CARD markers to render after paragraph
    let pendingArticleCards: string[] = []; // Track VIEW_ARTICLE markers to render after paragraph
    let isAfterList = false; // Track if we're rendering content immediately after a bullet list
    
    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        // Apply indentation only if this paragraph is directly under a bulleted list
        // Use mb-0 for user messages, mb-[30px] for AI responses
        const paragraphClass = isAfterList 
          ? `leading-relaxed ${isUserMessage ? 'mb-0' : 'mb-[30px]'} ml-6`
          : `leading-relaxed ${isUserMessage ? 'mb-0' : 'mb-[30px]'}`;
        
        elements.push(
          <p key={`para-${uniqueKeyCounter++}`} className={paragraphClass}>
            {parseInlineFormatting(currentParagraph.join(' '))}
          </p>
        );
        currentParagraph = [];
        
        // After flushing paragraph, add any pending image cards
        if (pendingImageCards.length > 0) {
          pendingImageCards.forEach(imageId => {
            insertImageCard(imageId);
          });
          pendingImageCards = [];
        }
        
        // DO NOT flush article cards here - they should only render where explicitly placed
        // Article cards will be flushed at the end of all content or when explicitly placed
      }
    };
    
    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(
          <ul key={`list-${uniqueKeyCounter++}`} className="space-y-2 my-3 ml-4">
            {currentList.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5 flex-shrink-0">•</span>
                <span className="flex-1 leading-relaxed">{parseInlineFormatting(item)}</span>
              </li>
            ))}
          </ul>
        );
        currentList = [];
        isAfterList = true; // Mark that following paragraphs should be indented
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
              <DataCardComponent card={eventCard} onEventClick={onEventClick} onImageClick={onImageClick} onTickerClick={onTickerClick} />
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
              <DataCardComponent card={imageCard} onEventClick={onEventClick} onImageClick={onImageClick} onTickerClick={onTickerClick} />
            </div>
          );
        }
      }
    };
    
    const insertArticleCard = (articleId: string) => {
      // Find the matching article card
      console.log(`🔍 [insertArticleCard] Looking for article ID: ${articleId}`);
      console.log(`🔍 [insertArticleCard] Available dataCards:`, dataCards?.filter(c => c.type === 'article').map(c => c.data.id));
      
      if (dataCards) {
        const articleCard = dataCards.find(card => 
          card.type === 'article' && card.data.id === articleId
        );
        
        if (articleCard) {
          console.log(`✅ [insertArticleCard] Found article card for ${articleId}, rendering...`);
          elements.push(
            <div key={`article-card-${articleId}-${uniqueKeyCounter++}`} className="my-3">
              <DataCardComponent card={articleCard} onEventClick={onEventClick} onImageClick={onImageClick} onTickerClick={onTickerClick} />
            </div>
          );
        } else {
          console.warn(`⚠️ [insertArticleCard] Article card NOT FOUND for ${articleId}`);
        }
      } else {
        console.warn(`⚠️ [insertArticleCard] No dataCards available`);
      }
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
      
      // DO NOT extract VIEW_ARTICLE markers here - they should be rendered inline where they appear
      // (similar to VIEW_CHART markers which are handled in the main line processing loop)
      
      // NOTE: VIEW_CHART markers should NOT be removed here - they need to be detected
      // in the main line processing loop to render InlineChartCard components
      
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
          // EXCLUDE: [HR] (horizontal rule marker - should be handled at block level)
          const sourceRegex = /\[(?!HR\])([^\]]+)\]/g;
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
      
      // Check for VIEW_CHART marker
      const viewChartMatch = trimmedLine.match(/\[VIEW_CHART:([A-Z]+):([^\]]+)\]/);
      const hasViewChart = viewChartMatch !== null;
      
      // Check for VIEW_ARTICLE marker (standalone on its own line)
      const viewArticleMatch = trimmedLine.match(/\[VIEW_ARTICLE:([^\]]+)\]/);
      const hasViewArticle = viewArticleMatch !== null;
      const isStandaloneViewArticle = hasViewArticle && trimmedLine.replace(/\[VIEW_ARTICLE:([^\]]+)\]/, '').trim().length === 0;
      
      // Check if line is ONLY an IMAGE_CARD (standalone) - not mixed with text
      const isStandaloneImageCard = hasImageCard && trimmedLine.replace(/\[IMAGE_CARD:([^\]]+)\]/, '').trim().length === 0;
      
      // Check if line is ONLY a VIEW_CHART (standalone) - not mixed with text
      const isStandaloneViewChart = hasViewChart && trimmedLine.replace(/\[VIEW_CHART:([A-Z]+):([^\]]+)\]/, '').trim().length === 0;
      
      // Check if this is a list item (with or without event card)
      const isListItem = trimmedLine.match(/^(\d+\.|-|•)\s+/) || trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ');
      
      // Check if this is an indented continuation of a list item (2+ leading spaces, not itself a list marker)
      const isListContinuation = /^  +/.test(line) && !isListItem && currentList.length > 0 && trimmedLine.length > 0;
      
      // Check if this is a numbered article title (e.g., "1. **Article Title Here**")
      // These should be rendered as headings, not list items
      const numberedArticleTitleMatch = trimmedLine.match(/^(\d+\.)\s+\*\*(.+?)\*\*$/);
      const isNumberedArticleTitle = numberedArticleTitleMatch !== null;
      
      if (line.startsWith('### ')) {
        flushParagraph();
        flushList();
        isAfterList = false; // Reset list context
        elements.push(
          <h3 key={`h3-${index}`} className="font-semibold mt-4 mb-2">
            {parseInlineFormatting(line.substring(4))}
          </h3>
        );
      } else if (line.startsWith('## ')) {
        flushParagraph();
        flushList();
        isAfterList = false; // Reset list context
        elements.push(
          <h2 key={`h2-${index}`} className="font-semibold text-base mt-4 mb-2">
            {parseInlineFormatting(line.substring(3))}
          </h2>
        );
      } else if (line.startsWith('# ')) {
        flushParagraph();
        flushList();
        isAfterList = false; // Reset list context
        elements.push(
          <h1 key={`h1-${index}`} className="font-semibold text-lg mt-4 mb-2">
            {parseInlineFormatting(line.substring(2))}
          </h1>
        );
      } else if (trimmedLine.match(/^\*\*[^*]+\*\*$/) && trimmedLine.length < 100) {
        // Detect bold text on its own line as a subheading (e.g., **Q4 2025**, **2026 Roadmap**)
        flushParagraph();
        flushList();
        isAfterList = false; // Reset list context
        
        const headerText = trimmedLine.replace(/^\*\*|\*\*$/g, '');
        const isCurrentPriceHeader = /^current price$/i.test(headerText.trim());
        
        elements.push(
          <h3 key={`h3-bold-${index}`} className="font-semibold mt-4 mb-2">
            {parseInlineFormatting(trimmedLine)}
          </h3>
        );
      } else if (isNumberedArticleTitle && numberedArticleTitleMatch) {
        // Numbered article title (e.g., "1. **Truist Cuts Tesla...**")
        // Render as a heading, not a list item
        flushParagraph();
        flushList();
        isAfterList = false; // Reset list context
        
        const articleTitle = numberedArticleTitleMatch[2]; // Just the title text without ** and number
        elements.push(
          <h3 key={`h3-article-${index}`} className="font-semibold mt-4 mb-2">
            {parseInlineFormatting(`**${articleTitle}**`)}
          </h3>
        );
      } else if (isListItem) {
        flushParagraph();
        isAfterList = false; // Reset when starting a new list
        
        // List item - extract text and remove EVENT_CARD/IMAGE_CARD/VIEW_ARTICLE markers if present
        let itemText = trimmedLine.replace(/^(\d+\.\s+|-\s+|•\s+)/, '');
        
        if (hasEventCard) {
          // Remove the EVENT_CARD marker from the text
          itemText = itemText.replace(/\[EVENT_CARD:[^\]]+\]/, '').trim();
        }
        if (hasImageCard) {
          // Remove the IMAGE_CARD marker from the text
          itemText = itemText.replace(/\[IMAGE_CARD:[^\]]+\]/, '').trim();
        }
        if (hasViewArticle && viewArticleMatch) {
          // Remove the VIEW_ARTICLE marker from the text
          itemText = itemText.replace(/\[VIEW_ARTICLE:[^\]]+\]/, '').trim();
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
        // If there's a view article marker, flush the list and insert it
        if (hasViewArticle && viewArticleMatch) {
          flushList();
          insertArticleCard(viewArticleMatch[1]);
        }
      } else if (isListContinuation) {
        // Indented continuation of a list item
        if (currentList.length > 0) {
          currentList[currentList.length - 1] += ' ' + trimmedLine;
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
      } else if (isStandaloneViewChart && viewChartMatch) {
        // View chart on its own line - render chart inline
        flushParagraph();
        flushList();
        const symbol = viewChartMatch[1];
        const timeRange = viewChartMatch[2];
        elements.push(
          <div key={`chart-${symbol}-${timeRange}-${uniqueKeyCounter++}`} className="my-3">
            <InlineChartCard 
              symbol={symbol} 
              timeRange={timeRange} 
              onTickerClick={onTickerClick} 
            />
          </div>
        );
      } else if (isStandaloneViewArticle && viewArticleMatch) {
        // View article on its own line - render article card inline
        flushParagraph();
        flushList();
        insertArticleCard(viewArticleMatch[1]);
      } else if (hasViewArticle && viewArticleMatch) {
        // View article marker mixed with text - split the line
        flushList();
        
        // Extract text before the marker
        const parts = trimmedLine.split(/\[VIEW_ARTICLE:([^\]]+)\]/);
        
        // parts[0] = text before marker
        // parts[1] = article ID
        // parts[2] = text after marker (if any)
        
        if (parts[0] && parts[0].trim()) {
          currentParagraph.push(parts[0].trim());
        }
        
        // Flush the paragraph with text before the marker
        flushParagraph();
        
        // Render the article card
        if (parts[1]) {
          insertArticleCard(parts[1]);
        }
        
        // If there's text after the marker, add it to a new paragraph
        if (parts[2] && parts[2].trim()) {
          currentParagraph.push(parts[2].trim());
        }
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
  
  return (
    <div className="space-y-0.5">
      <div>{renderContent(mainText)}</div>
    </div>
  );
}