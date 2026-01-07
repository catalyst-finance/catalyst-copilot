import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Card } from '../ui/card';
import { IntradayMiniChart } from '../charts';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface InlineChartCardProps {
  symbol: string;
  timeRange: string;
  onTickerClick?: (ticker: string) => void;
}

/**
 * InlineChartCard - Renders a mini price chart for a symbol inline in the response
 * Used when VIEW_CHART markers are detected in AI responses
 */
export default function InlineChartCard({ 
  symbol, 
  timeRange, 
  onTickerClick 
}: InlineChartCardProps) {
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
            limit = 720; // Full extended hours: pre-market (90min) + regular (390min) + after-hours (240min)
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
        
        // Fetch current quote with session-aware baseline from backend API
        // Backend handles pre-market/post-market session logic automatically
        const quoteUrl = `https://catalyst-copilot-2nndy.ondigitalocean.app/api/quote/${symbol}`;

        const [priceRes, quoteRes] = await Promise.all([
          fetch(priceUrl, {
            headers: {
              'apikey': publicAnonKey,
              'Authorization': `Bearer ${publicAnonKey}`
            }
          }),
          fetch(quoteUrl)
        ]);

        if (!priceRes.ok) throw new Error('Failed to fetch price data');
        if (!quoteRes.ok) throw new Error('Failed to fetch quote data');
        
        const prices = await priceRes.json();
        const quoteResult = await quoteRes.json();

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
        
        // Use backend-calculated quote data (session-aware baseline already handled)
        if (quoteResult.success && quoteResult.data) {
          setQuoteData(quoteResult.data);
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
            <IntradayMiniChart 
              data={chartData}
              ticker={symbol}
              previousClose={quoteData?.previous_close ?? null}
              currentPrice={quoteData?.close ?? (chartData[chartData.length - 1]?.value || 0)}
              width={350}
              height={120}
              onTickerClick={onTickerClick}
            />
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
