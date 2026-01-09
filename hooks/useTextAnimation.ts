/**
 * useTextAnimation.ts
 * 
 * A hook for smooth character-by-character text reveal animation.
 * Uses requestAnimationFrame for smooth 60fps rendering.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTextAnimationOptions {
  /** Milliseconds per character (default: 15ms = ~67 chars/sec) */
  speed?: number;
  /** Characters to reveal per tick (default: 1) */
  charsPerTick?: number;
  /** Whether animation is enabled (default: true) */
  enabled?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
}

interface UseTextAnimationReturn {
  /** The currently displayed (animated) text */
  displayedText: string;
  /** Whether animation is currently in progress */
  isAnimating: boolean;
  /** Skip to end of animation */
  skipToEnd: () => void;
  /** Percentage of text revealed (0-100) */
  progress: number;
}

/**
 * Hook for animating text character-by-character
 * 
 * @param targetText - The full text to animate towards
 * @param options - Animation configuration options
 * @returns Animation state and controls
 * 
 * @example
 * ```tsx
 * const { displayedText, isAnimating } = useTextAnimation(fullText, { speed: 20 });
 * return <p>{displayedText}{isAnimating && <span className="cursor">▌</span>}</p>;
 * ```
 */
export function useTextAnimation(
  targetText: string,
  options: UseTextAnimationOptions = {}
): UseTextAnimationReturn {
  const {
    speed = 15,
    charsPerTick = 1,
    enabled = true,
    onComplete
  } = options;

  const [displayedText, setDisplayedText] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Refs for animation frame management
  const animationFrameRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const currentIndexRef = useRef<number>(0);
  const targetTextRef = useRef<string>(targetText);
  const onCompleteRef = useRef(onComplete);

  // Keep onComplete ref updated
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Update target text ref when it changes
  useEffect(() => {
    targetTextRef.current = targetText;
  }, [targetText]);

  // Skip to end function
  const skipToEnd = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setDisplayedText(targetTextRef.current);
    currentIndexRef.current = targetTextRef.current.length;
    setIsAnimating(false);
    onCompleteRef.current?.();
  }, []);

  // Main animation effect
  useEffect(() => {
    if (!enabled) {
      // When disabled, show full text immediately
      setDisplayedText(targetText);
      currentIndexRef.current = targetText.length;
      setIsAnimating(false);
      return;
    }

    // If target text grew, start/continue animation
    if (targetText.length > currentIndexRef.current) {
      setIsAnimating(true);
      
      const animate = (timestamp: number) => {
        // Check if enough time has passed since last tick
        if (timestamp - lastTickTimeRef.current >= speed) {
          lastTickTimeRef.current = timestamp;
          
          // Calculate how many characters to reveal
          const currentTarget = targetTextRef.current;
          const newIndex = Math.min(
            currentIndexRef.current + charsPerTick,
            currentTarget.length
          );
          
          if (newIndex > currentIndexRef.current) {
            currentIndexRef.current = newIndex;
            setDisplayedText(currentTarget.substring(0, newIndex));
          }
          
          // Check if animation is complete
          if (currentIndexRef.current >= currentTarget.length) {
            setIsAnimating(false);
            onCompleteRef.current?.();
            return;
          }
        }
        
        // Continue animation
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      
      // Start animation loop
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [targetText, speed, charsPerTick, enabled]);

  // Calculate progress
  const progress = targetText.length > 0 
    ? Math.round((displayedText.length / targetText.length) * 100)
    : 100;

  return {
    displayedText,
    isAnimating,
    skipToEnd,
    progress
  };
}

/**
 * Simpler hook variant that just handles the animation state
 * Good for cases where you want to animate multiple text blocks
 */
export function useAnimatedText(
  text: string,
  isStreaming: boolean,
  speedMs: number = 15
): string {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    // When streaming ends, show all remaining text immediately
    if (!isStreaming && text.length > indexRef.current) {
      setDisplayed(text);
      indexRef.current = text.length;
      return;
    }

    // Animate new characters
    if (text.length > indexRef.current) {
      const animate = (timestamp: number) => {
        if (timestamp - lastTimeRef.current >= speedMs) {
          lastTimeRef.current = timestamp;
          
          const newIndex = Math.min(indexRef.current + 1, text.length);
          if (newIndex > indexRef.current) {
            indexRef.current = newIndex;
            setDisplayed(text.substring(0, newIndex));
          }
          
          if (indexRef.current >= text.length) {
            return;
          }
        }
        frameRef.current = requestAnimationFrame(animate);
      };
      
      frameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [text, isStreaming, speedMs]);

  return displayed;
}

export default useTextAnimation;
