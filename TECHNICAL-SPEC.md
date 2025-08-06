# Technical Specification - GABI Qualify

## Architecture Overview

### Core Components
```
├── src/app/api/chat/route.ts           # Main conversation handler
├── src/lib/conversationIntelligence.ts # Natural conversation logic  
├── src/lib/leadCapture.ts              # Session management
├── src/lib/airtableClient.ts           # CRM integration
├── src/lib/googleCalendar.ts           # Calendar integration
├── src/components/ChatWidget.tsx       # Frontend interface
└── src/middleware/rateLimiter.ts       # API protection
```

## API Endpoints

### POST /api/chat
**Purpose**: Main conversation endpoint with agentic function calling
**Input**: 
```typescript
{
  messages: ConversationMessage[],
  sessionId?: string,
  captureHint?: string
}
```
**Output**:
```typescript
{
  message: string
}
```

## Function Calling System

### Natural Tools (Always Available)
- `capture_anything`: Organic information gathering
- `share_relevant_experience`: Portfolio credibility building
- `assess_fit_naturally`: Dynamic qualification assessment

### Qualified Tools (Context-Dependent)  
- `check_calendar_availability`: Real Google Calendar integration
- `book_calendar_meeting`: Direct meeting scheduling
- `save_conversation_to_crm`: Strategic endpoint detection

## Data Models

### SessionState
```typescript
interface SessionState {
  sessionId: string;
  contactInfo?: ContactInfo;
  discoveryContext?: DiscoveryContext;
  qualificationStatus?: QualificationStatus;
  schedulingContext?: SchedulingContext;
  conversationFlow: ConversationFlow;
  crmSaved: boolean;
}
```

### ConversationMessage  
```typescript
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}
```

## Integration Points

### OpenAI GPT-4o
- **Model**: `gpt-4o` with function calling
- **Temperature**: 0.7 for natural responses
- **Max Tokens**: 1500 per response
- **Tool Structure**: OpenAI function calling format

### Google Calendar API
- **Service Account**: JWT authentication
- **Scopes**: `calendar.events`, `calendar.readonly`
- **Rate Limits**: 1000 requests/100 seconds/user
- **Timezone**: America/New_York (ET)

### Airtable CRM
- **Base**: Lead qualification and contact management
- **Tables**: Contacts, Sessions, Interactions
- **API**: REST API with personal access tokens
- **Rate Limits**: 5 requests/second

## Environment Configuration

### Required Variables
```bash
OPENAI_API_KEY=sk-...
GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account",...}
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
CALENDLY_LINK=https://calendly.com/joel-austin/...
```

## Current Implementation Status

### ✅ Completed
- Natural conversation flow with OpenAI function calling
- Session state management and persistence  
- Airtable CRM integration with lead capture
- Rate limiting and API protection
- Strategic CRM endpoint detection

### 🔧 Recently Fixed  
- **Function Calling Error**: Fixed malformed followUpMessages structure
- **Content Field Issue**: Added `|| null` for OpenAI compatibility
- **Debug Logging**: Enhanced function call ID tracking

### 📋 Monitoring Points
- Token usage optimization (currently ~3000-5000 tokens/conversation)
- Rate limiting effectiveness (should prevent cascade failures)
- CRM save accuracy (strategic endpoint detection)
- Calendar API quota usage

## Development Guidelines

### Code Patterns
- **Error Handling**: Always provide fallback responses
- **Token Efficiency**: Load RAG data only when contextually relevant
- **Session Management**: Update state incrementally, not bulk
- **Function Calls**: Ensure proper OpenAI message structure

### Testing Approach
- **Unit Tests**: Individual function handlers  
- **Integration Tests**: Full conversation flows
- **Manual Testing**: Real OpenAI API calls with debug logging
- **Performance Tests**: Token usage and response times