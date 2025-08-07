export interface RateLimitResult {
  allowed: boolean;
  resetTime: number;
  remaining: number;
  limit: number;
  type: 'requests' | 'tokens' | 'sessions' | 'burst';
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
  resetTime?: number; // For daily session limits
}

export interface RateLimitStore {
  requests: Map<string, RequestLimitData>;
  tokens: Map<string, TokenLimitData>;
  sessions: Map<string, SessionLimitData>;
  burstRequests: Map<string, RequestLimitData>;
}

export interface RateLimitConfig {
  requests: {
    limit: number;
    windowMs: number;
    burstLimit: number;
    burstWindowMs: number;
  };
  tokens: {
    limit: number;
    windowMs: number;
  };
  sessions: {
    limit: number;
    windowMs: number;
    exemptIPs: string[];
  };
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'X-RateLimit-Type': string;
  'Retry-After'?: string;
}