/**
 * BlockRenderer.tsx
 * 
 * Renders a single ContentBlock in its final form.
 * This is a pure presentation component - all streaming logic is in useStreamingChat.
 */

import { motion } from 'motion/react';
import type { ContentBlock } from './lib/StreamBlockTypes';

// These will be imported from the main component file
// In a real setup, these would be separate component files
interface BlockRendererProps {
  block: ContentBlock;
  dataCards?: any[];
  eventData?: Record<string, any>;
  onEventClick?: (event: any) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
  // Component references (passed in to avoid circular imports)
  MarkdownText: React.ComponentType<any>;
  InlineChartCard: React.ComponentType<any>;
  DataCardComponent: React.ComponentType<any>;
  EventCardComponent: React.ComponentType<any>;
}

export function BlockRenderer({
  block,
  dataCards = [],
  eventData = {},
  onEventClick,
  onImageClick,
  onTickerClick,
  MarkdownText,
  InlineChartCard,
  DataCardComponent,
  EventCardComponent,
}: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return (
        <MarkdownText
          text={block.content || ''}
          dataCards={dataCards}
          onEventClick={onEventClick}
          onImageClick={onImageClick}
          onTickerClick={onTickerClick}
        />
      );

    case 'chart':
      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="my-3"
        >
          <InlineChartCard
            symbol={block.data?.symbol}
            timeRange={block.data?.timeRange}
          />
        </motion.div>
      );

    case 'article':
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="my-3"
        >
          <DataCardComponent
            type="article"
            data={block.data}
            onTickerClick={onTickerClick}
          />
        </motion.div>
      );

    case 'image':
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="my-3"
        >
          <DataCardComponent
            type="image"
            data={block.data}
            onImageClick={onImageClick}
          />
        </motion.div>
      );

    case 'event':
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="my-3"
        >
          <EventCardComponent
            event={block.data}
            onClick={() => onEventClick?.(block.data)}
          />
        </motion.div>
      );

    default:
      console.warn('Unknown block type:', block.type);
      return null;
  }
}

/**
 * Renders a list of ContentBlocks
 */
interface BlockListRendererProps {
  blocks: ContentBlock[];
  dataCards?: any[];
  eventData?: Record<string, any>;
  onEventClick?: (event: any) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
  MarkdownText: React.ComponentType<any>;
  InlineChartCard: React.ComponentType<any>;
  DataCardComponent: React.ComponentType<any>;
  EventCardComponent: React.ComponentType<any>;
}

export function BlockListRenderer({
  blocks,
  dataCards,
  eventData,
  onEventClick,
  onImageClick,
  onTickerClick,
  MarkdownText,
  InlineChartCard,
  DataCardComponent,
  EventCardComponent,
}: BlockListRendererProps) {
  return (
    <>
      {blocks.map((block) => (
        <BlockRenderer
          key={block.id}
          block={block}
          dataCards={dataCards}
          eventData={eventData}
          onEventClick={onEventClick}
          onImageClick={onImageClick}
          onTickerClick={onTickerClick}
          MarkdownText={MarkdownText}
          InlineChartCard={InlineChartCard}
          DataCardComponent={DataCardComponent}
          EventCardComponent={EventCardComponent}
        />
      ))}
    </>
  );
}

export default BlockRenderer;
