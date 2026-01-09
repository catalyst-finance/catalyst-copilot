import { motion } from 'motion/react';
import { Calendar, BarChart3, AlertCircle, Target, TrendingUp, DollarSign, Sparkles, Package, ShoppingCart, Presentation, Users, Landmark, Handshake, Building, Tag, Shield, Scale, ExternalLink, FileText } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { DataCard, ImageCardData, ArticleCardData, StockCardData } from './lib/StreamBlockTypes';
import { MarketEvent } from '../../utils/supabase/events-api';
import { getEventTypeConfig, formatEventDateTime } from '../../utils/formatting';
import StockCard from './StockCard';

interface DataCardComponentProps {
  card: DataCard;
  onEventClick?: (event: MarketEvent) => void;
  onImageClick?: (imageUrl: string) => void;
  onTickerClick?: (ticker: string) => void;
}

export default function DataCardComponent({ card, onEventClick, onImageClick, onTickerClick }: DataCardComponentProps) {
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
    return <StockCard data={card.data as StockCardData} onTickerClick={onTickerClick} />;
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
    
    // Map country names to ISO 3166-1 alpha-2 codes for flag display
    const countryToCode: Record<string, string> = {
      'United States': 'us', 'USA': 'us', 'US': 'us',
      'United Kingdom': 'gb', 'UK': 'gb',
      'China': 'cn', 'Germany': 'de', 'France': 'fr', 'Japan': 'jp',
      'Canada': 'ca', 'Australia': 'au', 'India': 'in', 'Brazil': 'br',
      'Russia': 'ru', 'South Korea': 'kr', 'Mexico': 'mx', 'Spain': 'es',
      'Italy': 'it', 'Netherlands': 'nl', 'Switzerland': 'ch', 'Sweden': 'se',
      'Poland': 'pl', 'Belgium': 'be', 'Norway': 'no', 'Austria': 'at',
      'Ireland': 'ie', 'Denmark': 'dk', 'Finland': 'fi', 'Portugal': 'pt',
      'Greece': 'gr', 'Czech Republic': 'cz', 'Romania': 'ro', 'Hungary': 'hu',
      'Turkey': 'tr', 'Israel': 'il', 'Singapore': 'sg', 'Thailand': 'th',
      'Malaysia': 'my', 'Philippines': 'ph', 'Vietnam': 'vn', 'Indonesia': 'id',
      'Saudi Arabia': 'sa', 'UAE': 'ae', 'South Africa': 'za', 'Nigeria': 'ng',
      'Argentina': 'ar', 'Chile': 'cl', 'Colombia': 'co', 'Peru': 'pe'
    };
    
    // Check if this is a macro article with a country - use flag instead of article image
    const isMacroArticle = articleData.country && articleData.country.trim().length > 0;
    const countryCode = isMacroArticle ? countryToCode[articleData.country!] || articleData.country!.toLowerCase().substring(0, 2) : null;
    // Use SVG for perfect scaling at any resolution, or w320 PNG for high-DPI displays
    const flagUrl = countryCode ? `https://flagcdn.com/${countryCode}.svg` : null;
    
    return (
      <motion.div
        whileHover={{ scale: 1.01, y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="p-3 bg-gradient-to-br from-background to-muted/20 border-2 hover:border-ai-accent/30 transition-all hover:shadow-lg overflow-hidden">
          <div className="flex gap-3">
            {/* Article image or country flag (for macro) or site logo */}
            <div className="flex-shrink-0">
              {isMacroArticle && flagUrl ? (
                <div className="w-24 h-16 rounded-lg overflow-hidden border border-border/50 bg-white dark:bg-muted/20">
                  <img 
                    src={flagUrl} 
                    alt={`${articleData.country} flag`} 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : articleData.imageUrl ? (
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
