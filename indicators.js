// indicators.js - Technical Indicators for SIGNAL DESK
// All functions are plain JavaScript (no modules needed)

// ============================================
// 1. ATR (Average True Range) Calculator
// ============================================
function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
        console.warn('Not enough candle data for ATR calculation');
        return 0;
    }
    
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
    }
    
    // Simple moving average of true ranges
    let sum = 0;
    const startIndex = trueRanges.length - period;
    for (let i = startIndex; i < trueRanges.length; i++) {
        sum += trueRanges[i];
    }
    return sum / period;
}

// ============================================
// 2. Stop Loss & Take Profit Calculator
// ============================================
function calculateSLTP(currentPrice, atr, riskMultiplier = 1.5, rewardMultiplier = 2.5) {
    if (!currentPrice || !atr || atr <= 0) {
        return {
            stopLoss: currentPrice * 0.99,
            takeProfit: currentPrice * 1.01,
            riskRewardRatio: 1.67,
            riskPercent: '1.00',
            rewardPercent: '1.00'
        };
    }
    
    const stopLoss = currentPrice - (atr * riskMultiplier);
    const takeProfit = currentPrice + (atr * rewardMultiplier);
    
    return {
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        riskRewardRatio: rewardMultiplier / riskMultiplier,
        riskPercent: ((atr * riskMultiplier) / currentPrice * 100).toFixed(2),
        rewardPercent: ((atr * rewardMultiplier) / currentPrice * 100).toFixed(2)
    };
}

// ============================================
// 3. SMA (Simple Moving Average)
// ============================================
function calculateSMA(candles, period) {
    if (!candles || candles.length < period) return 0;
    
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += candles[i].close;
    }
    return sum / period;
}

// ============================================
// 4. RSI (Relative Strength Index)
// ============================================
function calculateRSI(candles, period = 14) {
    if (!candles || candles.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i-1].close;
        if (change >= 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ============================================
// 5. MACD (Simplified)
// ============================================
function calculateMACD(candles) {
    const ema12 = calculateEMA(candles, 12);
    const ema26 = calculateEMA(candles, 26);
    const macdLine = ema12 - ema26;
    const signalLine = calculateEMA(candles, 9); // Simplified
    
    return {
        macdLine: macdLine,
        signalLine: signalLine,
        histogram: macdLine - signalLine,
        isPositive: macdLine > signalLine,
        isRising: macdLine > 0 // Simplified check
    };
}

// ============================================
// 6. EMA (Exponential Moving Average) - Helper
// ============================================
function calculateEMA(candles, period) {
    if (!candles || candles.length < period) return 0;
    
    const multiplier = 2 / (period + 1);
    let ema = candles[0].close;
    
    for (let i = 1; i < candles.length; i++) {
        ema = (candles[i].close - ema) * multiplier + ema;
    }
    return ema;
}

// ============================================
// 7. Multi-timeframe Signal Aggregator
// ============================================
async function getMultiTimeframeSignal(apiKey) {
    if (!apiKey || apiKey === 'FSV8DNHVT1B0D6OK9.') {
        return {
            action: '⚠️ Please enter a valid Alpha Vantage API key',
            confidence: 0,
            details: 'API key missing or invalid'
        };
    }
    
    const baseUrl = 'https://www.alphavantage.co/query';
    
    try {
        // Fetch Daily data
        const dailyRes = await fetch(
            `${baseUrl}?function=FX_DAILY&from_symbol=EUR&to_symbol=USD&apikey=${apiKey}&outputsize=compact`
        );
        const dailyData = await dailyRes.json();
        
        // Fetch 60min (hourly) data
        const hourlyRes = await fetch(
            `${baseUrl}?function=FX_INTRADAY&from_symbol=EUR&to_symbol=USD&interval=60min&apikey=${apiKey}&outputsize=compact`
        );
        const hourlyData = await hourlyRes.json();
        
        // Parse data
        const dailyCandles = parseCandles(dailyData['Time Series FX (Daily)']);
        const hourlyCandles = parseCandles(hourlyData['Time Series FX (60min)']);
        
        if (!dailyCandles || !hourlyCandles || dailyCandles.length < 20) {
            return {
                action: '⚠️ Insufficient data for multi-timeframe analysis',
                confidence: 0,
                details: 'Need at least 20 candles per timeframe'
            };
        }
        
        // Calculate signals for each timeframe
        const dailySignal = calculateSimpleSignal(dailyCandles);
        const hourlySignal = calculateSimpleSignal(hourlyCandles);
        
        // Combine signals
        if (dailySignal.direction === hourlySignal.direction && dailySignal.direction !== 'NEUTRAL') {
            const avgConfidence = (dailySignal.confidence + hourlySignal.confidence) / 2;
            return {
                action: `✅ STRONG ${dailySignal.direction}`,
                confidence: avgConfidence,
                details: `Daily: ${dailySignal.direction} (${dailySignal.confidence}%) | Hourly: ${hourlySignal.direction} (${hourlySignal.confidence}%)`
            };
        } else if (dailySignal.direction !== 'NEUTRAL' && hourlySignal.direction === 'NEUTRAL') {
            return {
                action: `⚠️ WEAK ${dailySignal.direction} - Hourly neutral`,
                confidence: dailySignal.confidence * 0.7,
                details: `Daily: ${dailySignal.direction} (${dailySignal.confidence}%) | Hourly: NEUTRAL`
            };
        } else {
            return {
                action: '❌ CONFLICT - Wait for alignment',
                confidence: 0,
                details: `Daily: ${dailySignal.direction} | Hourly: ${hourlySignal.direction}`
            };
        }
        
    } catch (error) {
        console.error('Multi-timeframe error:', error);
        return {
            action: '❌ Error fetching multi-timeframe data',
            confidence: 0,
            details: error.message
        };
    }
}

// ============================================
// 8. Parse Alpha Vantage data
// ============================================
function parseCandles(data) {
    if (!data) return [];
    
    return Object.keys(data).map(date => ({
        date: date,
        open: parseFloat(data[date]['1. open']),
        high: parseFloat(data[date]['2. high']),
        low: parseFloat(data[date]['3. low']),
        close: parseFloat(data[date]['4. close'])
    }));
}

// ============================================
// 9. Simple Signal Calculator (matches your existing logic)
// ============================================
function calculateSimpleSignal(candles) {
    if (!candles || candles.length < 50) {
        return { direction: 'NEUTRAL', confidence: 0 };
    }
    
    const sma20 = calculateSMA(candles, 20);
    const sma50 = calculateSMA(candles, 50);
    const rsi = calculateRSI(candles, 14);
    const lastClose = candles[candles.length - 1].close;
    
    let score = 0;
    let signals = [];
    
    // SMA crossover
    if (sma20 > sma50) {
        score += 1;
        signals.push('SMA bullish cross');
    } else {
        score -= 1;
        signals.push('SMA bearish cross');
    }
    
    // RSI
    if (rsi > 60) {
        score += 1;
        signals.push('RSI bullish');
    } else if (rsi < 40) {
        score -= 1;
        signals.push('RSI bearish');
    } else {
        signals.push('RSI neutral');
    }
    
    // Price vs SMA20
    if (lastClose > sma20) {
        score += 0.5;
        signals.push('Price above SMA20');
    } else {
        score -= 0.5;
        signals.push('Price below SMA20');
    }
    
    // Last candle check (bullish engulfing simulation)
    if (candles.length > 1) {
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        if (last.close > last.open && prev.close < prev.open && last.close > prev.open) {
            score += 1;
            signals.push('Bullish engulfing');
        } else if (last.close < last.open && prev.close > prev.open && last.close < prev.open) {
            score -= 1;
            signals.push('Bearish engulfing');
        }
    }
    
    // Determine direction
    let direction = 'NEUTRAL';
    let confidence = 0;
    
    if (score >= 2) {
        direction = 'BUY';
        confidence = Math.min(65 + (score - 2) * 5, 85);
    } else if (score <= -2) {
        direction = 'SELL';
        confidence = Math.min(65 + (Math.abs(score) - 2) * 5, 85);
    } else if (score > 0) {
        direction = 'LEAN BUY';
        confidence = 55 + score * 5;
    } else if (score < 0) {
        direction = 'LEAN SELL';
        confidence = 55 + Math.abs(score) * 5;
    } else {
        direction = 'NEUTRAL';
        confidence = 50;
    }
    
    return {
        direction: direction,
        confidence: Math.round(confidence),
        signals: signals,
        score: score,
        sma20: sma20,
        sma50: sma50,
        rsi: rsi
    };
}

// ============================================
// 10. Position Size Calculator
// ============================================
function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLossPrice) {
    if (!accountBalance || !riskPercent || !entryPrice || !stopLossPrice) {
        return { size: 0, riskAmount: 0 };
    }
    
    const riskAmount = accountBalance * (riskPercent / 100);
    const priceDifference = Math.abs(entryPrice - stopLossPrice);
    
    if (priceDifference === 0) {
        return { size: 0, riskAmount: riskAmount };
    }
    
    const size = riskAmount / priceDifference;
    
    return {
        size: size,
        riskAmount: riskAmount,
        riskPercent: riskPercent,
        priceDifference: priceDifference
    };
}

// ============================================
// 11. Backtest Function (Bonus!)
// ============================================
function backtestStrategy(candles, initialBalance = 1000) {
    if (!candles || candles.length < 50) {
        return {
            trades: 0,
            winRate: '0%',
            totalReturn: '0%',
            profitFactor: '0',
            finalBalance: initialBalance,
            error: 'Not enough data'
        };
    }
    
    let balance = initialBalance;
    let position = null;
    let trades = [];
    let winners = 0;
    let losers = 0;
    
    for (let i = 50; i < candles.length; i++) {
        const slice = candles.slice(0, i);
        const signal = calculateSimpleSignal(slice);
        const currentPrice = candles[i].close;
        const atr = calculateATR(slice, 14);
        
        // Entry
        if (signal.direction === 'BUY' && !position) {
            const stopLoss = currentPrice - atr * 1.5;
            const takeProfit = currentPrice + atr * 2.5;
            const riskAmount = balance * 0.02;
            const size = riskAmount / (currentPrice - stopLoss);
            
            position = {
                type: 'BUY',
                entry: currentPrice,
                stopLoss: stopLoss,
                takeProfit: takeProfit,
                size: size,
                entryIndex: i
            };
        }
        // Exit
        else if (position) {
            let pnl = 0;
            let exitReason = '';
            
            if (currentPrice <= position.stopLoss) {
                pnl = (position.stopLoss - position.entry) * position.size;
                exitReason = 'STOP LOSS';
                losers++;
            } else if (currentPrice >= position.takeProfit) {
                pnl = (position.takeProfit - position.entry) * position.size;
                exitReason = 'TAKE PROFIT';
                winners++;
            }
            
            if (exitReason) {
                balance += pnl;
                trades.push({
                    entry: position.entry,
                    exit: currentPrice,
                    pnl: pnl,
                    exitReason: exitReason,
                    barsHeld: i - position.entryIndex
                });
                position = null;
            }
        }
    }
    
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winners / totalTrades * 100) : 0;
    const totalPnL = balance - initialBalance;
    const profitFactor = trades.filter(t => t.pnl > 0).reduce((s,t) => s + t.pnl, 0) / 
                        Math.abs(trades.filter(t => t.pnl < 0).reduce((s,t) => s + t.pnl, 0) || 1);
    
    return {
        trades: totalTrades,
        winRate: winRate.toFixed(1) + '%',
        totalReturn: ((balance / initialBalance - 1) * 100).toFixed(2) + '%',
        profitFactor: profitFactor.toFixed(2),
        finalBalance: Math.round(balance),
        winners: winners,
        losers: losers
    };
}

// ============================================
// Export for use (if using ES6 modules)
// ============================================
// If you're using script tags, these are already globally available
// If you're using ES6 modules, uncomment the line below:
// export { calculateATR, calculateSLTP, getMultiTimeframeSignal, calculateSMA, calculateRSI, calculateMACD, calculateSimpleSignal, calculatePositionSize, backtestStrategy };