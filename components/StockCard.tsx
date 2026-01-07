import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { StockCardData } from '../catalyst-copilot';
import { SimpleMiniChart, IntradayMiniChart } from '../charts';
import { formatCurrency } from '../utils/formatting';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface StockCardProps {
  data: StockCardData;
  onTickerClick?: (ticker: string) => void;
}

export default function StockCard({ data, onTickerClick }: StockCardProps) {
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
                <Badge 
                  className="bg-gradient-to-r from-ai-accent to-ai-accent/80 text-primary-foreground text-xs shadow-sm cursor-pointer hover:from-ai-accent/90 hover:to-ai-accent/70 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTickerClick) {
                      onTickerClick(ticker);
                    }
                  }}
                >
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
                    onTickerClick={onTickerClick}
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
