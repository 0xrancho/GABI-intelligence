import { 
  RateLimitStore, 
  RateLimitConfig
} from '@/middleware/types';

class RateLimitStoreManager {
  private store: RateLimitStore;
  private config: RateLimitConfig;
  private cleanupIntervals: NodeJS.Timeout[];

  constructor() {
    this.store = {
      requests: new Map(),
      tokens: new Map(),
      sessions: new Map(),
    };

    this.config = {
      requests: {
        limit: 10,
        windowMs: 60 * 60 * 1000, // 1 hour
      },
      tokens: {
        limit: 5000,
        windowMs: 24 * 60 * 60 * 1000, // 24 hours
      },
      sessions: {
        limit: 3,
      },
    };

    this.cleanupIntervals = [];
    this.startCleanupTasks();
  }

  private startCleanupTasks(): void {
    // Clean expired request limits every 10 minutes
    const requestCleanup = setInterval(() => {
      this.cleanExpiredEntries(this.store.requests);
    }, 10 * 60 * 1000);

    // Clean expired token limits every hour
    const tokenCleanup = setInterval(() => {
      this.cleanExpiredEntries(this.store.tokens);
    }, 60 * 60 * 1000);

    this.cleanupIntervals.push(requestCleanup, tokenCleanup);
  }

  private cleanExpiredEntries<T extends { resetTime: number }>(map: Map<string, T>): void {
    const now = Date.now();
    for (const [key, value] of map.entries()) {
      if (now >= value.resetTime) {
        map.delete(key);
      }
    }
  }

  checkRequestLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const data = this.store.requests.get(ip);

    if (!data || now >= data.resetTime) {
      // Reset or create new entry
      const resetTime = now + this.config.requests.windowMs;
      this.store.requests.set(ip, { count: 1, resetTime });
      return {
        allowed: true,
        remaining: this.config.requests.limit - 1,
        resetTime,
      };
    }

    if (data.count >= this.config.requests.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: data.resetTime,
      };
    }

    // Increment count
    data.count++;
    return {
      allowed: true,
      remaining: this.config.requests.limit - data.count,
      resetTime: data.resetTime,
    };
  }

  checkTokenLimit(ip: string, estimatedTokens: number): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const data = this.store.tokens.get(ip);

    if (!data || now >= data.resetTime) {
      // Reset or create new entry
      const resetTime = now + this.config.tokens.windowMs;
      const newUsage = estimatedTokens;
      this.store.tokens.set(ip, { dailyUsage: newUsage, resetTime });
      
      return {
        allowed: newUsage <= this.config.tokens.limit,
        remaining: Math.max(0, this.config.tokens.limit - newUsage),
        resetTime,
      };
    }

    const newTotal = data.dailyUsage + estimatedTokens;
    
    if (newTotal > this.config.tokens.limit) {
      return {
        allowed: false,
        remaining: Math.max(0, this.config.tokens.limit - data.dailyUsage),
        resetTime: data.resetTime,
      };
    }

    // Update usage
    data.dailyUsage = newTotal;
    return {
      allowed: true,
      remaining: this.config.tokens.limit - newTotal,
      resetTime: data.resetTime,
    };
  }

  checkSessionLimit(ip: string, sessionId: string): { allowed: boolean; remaining: number } {
    const data = this.store.sessions.get(ip);

    if (!data) {
      // Create new entry
      this.store.sessions.set(ip, {
        activeCount: 1,
        sessionIds: new Set([sessionId]),
      });
      return {
        allowed: true,
        remaining: this.config.sessions.limit - 1,
      };
    }

    // If session already exists, it's allowed
    if (data.sessionIds.has(sessionId)) {
      return {
        allowed: true,
        remaining: this.config.sessions.limit - data.activeCount,
      };
    }

    // Check if we can add a new session
    if (data.activeCount >= this.config.sessions.limit) {
      return {
        allowed: false,
        remaining: 0,
      };
    }

    // Add new session
    data.sessionIds.add(sessionId);
    data.activeCount++;
    
    return {
      allowed: true,
      remaining: this.config.sessions.limit - data.activeCount,
    };
  }

  removeSession(ip: string, sessionId: string): void {
    const data = this.store.sessions.get(ip);
    if (data && data.sessionIds.has(sessionId)) {
      data.sessionIds.delete(sessionId);
      data.activeCount = data.sessionIds.size;
      
      // Clean up empty entries
      if (data.activeCount === 0) {
        this.store.sessions.delete(ip);
      }
    }
  }

  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    // This is a conservative estimate for OpenAI models
    return Math.ceil(text.length / 4);
  }

  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  // For testing and debugging
  getStoreStats(): {
    requestEntries: number;
    tokenEntries: number;
    sessionEntries: number;
    totalSessions: number;
  } {
    const totalSessions = Array.from(this.store.sessions.values())
      .reduce((sum, data) => sum + data.activeCount, 0);

    return {
      requestEntries: this.store.requests.size,
      tokenEntries: this.store.tokens.size,
      sessionEntries: this.store.sessions.size,
      totalSessions,
    };
  }

  // Cleanup method for graceful shutdown
  cleanup(): void {
    this.cleanupIntervals.forEach(interval => clearInterval(interval));
    this.cleanupIntervals = [];
  }
}

// Singleton instance
export const rateLimitStore = new RateLimitStoreManager();