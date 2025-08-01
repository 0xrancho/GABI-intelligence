import { NextRequest, NextResponse } from 'next/server';
import { rateLimitStore } from '@/lib/rateLimitStore';
import { RateLimitResult, RateLimitHeaders } from './types';

export class RateLimiter {
  private static getClientIP(request: NextRequest): string {
    // Try to get real IP from headers (for proxies/load balancers)
    const forwarded = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');
    const cfIP = request.headers.get('cf-connecting-ip');
    
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwarded.split(',')[0].trim();
    }
    
    if (realIP) {
      return realIP;
    }
    
    if (cfIP) {
      return cfIP;
    }
    
    // Fallback to a default IP for development
    return '127.0.0.1';
  }

  private static getSessionId(request: NextRequest): string {
    // Try to get session ID from headers or generate one
    const sessionId = request.headers.get('x-session-id') || 
                     request.headers.get('session-id') ||
                     crypto.randomUUID();
    
    return sessionId;
  }

  private static createRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.resetTime.toString(),
      'X-RateLimit-Type': result.type,
    };

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);
      headers['Retry-After'] = retryAfterSeconds.toString();
    }

    return headers;
  }

  private static createRateLimitResponse(result: RateLimitResult, corsHeaders: Record<string, string>): NextResponse {
    const headers = this.createRateLimitHeaders(result);
    
    let message: string;
    let retryInfo: string;

    const retryAfterSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);
    const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
    const retryAfterHours = Math.ceil(retryAfterMinutes / 60);

    switch (result.type) {
      case 'requests':
        message = `Too many requests. You've exceeded the limit of ${result.limit} messages per hour.`;
        retryInfo = retryAfterHours >= 1 
          ? `Try again in ${retryAfterHours} hour${retryAfterHours > 1 ? 's' : ''}.`
          : `Try again in ${retryAfterMinutes} minute${retryAfterMinutes > 1 ? 's' : ''}.`;
        break;
      
      case 'tokens':
        message = `Daily token limit exceeded. You've reached the limit of ${result.limit} tokens per day.`;
        retryInfo = retryAfterHours >= 1 
          ? `Limit resets in ${retryAfterHours} hour${retryAfterHours > 1 ? 's' : ''}.`
          : `Limit resets in ${retryAfterMinutes} minute${retryAfterMinutes > 1 ? 's' : ''}.`;
        break;
      
      case 'sessions':
        message = `Too many concurrent sessions. Maximum ${result.limit} sessions allowed per IP address.`;
        retryInfo = 'Please close an existing session before starting a new one.';
        break;
      
      default:
        message = 'Rate limit exceeded.';
        retryInfo = 'Please try again later.';
    }

    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `${message} ${retryInfo}`,
        type: result.type,
        limit: result.limit,
        remaining: result.remaining,
        resetTime: result.resetTime,
      },
      {
        status: 429,
        headers: { ...headers, ...corsHeaders },
      }
    );
  }

  static async checkLimits(
    request: NextRequest,
    messageText: string,
    corsHeaders: Record<string, string> = {}
  ): Promise<NextResponse | null> {
    const ip = this.getClientIP(request);
    const sessionId = this.getSessionId(request);
    const estimatedTokens = rateLimitStore.estimateTokens(messageText);

    // Check request limit (messages per hour)
    const requestCheck = rateLimitStore.checkRequestLimit(ip);
    if (!requestCheck.allowed) {
      const result: RateLimitResult = {
        allowed: false,
        resetTime: requestCheck.resetTime,
        remaining: requestCheck.remaining,
        limit: rateLimitStore.getConfig().requests.limit,
        type: 'requests',
      };
      return this.createRateLimitResponse(result, corsHeaders);
    }

    // Check token limit (tokens per day)
    const tokenCheck = rateLimitStore.checkTokenLimit(ip, estimatedTokens);
    if (!tokenCheck.allowed) {
      const result: RateLimitResult = {
        allowed: false,
        resetTime: tokenCheck.resetTime,
        remaining: tokenCheck.remaining,
        limit: rateLimitStore.getConfig().tokens.limit,
        type: 'tokens',
      };
      return this.createRateLimitResponse(result, corsHeaders);
    }

    // Check session limit (concurrent sessions)
    const sessionCheck = rateLimitStore.checkSessionLimit(ip, sessionId);
    if (!sessionCheck.allowed) {
      const result: RateLimitResult = {
        allowed: false,
        resetTime: Date.now() + 60000, // Sessions don't have time-based reset
        remaining: sessionCheck.remaining,
        limit: rateLimitStore.getConfig().sessions.limit,
        type: 'sessions',
      };
      return this.createRateLimitResponse(result, corsHeaders);
    }

    // All checks passed
    return null;
  }

  static addRateLimitHeaders(
    response: NextResponse,
    request: NextRequest,
    messageText?: string
  ): NextResponse {
    const ip = this.getClientIP(request);
    const config = rateLimitStore.getConfig();
    
    // Get current limits for headers
    const requestCheck = rateLimitStore.checkRequestLimit(ip);
    const tokenCheck = messageText 
      ? rateLimitStore.checkTokenLimit(ip, 0) // Check without consuming
      : { remaining: config.tokens.limit, resetTime: Date.now() + config.tokens.windowMs };

    // Add rate limit headers to successful response
    response.headers.set('X-RateLimit-Requests-Limit', config.requests.limit.toString());
    response.headers.set('X-RateLimit-Requests-Remaining', requestCheck.remaining.toString());
    response.headers.set('X-RateLimit-Requests-Reset', requestCheck.resetTime.toString());
    
    response.headers.set('X-RateLimit-Tokens-Limit', config.tokens.limit.toString());
    response.headers.set('X-RateLimit-Tokens-Remaining', tokenCheck.remaining.toString());
    response.headers.set('X-RateLimit-Tokens-Reset', tokenCheck.resetTime.toString());
    
    response.headers.set('X-RateLimit-Sessions-Limit', config.sessions.limit.toString());

    return response;
  }

  static removeSession(request: NextRequest): void {
    const ip = this.getClientIP(request);
    const sessionId = this.getSessionId(request);
    rateLimitStore.removeSession(ip, sessionId);
  }

  // Helper method for debugging
  static getStoreStats() {
    return rateLimitStore.getStoreStats();
  }
}