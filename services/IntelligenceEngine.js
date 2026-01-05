/**
 * Intelligence Engine
 * Advanced analysis capabilities for the Catalyst AI Agent
 */

class IntelligenceEngine {
  /**
   * Calculate confidence score for the response
   * @param {Object} metadata - Data collection metadata
   * @returns {Object} Confidence analysis
   */
  static calculateConfidence(metadata) {
    const {
      totalSources = 0,
      sourceFreshness = [],
      dataCompleteness = {},
      queryType = 'general'
    } = metadata;

    let confidenceScore = 0;
    const factors = [];
    const warnings = [];

    // Factor 1: Number of sources (0-40 points)
    if (totalSources >= 5) {
      confidenceScore += 40;
      factors.push('Multiple data sources');
    } else if (totalSources >= 3) {
      confidenceScore += 30;
      factors.push('Several data sources');
    } else if (totalSources >= 2) {
      confidenceScore += 20;
      factors.push('Limited sources');
      warnings.push('Consider verifying with additional sources');
    } else if (totalSources === 1) {
      confidenceScore += 10;
      factors.push('Single source only');
      warnings.push('⚠️ Based on single source - treat as preliminary');
    }

    // Factor 2: Data freshness (0-30 points)
    const avgFreshnessDays = sourceFreshness.length > 0 
      ? sourceFreshness.reduce((a, b) => a + b, 0) / sourceFreshness.length 
      : 999;

    if (avgFreshnessDays <= 7) {
      confidenceScore += 30;
      factors.push('Very recent data (< 1 week)');
    } else if (avgFreshnessDays <= 30) {
      confidenceScore += 25;
      factors.push('Recent data (< 1 month)');
    } else if (avgFreshnessDays <= 90) {
      confidenceScore += 15;
      factors.push('Moderately recent data (< 3 months)');
    } else {
      confidenceScore += 5;
      factors.push('Older data (> 3 months)');
      warnings.push('⚠️ Data may be outdated - check for recent updates');
    }

    // Factor 3: Data completeness (0-30 points)
    const completenessScore = dataCompleteness.hasExpectedData ? 30 : 
                             dataCompleteness.hasPartialData ? 15 : 0;
    confidenceScore += completenessScore;

    if (dataCompleteness.hasExpectedData) {
      factors.push('Complete data coverage');
    } else if (dataCompleteness.hasPartialData) {
      factors.push('Partial data coverage');
      warnings.push('Some expected data missing');
    } else {
      factors.push('Limited data coverage');
      warnings.push('⚠️ Significant data gaps detected');
    }

    // Cap at 100
    confidenceScore = Math.min(100, confidenceScore);

    // Determine confidence level
    let confidenceLevel;
    if (confidenceScore >= 80) {
      confidenceLevel = 'High';
    } else if (confidenceScore >= 60) {
      confidenceLevel = 'Moderate';
    } else if (confidenceScore >= 40) {
      confidenceLevel = 'Low';
    } else {
      confidenceLevel = 'Very Low';
    }

    return {
      score: confidenceScore,
      level: confidenceLevel,
      factors,
      warnings,
      metadata: {
        sources: totalSources,
        avgFreshnessDays: Math.round(avgFreshnessDays),
        completeness: dataCompleteness
      }
    };
  }

  /**
   * Detect anomalies in data patterns
   * @param {Array} data - Time series data
   * @param {String} metric - What we're measuring
   * @returns {Array} Detected anomalies
   */
  static detectAnomalies(data, metric) {
    if (!data || data.length < 3) return [];

    const anomalies = [];
    
    // Calculate baseline statistics
    const values = data.map(d => d.value).filter(v => v !== null && v !== undefined);
    if (values.length === 0) return [];

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Detect outliers (> 2 standard deviations)
    data.forEach((point, index) => {
      if (point.value !== null && point.value !== undefined) {
        const zScore = Math.abs((point.value - mean) / stdDev);
        
        if (zScore > 2) {
          const percentChange = ((point.value - mean) / mean * 100).toFixed(1);
          anomalies.push({
            type: 'outlier',
            metric,
            value: point.value,
            expected: mean,
            deviation: percentChange,
            date: point.date,
            message: `⚠️ Unusual: ${metric} of ${point.value} is ${percentChange}% ${point.value > mean ? 'above' : 'below'} average`
          });
        }
      }
    });

    // Detect sudden changes between consecutive points
    for (let i = 1; i < data.length; i++) {
      if (data[i].value && data[i - 1].value) {
        const change = ((data[i].value - data[i - 1].value) / data[i - 1].value) * 100;
        
        if (Math.abs(change) > 100) { // >100% change
          anomalies.push({
            type: 'spike',
            metric,
            change: change.toFixed(1),
            from: data[i - 1].value,
            to: data[i].value,
            date: data[i].date,
            message: `📊 Spike: ${metric} changed ${change > 0 ? '+' : ''}${change.toFixed(1)}% from previous period`
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Identify missing data gaps
   * @param {Object} queryIntent - What user asked for
   * @param {Object} dataFetched - What data was actually retrieved
   * @returns {Array} Missing data items
   */
  static identifyMissingData(queryIntent, dataFetched) {
    const gaps = [];
    const today = new Date();

    // Check for missing tickers
    if (queryIntent.tickers && queryIntent.tickers.length > 0) {
      queryIntent.tickers.forEach(ticker => {
        if (!dataFetched.tickers || !dataFetched.tickers.includes(ticker)) {
          gaps.push({
            type: 'missing_ticker',
            ticker,
            message: `No data found for ${ticker}`,
            severity: 'high'
          });
        }
      });
    }

    // Check for missing SEC filings
    if (queryIntent.dataSources?.some(ds => ds.collection === 'sec_filings')) {
      const expectedForms = queryIntent.formTypes || ['10-K', '10-Q', '8-K'];
      const foundForms = dataFetched.secFilingTypes || [];
      
      expectedForms.forEach(form => {
        if (!foundForms.includes(form)) {
          gaps.push({
            type: 'missing_filing',
            formType: form,
            message: `No ${form} filings found in specified time range`,
            severity: 'medium'
          });
        }
      });
    }

    // Check for stale institutional ownership data
    if (queryIntent.dataSources?.some(ds => ds.collection === 'institutional_ownership')) {
      if (dataFetched.institutionalDataDate) {
        const dataDate = new Date(dataFetched.institutionalDataDate);
        const daysSinceUpdate = (today - dataDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceUpdate > 90) {
          gaps.push({
            type: 'stale_data',
            dataType: 'institutional_ownership',
            lastUpdate: dataDate.toLocaleDateString(),
            message: `Institutional ownership data is ${Math.round(daysSinceUpdate)} days old - next 13F filing may update this`,
            severity: 'low'
          });
        }
      }
    }

    // Check for expected upcoming events
    if (queryIntent.isFutureOutlook && (!dataFetched.upcomingEvents || dataFetched.upcomingEvents === 0)) {
      gaps.push({
        type: 'no_future_events',
        message: 'No scheduled events found - company may not have announced earnings dates',
        severity: 'medium'
      });
    }

    return gaps;
  }

  /**
   * Generate proactive follow-up suggestions
   * @param {Object} queryIntent - Original query
   * @param {Object} dataFetched - Data that was retrieved
   * @returns {Array} Suggested follow-up questions
   */
  static generateFollowUps(queryIntent, dataFetched) {
    const suggestions = [];
    const ticker = queryIntent.tickers?.[0];

    // Based on query type
    if (queryIntent.intent === 'sec_filings') {
      if (ticker) {
        suggestions.push(`What are the key risk factors for ${ticker}?`);
        suggestions.push(`Who are the major institutional investors in ${ticker}?`);
      }
      suggestions.push('How does this compare to competitors?');
    }

    if (queryIntent.intent === 'events') {
      if (ticker) {
        suggestions.push(`What's ${ticker}'s historical performance after similar events?`);
        suggestions.push(`Show me ${ticker}'s recent SEC filings`);
      }
    }

    if (queryIntent.isFutureOutlook) {
      if (ticker) {
        suggestions.push(`What are analysts saying about ${ticker}?`);
        suggestions.push(`Compare ${ticker}'s outlook to industry peers`);
      }
    }

    // Based on data found
    if (dataFetched.hasInstitutionalData) {
      suggestions.push('Which institutions increased their positions most?');
    }

    if (dataFetched.hasPolicyData) {
      suggestions.push('How might this policy affect my portfolio?');
    }

    if (dataFetched.hasEvents) {
      suggestions.push('What are the biggest upcoming catalysts?');
    }

    // Return top 3 unique suggestions
    return [...new Set(suggestions)].slice(0, 3);
  }

  /**
   * Perform cross-reference validation
   * @param {Object} dataPoints - Different data points to validate
   * @returns {Array} Validation results
   */
  static crossReferenceData(dataPoints) {
    const validations = [];

    // Check cash/financial data consistency
    if (dataPoints.cash && dataPoints.cash.length >= 2) {
      const sorted = dataPoints.cash.sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = sorted[0];
      const previous = sorted[1];

      const change = ((latest.value - previous.value) / previous.value * 100).toFixed(1);
      
      if (Math.abs(change) > 20) {
        validations.push({
          type: 'financial_change',
          metric: 'cash',
          change,
          message: `Cash position changed ${change}% from ${previous.source} (${previous.date}) to ${latest.source} (${latest.date})`,
          severity: Math.abs(change) > 50 ? 'high' : 'medium'
        });
      }
    }

    // Check for contradicting statements
    if (dataPoints.statements && dataPoints.statements.length >= 2) {
      // This would use NLP to detect contradictions - placeholder for now
      // Could check for opposite sentiments, conflicting numbers, etc.
    }

    return validations;
  }

  /**
   * Analyze temporal patterns
   * @param {Array} events - Time series events
   * @param {String} eventType - Type of events
   * @returns {Object} Pattern analysis
   */
  static analyzeTemporalPatterns(events, eventType) {
    if (!events || events.length < 2) {
      return { hasPattern: false };
    }

    // Sort by date
    const sorted = events.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate intervals between events
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }

    if (intervals.length === 0) {
      return { hasPattern: false };
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Pattern detected if intervals are consistent (low variance)
    const isRegular = stdDev < avgInterval * 0.3;

    const pattern = {
      hasPattern: isRegular,
      eventType,
      frequency: `${Math.round(avgInterval)} days`,
      totalEvents: events.length,
      message: isRegular 
        ? `${eventType} occurs regularly every ~${Math.round(avgInterval)} days`
        : `${eventType} frequency is irregular`,
      insights: []
    };

    // Recent frequency change detection
    if (intervals.length >= 4) {
      const recentAvg = intervals.slice(-2).reduce((a, b) => a + b, 0) / 2;
      const historicalAvg = intervals.slice(0, -2).reduce((a, b) => a + b, 0) / (intervals.length - 2);
      const change = ((recentAvg - historicalAvg) / historicalAvg * 100);

      if (Math.abs(change) > 50) {
        pattern.insights.push({
          type: 'frequency_change',
          message: `Filing frequency ${change > 0 ? 'decreased' : 'increased'} ${Math.abs(change.toFixed(0))}% recently`,
          change: change.toFixed(1)
        });
      }
    }

    return pattern;
  }

  /**
   * Generate comparative analysis
   * @param {Object} targetData - Data for target company
   * @param {Array} peerData - Data for peer companies
   * @param {String} metric - What to compare
   * @returns {Object} Comparative insights
   */
  static generateComparativeAnalysis(targetData, peerData, metric) {
    if (!targetData || !peerData || peerData.length === 0) {
      return { hasComparison: false };
    }

    const targetValue = targetData.value;
    const peerValues = peerData.map(p => p.value).filter(v => v !== null && v !== undefined);

    if (peerValues.length === 0) {
      return { hasComparison: false };
    }

    const peerMedian = peerValues.sort((a, b) => a - b)[Math.floor(peerValues.length / 2)];
    const peerAverage = peerValues.reduce((a, b) => a + b, 0) / peerValues.length;
    const peerMax = Math.max(...peerValues);
    const peerMin = Math.min(...peerValues);

    const vsMedian = ((targetValue - peerMedian) / peerMedian * 100).toFixed(1);
    const vsAverage = ((targetValue - peerAverage) / peerAverage * 100).toFixed(1);

    let ranking = peerValues.filter(v => v > targetValue).length + 1;
    let percentile = ((peerValues.length - ranking + 1) / peerValues.length * 100).toFixed(0);

    return {
      hasComparison: true,
      metric,
      targetValue,
      peerMedian,
      peerAverage,
      peerRange: { min: peerMin, max: peerMax },
      vsMedian,
      vsAverage,
      ranking,
      percentile,
      message: `${targetData.ticker}'s ${metric} of ${targetValue} is ${vsMedian > 0 ? '+' : ''}${vsMedian}% vs peer median`,
      insights: [
        `Ranks #${ranking} out of ${peerValues.length + 1} peers`,
        `${percentile}th percentile`,
        targetValue > peerMedian ? 'Above peer median' : 'Below peer median'
      ]
    };
  }
}

module.exports = IntelligenceEngine;
