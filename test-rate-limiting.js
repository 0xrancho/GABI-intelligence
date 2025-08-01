// Test script for rate limiting functionality
// Run with: node test-rate-limiting.js

const BASE_URL = 'http://localhost:3000/api/chat';

async function makeRequest(sessionId = null, messageText = 'Hello') {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }

  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: messageText }]
      })
    });

    const data = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log(`Session ID: ${sessionId || 'none'}`);
    console.log(`Rate Limit Headers:`);
    console.log(`  Requests Limit: ${response.headers.get('x-ratelimit-requests-limit')}`);
    console.log(`  Requests Remaining: ${response.headers.get('x-ratelimit-requests-remaining')}`);
    console.log(`  Tokens Remaining: ${response.headers.get('x-ratelimit-tokens-remaining')}`);
    
    if (response.status === 429) {
      console.log(`Rate Limited: ${data.type} - ${data.message}`);
      console.log(`Retry After: ${response.headers.get('retry-after')} seconds`);
    } else if (data.message) {
      console.log(`Response: ${data.message.substring(0, 100)}...`);
    }
    
    console.log('---');
    
    return { success: response.status === 200, status: response.status };
  } catch (error) {
    console.error('Request failed:', error.message);
    return { success: false, status: 0 };
  }
}

async function testRequestRateLimit() {
  console.log('=== Testing Request Rate Limit (10 messages per hour) ===');
  
  for (let i = 1; i <= 12; i++) {
    console.log(`Request ${i}/12:`);
    const result = await makeRequest(null, `Test message ${i}`);
    
    if (!result.success && result.status === 429) {
      console.log(`✓ Rate limit triggered at request ${i}`);
      break;
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function testTokenRateLimit() {
  console.log('\n=== Testing Token Rate Limit (5000 tokens per day) ===');
  
  // Create a large message (~2000 tokens worth of text)
  const largeMessage = 'This is a very long message that will consume many tokens. '.repeat(100);
  
  for (let i = 1; i <= 4; i++) {
    console.log(`Large request ${i}/4:`);
    const result = await makeRequest(`token-test-${i}`, largeMessage);
    
    if (!result.success && result.status === 429) {
      console.log(`✓ Token rate limit triggered at request ${i}`);
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function testSessionRateLimit() {
  console.log('\n=== Testing Session Rate Limit (3 concurrent sessions max) ===');
  
  const promises = [];
  
  for (let i = 1; i <= 5; i++) {
    console.log(`Starting session ${i}/5`);
    const sessionId = `session-${i}`;
    promises.push(makeRequest(sessionId, `Message from session ${i}`));
  }
  
  const results = await Promise.all(promises);
  
  const failed = results.filter(r => !r.success && r.status === 429);
  if (failed.length > 0) {
    console.log(`✓ Session rate limit triggered, ${failed.length} requests blocked`);
  }
}

async function runTests() {
  console.log('Starting Rate Limiting Tests...');
  console.log('Make sure your dev server is running on http://localhost:3000\n');
  
  try {
    await testRequestRateLimit();
    await testTokenRateLimit();
    await testSessionRateLimit();
    
    console.log('\n=== Test Summary ===');
    console.log('All rate limiting tests completed!');
    console.log('Check the output above to verify the limits are working correctly.');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}