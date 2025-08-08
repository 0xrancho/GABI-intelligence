import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'authorize';
    
    if (action === 'authorize') {
      // DEBUG: Log environment variables
      console.log('🔧 OAuth Debug Info:');
      console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
      console.log('CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '[SET]' : '[MISSING]');
      console.log('REDIRECT_URI env var:', process.env.GOOGLE_REDIRECT_URI);
      console.log('NEXT_PUBLIC_APP_URL:', process.env.NEXT_PUBLIC_APP_URL);
      
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google?action=callback`;
      console.log('Final redirect URI being used:', redirectUri);
      
      // Generate OAuth authorization URL
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
      );
      
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ];
      
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent', // Force consent to get refresh token
        state: 'calendar_setup' // Add state for security
      });
      
      console.log('Generated auth URL:', authUrl);
      console.log('🔧 OAuth Setup Complete - check logs above for debug info');
      
      return NextResponse.json({
        auth_url: authUrl,
        message: 'Visit the auth_url to authorize calendar access'
      }, { status: 200 });
      
    } else if (action === 'callback') {
      // Handle OAuth callback
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      
      if (error) {
        return NextResponse.json({
          error: 'OAUTH_ERROR',
          message: `OAuth authorization failed: ${error}`
        }, { status: 400 });
      }
      
      if (!code) {
        return NextResponse.json({
          error: 'MISSING_CODE',
          message: 'Authorization code not provided'
        }, { status: 400 });
      }
      
      if (state !== 'calendar_setup') {
        return NextResponse.json({
          error: 'INVALID_STATE',
          message: 'Invalid state parameter'
        }, { status: 400 });
      }
      
      // Exchange code for tokens
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google?action=callback`
      );
      
      const { tokens } = await oauth2Client.getToken(code);
      
      // Return tokens (in production, you'd store the refresh token securely)
      return NextResponse.json({
        success: true,
        message: 'Authorization successful',
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date
        },
        setup_instructions: {
          message: 'Add the refresh_token to your environment variables',
          env_var: 'GOOGLE_REFRESH_TOKEN',
          value: tokens.refresh_token
        }
      }, { status: 200 });
      
    } else {
      return NextResponse.json({
        error: 'INVALID_ACTION',
        message: 'Invalid action parameter. Use "authorize" or "callback"'
      }, { status: 400 });
    }
    
  } catch (error) {
    console.error('Google OAuth error:', error);
    
    if (error.message?.includes('invalid_grant')) {
      return NextResponse.json({
        error: 'INVALID_GRANT',
        message: 'Authorization code expired or invalid. Please try authorization again.'
      }, { status: 400 });
    }
    
    return NextResponse.json({
      error: 'OAUTH_FAILED',
      message: 'Google OAuth process failed'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    
    if (action === 'exchange_code') {
      // Handle manual code exchange (for testing/setup)
      const { code, redirect_uri } = body;
      
      if (!code) {
        return NextResponse.json({
          error: 'MISSING_CODE',
          message: 'Authorization code is required'
        }, { status: 400 });
      }
      
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri || 'urn:ietf:wg:oauth:2.0:oob'
      );
      
      const { tokens } = await oauth2Client.getToken(code);
      
      return NextResponse.json({
        success: true,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date
        },
        setup_instructions: {
          message: 'Add these tokens to your environment variables',
          env_vars: {
            GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
            GOOGLE_ACCESS_TOKEN: tokens.access_token
          }
        }
      }, { status: 200 });
      
    } else if (action === 'refresh_token') {
      // Test refresh token functionality
      if (!process.env.GOOGLE_REFRESH_TOKEN) {
        return NextResponse.json({
          error: 'NO_REFRESH_TOKEN',
          message: 'GOOGLE_REFRESH_TOKEN environment variable not set'
        }, { status: 400 });
      }
      
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      });
      
      // Test the refresh by making a simple API call
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const response = await calendar.calendarList.list();
      
      return NextResponse.json({
        success: true,
        message: 'Refresh token is working',
        calendars_found: response.data.items?.length || 0,
        primary_calendar: response.data.items?.find(cal => cal.primary)?.id
      }, { status: 200 });
      
    } else {
      return NextResponse.json({
        error: 'INVALID_ACTION',
        message: 'Invalid action. Use "exchange_code" or "refresh_token"'
      }, { status: 400 });
    }
    
  } catch (error) {
    console.error('Google OAuth POST error:', error);
    
    if (error.message?.includes('invalid_grant')) {
      return NextResponse.json({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired. Re-authorization required.'
      }, { status: 401 });
    }
    
    return NextResponse.json({
      error: 'AUTH_OPERATION_FAILED',
      message: 'Authentication operation failed'
    }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  // Handle CORS preflight
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}