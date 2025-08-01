export interface RateLimitResult {
  allowed: boolean;
  resetTime: number;
  remaining: number;
  limit: number;
  type: 'requests' | 'tokens' | 'sessions';
}

export interface RequestLimitData {
  count: number;
  resetTime: number;
}

export interface TokenLimitData {
  dailyUsage: number;
  resetTime: number;
}

export interface SessionLimitData {
  activeCount: number;
  sessionIds: Set<string>;
}

export interface RateLimitStore {
  requests: Map<string, RequestLimitData>;
  tokens: Map<string, TokenLimitData>;
  sessions: Map<string, SessionLimitData>;
}

export interface RateLimitConfig {
  requests: {
    limit: number;
    windowMs: number;
  };
  tokens: {
    limit: number;
    windowMs: number;
  };
  sessions: {
    limit: number;
  };
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'X-RateLimit-Type': string;
  'Retry-After'?: string;
}