# QA Log - GABI Qualify

Living document for tracking bugs, fixes, and testing results.

## Current Status: ✅ FIXED
**Function Calling Error - RESOLVED**
- **Date**: 2025-08-06
- **Issue**: OpenAI function calling error breaking conversations
- **Root Cause**: Missing `content: null` in assistant message with tool_calls
- **Fix Applied**: `src/app/api/chat/route.ts:847` - Added `|| null` to content field
- **Debug Added**: Console logs for tool call ID tracking
- **Status**: Ready for testing

## Testing Queue
- [ ] Test function calling flow end-to-end
- [ ] Verify rate limiting errors resolved
- [ ] Test qualification conversation flow
- [ ] Validate CRM data saves correctly

## Known Issues
*None currently reported*

## Recent Fixes
### 2025-08-06: Function Calling Structure
**Problem**: `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`
**Solution**: 
```diff
- content: assistantMessage.content,
+ content: assistantMessage.content || null,
```
**Impact**: Resolves conversation breaking and rate limit cascade

## Debug Patterns
- Function call errors → Check message structure in followUpMessages
- Rate limit issues → Often caused by error cascades, fix root cause first  
- CRM save failures → Check session state and contact info completeness

## Test Commands
```bash
# Run Next.js dev server
npm run dev

# Test rate limiting
node test-rate-limiting.js

# Check logs
tail -f logs/conversations-*.json
```