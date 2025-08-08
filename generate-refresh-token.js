const { google } = require('googleapis');
const readline = require('readline');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Your Google OAuth2 credentials (from .env.local)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';

// Validate required environment variables
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Error: Missing required environment variables');
  console.error('Please ensure your .env.local file contains:');
  console.error('GOOGLE_CLIENT_ID=your-client-id');
  console.error('GOOGLE_CLIENT_SECRET=your-client-secret');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Scopes for Google Calendar access
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

console.log('🔐 Google Calendar OAuth2 Refresh Token Generator\n');

// Step 1: Generate authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
});

console.log('1. Open this URL in your browser:');
console.log('\n' + authUrl + '\n');
console.log('2. Sign in with the Google account that has access to joel@commitimpact.com calendar');
console.log('3. Grant calendar permissions');
console.log('4. Copy the authorization code from the browser\n');

// Step 2: Get authorization code from user
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the authorization code: ', async (code) => {
  try {
    // Step 3: Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('\n✅ Success! Here are your tokens:');
    console.log('\n📋 Add this to your .env.local file:');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`\n🔐 Access Token (expires in 1 hour): ${tokens.access_token}`);
    console.log(`\n⏰ Token Type: ${tokens.token_type}`);
    
    if (tokens.expiry_date) {
      console.log(`\n⏰ Expires: ${new Date(tokens.expiry_date).toLocaleString()}`);
    }
    
    console.log('\n🎉 Your refresh token will allow the app to access Google Calendar on behalf of this Google account.');
    console.log('\n⚠️  Keep the refresh token secure - it provides ongoing access to the calendar.');
    
  } catch (error) {
    console.error('❌ Error exchanging authorization code:', error.message);
  } finally {
    rl.close();
  }
});