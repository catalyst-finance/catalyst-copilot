/**
 * AnimatedTextBlock.tsx
 * 
 * A wrapper component that animates text content character-by-character
 * during streaming for a smoother, more natural feel.
 */

import { useState, useEffect, useRef, memo } from 'react';

interface AnimatedTextBlockProps {
  /** The full text content to display/animate */
  text: string;
  /** Whether streaming is currently in progress */
  isStreaming: boolean;
  /** Milliseconds per character (lower = faster). Default: 12ms (~83 chars/sec) */
  speed?: number;
  /** Characters to reveal per tick. Default: 2 */
  charsPerTick?: number;
  /** Render function that receives the animated text */
  children: (animatedText: string, isAnimating: boolean) => React.ReactNode;
}

/**
 * Animates text content character-by-character for smooth streaming feel.
 * When streaming ends, immediately shows remaining text.
 */
function AnimatedTextBlockInner({
  text,
  isStreaming,
  speed = 12,
  charsPerTick = 2,
  children,
}: AnimatedTextBlockProps) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const targetLengthRef = useRef(text.length);

  // Update target length when text changes
  useEffect(() => {
    targetLengthRef.current = text.length;
  }, [text]);

  // Animation loop
  useEffect(() => {
    // When streaming stops, immediately show all text
    if (!isStreaming) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setDisplayedLength(text.length);
      return;
    }

    // If we need to animate more text
    if (displayedLength < text.length) {
      const animate = (timestamp: number) => {
        if (timestamp - lastTimeRef.current >= speed) {
          lastTimeRef.current = timestamp;
          
          setDisplayedLength(prev => {
            const target = targetLengthRef.current;
            const next = Math.min(prev + charsPerTick, target);
            return next;
          });
        }
        
        // Continue if we haven't caught up
        if (displayedLength < targetLengthRef.current) {
          frameRef.current = requestAnimationFrame(animate);
        }
      };
      
      frameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [text, displayedLength, isStreaming, speed, charsPerTick]);

  const displayedText = text.substring(0, displayedLength);
  const isAnimating = isStreaming && displayedLength < text.length;

  return <>{children(displayedText, isAnimating)}</>;
}

// Memoize to prevent unnecessary re-renders
export const AnimatedTextBlock = memo(AnimatedTextBlockInner);

export default AnimatedTextBlock;
