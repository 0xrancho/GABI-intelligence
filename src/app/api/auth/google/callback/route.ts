import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    
    console.log('🔧 OAuth Callback Debug:');
    console.log('Code:', code ? '[RECEIVED]' : '[MISSING]');
    console.log('State:', state);
    console.log('Error:', error);
    
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
      process.env.GOOGLE_REDIRECT_URI
    );
    
    console.log('🔧 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    console.log('✅ Tokens received successfully');
    
    // Return tokens with setup instructions
    return NextResponse.json({
      success: true,
      message: '🎉 OAuth Authorization Successful!',
      tokens: {
        access_token: tokens.access_token?.substring(0, 20) + '...',
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      },
      setup_instructions: {
        title: '📋 Add this to your .env.local file:',
        env_var: 'GOOGLE_REFRESH_TOKEN',
        value: tokens.refresh_token,
        next_steps: [
          '1. Copy the refresh_token value above',
          '2. Add GOOGLE_REFRESH_TOKEN=your_token_here to .env.local',
          '3. Restart your development server',
          '4. Test calendar functions'
        ]
      }
    }, { status: 200 });
    
  } catch (error) {
    console.error('❌ Google OAuth callback error:', error);
    
    if (error.message?.includes('invalid_grant')) {
      return NextResponse.json({
        error: 'INVALID_GRANT',
        message: 'Authorization code expired or invalid. Please try authorization again.',
        retry_url: '/api/auth/google?action=authorize'
      }, { status: 400 });
    }
    
    return NextResponse.json({
      error: 'OAUTH_CALLBACK_FAILED',
      message: 'OAuth callback processing failed',
      details: error.message
    }, { status: 500 });
  }
}