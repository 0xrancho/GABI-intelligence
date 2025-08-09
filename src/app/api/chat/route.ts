import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { scoringCriteria, joelProfile } from '@/lib/scoring';
import { RateLimiter } from '@/middleware/rateLimiter';
import AirtableClient, { SessionState } from '@/lib/airtableClient';
import { sessionManager, leadCapture } from '@/lib/leadCapture';
import { googleCalendar } from '@/lib/googleCalendar';

// Add CORS headers function
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // or 'https://joelaustin.xyz'
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Handle OPTIONS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface ChatRequest {
  messages: ConversationMessage[];
  sessionId?: string;
  captureHint?: string;
}

// Initialize CRM client
const airtable = new AirtableClient();

async function loadDocument(filename: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'data', filename);
  return await fs.readFile(filePath, 'utf8');
}

export async function POST(request: NextRequest) {
  try {
    const { messages, sessionId, captureHint }: ChatRequest = await request.json();
    
    // Validate messages array
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Get the latest user message for rate limiting
    const latestMessage = messages[messages.length - 1];
    const messageText = latestMessage?.content || '';

    // Check rate limits
    const rateLimitResponse = await RateLimiter.checkLimits(
      request, 
      messageText, 
      corsHeaders()
    );
    
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Load reference documents
    const [gabiPersonality, portfolioProofs, fitTemplate] = await Promise.all([
      loadDocument('gabi-personality.md'),
      loadDocument('portfolio-proofs.csv'),
      loadDocument('fit-analysis-template.txt')
    ]);

    // Get or initialize session state
    let sessionState: SessionState | null = null;
    if (sessionId) {
      sessionState = sessionManager.getSession(sessionId);
      if (!sessionState) {
        sessionState = sessionManager.initializeSession(sessionId);
      }
    }

    // Enhanced conversation with token-optimized capabilities
    const response = await handleAgenticConversation(messages, {
      sessionId,
      sessionState
    });

    // Add rate limit headers to successful response
    return RateLimiter.addRateLimitHeaders(response, request, messageText);

  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Helper function to estimate tokens (rough approximation: 1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Helper function to log token usage details
function logTokenUsage(label: string, systemPrompt: string, messages: ConversationMessage[], tools: any[]) {
  console.log(`\n=== TOKEN USAGE ANALYSIS - ${label} ===`);
  
  // System prompt analysis
  console.log(`📝 System Prompt: ${systemPrompt.length} chars (~${estimateTokens(systemPrompt)} tokens)`);
  
  // Function definitions analysis
  const toolsJson = JSON.stringify(tools);
  console.log(`🔧 Function Definitions: ${toolsJson.length} chars (~${estimateTokens(toolsJson)} tokens)`);
  
  // Conversation history analysis
  let totalConversationChars = 0;
  messages.forEach((msg, index) => {
    const msgChars = msg.content.length;
    totalConversationChars += msgChars;
    console.log(`💬 Message ${index + 1} (${msg.role}): ${msgChars} chars (~${estimateTokens(msg.content)} tokens)`);
  });
  
  console.log(`📊 Total Conversation: ${totalConversationChars} chars (~${estimateTokens(totalConversationChars.toString())} tokens)`);
  
  // Overall estimate
  const totalEstimated = estimateTokens(systemPrompt) + estimateTokens(toolsJson) + estimateTokens(totalConversationChars.toString());
  console.log(`🎯 ESTIMATED TOTAL INPUT: ~${totalEstimated} tokens`);
  console.log(`=== END TOKEN ANALYSIS ===\n`);
}

// STRATEGIC CRM SAVE - Only at conversation endpoints
async function handleStrategicCRMSave(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) {
    return 'Conversation context saved.';
  }

  try {
    const { sessionManager } = await import('@/lib/leadCapture');
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return 'Unable to save conversation context.';
    }

    // Build comprehensive CRM record (works for ALL sessions - qualified and unqualified)
    const crmData = {
      // Contact Information (capture whatever we have)
      'Contact Name': session.contactInfo?.name || session.contactInfo?.contactName || 'Anonymous',
      'Contact Email': session.contactInfo?.email || session.contactInfo?.contactEmail || '',
      'Company': session.contactInfo?.company || '',
      'Role': session.contactInfo?.role || '',
      
      // Business Context (capture partial information too)
      'Business Challenge': session.discoveryContext?.painPoint || 'Not specified',
      'Urgency Catalyst': session.discoveryContext?.catalyst || '',
      'Success Vision': session.discoveryContext?.successVision || '',
      'Project Scope': session.discoveryContext?.projectScope || '',
      
      // Qualification Results (even if incomplete)
      'Qualification Status': session.qualificationStatus?.qualified === true ? 'Qualified' : 
                             session.qualificationStatus?.qualified === false ? 'Not Qualified' : 'Not Assessed',
      'Qualification Score': session.qualificationStatus?.confidenceScore || 0,
      'Qualification Reasoning': session.qualificationStatus?.reasoning || 'Assessment incomplete',
      
      // Session Metadata (universal)
      'Source': 'GABI Qualify',
      'Session Outcome': args.session_outcome,
      'Conversation Summary': args.conversation_summary,
      'Prospect Quality': args.prospect_quality,
      'Recommended Action': args.recommended_action,
      'Interaction Value': args.interaction_value,
      
      // Meeting Information (if applicable)
      'Meeting Scheduled': session.schedulingContext?.eventId ? 'Yes' : 'No',
      'Meeting Date': session.schedulingContext?.eventId ? 
        new Date().toISOString() : '', // Would need actual meeting date from calendar
      'Meeting Link': session.schedulingContext?.meetLink || '',
      
      // Analytics Data (universal)
      'First Contact': (session.createdAt || new Date()).toISOString(),
      'Last Updated': new Date().toISOString(),
      'Conversation Length': session.conversationState?.turnCount || 0,
      'User Timezone': 'Not detected', // Could be enhanced
      'Device Type': 'Web', // Could be enhanced
      
      // Lead Scoring (universal)
      'Lead Temperature': args.prospect_quality.includes('qualified') ? 'Hot' : 
                         args.prospect_quality === 'exploring' ? 'Warm' : 'Cold',
      'Follow Up Priority': args.session_outcome === 'meeting_booked' ? 'High' :
                           args.session_outcome === 'meeting_recommended' ? 'Medium' : 'Low'
    };
    
    // Save to Airtable (every session gets saved)
    const contact = await airtable.upsertContact(sessionId, crmData);
    
    // Generate response based on outcome
    let response = '';
    
    switch (args.session_outcome) {
      case 'meeting_recommended':
        response = 'I\'ve saved your details. Let me know if you\'d like to check Joel\'s calendar!';
        break;
      case 'meeting_booked':
        response = 'Perfect! All your details are saved and Joel will be prepared for your meeting.';
        break;
      case 'email_recommended':
        response = 'I\'ve noted your information so Joel can follow up when you\'re ready.';
        break;
      case 'resources_recommended':
        response = 'I\'ve saved your details. Those resources should be helpful for your situation.';
        break;
      case 'user_close':
        response = 'Thanks for the conversation! I\'ve saved your information in case you want to reconnect.';
        break;
      case 'explicit_save':
        response = 'Absolutely! All your details are saved and Joel can follow up when timing is better.';
        break;
      default:
        response = 'Your session has been saved.';
    }
    
    // Mark session as saved to prevent duplicates
    if (session) {
      session.crmSaved = true;
      sessionManager.updateSession(sessionId, session);
    }
    
    return response;
    
  } catch (error) {
    console.error('Strategic CRM save error:', error);
    return 'I\'ve noted your information for follow-up.';
  }
}

// NATURAL FUNCTION HANDLERS - SESSION ONLY (NO CRM WRITES)
async function handleNaturalCapture(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Got it!';

  try {
    const { updateSessionWithContext } = await import('@/lib/leadCapture');
    
    // ONLY update session state - NO Airtable writes during conversation
    const updates: any = {};
    
    if (args.contact_info) {
      updates.contactInfo = args.contact_info;
    }
    
    if (args.business_context) {
      updates.discoveryContext = {};
      if (args.business_context.challenge) {
        updates.discoveryContext.painPoint = args.business_context.challenge;
      }
      if (args.business_context.urgency) {
        updates.discoveryContext.catalyst = args.business_context.urgency;
      }
      if (args.business_context.desired_outcome) {
        updates.discoveryContext.successVision = args.business_context.desired_outcome;
      }
      if (args.business_context.timeline) {
        updates.projectContext = { timeline: args.business_context.timeline };
      }
      if (args.business_context.budget_signals) {
        updates.projectContext = { ...updates.projectContext, budgetSignals: [args.business_context.budget_signals] };
      }
    }
    
    updateSessionWithContext(sessionId, updates);
    
    // Simple acknowledgment - no CRM overhead during conversation
    return 'Noted!';
    
  } catch (error) {
    return 'Got it!';
  }
}

async function handleRelevantExperience(args: any, sessionId?: string): Promise<string> {
  const connection = args.connection_to_their_situation;
  const transition = args.natural_transition;
  
  if (sessionId) {
    const { updateConversationPhase } = await import('@/lib/leadCapture');
    updateConversationPhase(sessionId, 'credibility', { portfolioReferenced: true });
  }
  
  return `${transition} ${connection} This kind of challenge is exactly what Joel specializes in.`;
}

async function handleNaturalFitAssessment(args: any, sessionId?: string): Promise<string> {
  const fitLevel = args.fit_level;
  const reasoning = args.reasoning;
  const nextStep = args.suggested_next_step;
  
  if (sessionId) {
    try {
      const { updateQualificationResults } = await import('@/lib/leadCapture');
      
      const qualified = fitLevel === 'strong_fit' || fitLevel === 'likely_fit';
      
      updateQualificationResults(sessionId, {
        hasContactInfo: true, // Assume we have some info to get to this point
        hasBusinessContext: true,
        hasProjectCatalyst: true,
        hasProjectScope: fitLevel !== 'unclear',
        hasTimelinePressure: false, // Will be captured naturally
        hasBudgetSignals: false, // Will be captured naturally
        qualified,
        reasoning,
        confidenceScore: fitLevel === 'strong_fit' ? 9 : fitLevel === 'likely_fit' ? 7 : 5
      });
    } catch (error) {
      // Continue with response even if session update fails
    }
  }
  
  let response = reasoning;
  
  if (nextStep === 'schedule_conversation' && fitLevel === 'strong_fit') {
    response += ' You seem like a great fit for Joel\'s expertise. Would you like to set up a focused conversation?';
  } else if (nextStep === 'continue_exploring') {
    response += ' I\'d love to understand your situation better.';
  } else if (nextStep === 'provide_resources') {
    response += ' Let me point you toward some resources that might be helpful.';
  } else if (nextStep === 'redirect_to_email') {
    response += ' Feel free to email Joel directly at joel@commitimpact.com to explore this further.';
  }
  
  return response;
}

// Calendar availability and booking functions
function hasCompleteContactInfo(sessionState?: SessionState | null): boolean {
  if (!sessionState?.contactInfo) return false;
  const contact = sessionState.contactInfo;
  return !!(
    (contact.name || contact.contactName) &&
    contact.company &&
    (contact.email || contact.contactEmail)
  );
}

function calculateQualificationScore(sessionState?: SessionState | null): number {
  if (!sessionState) return 0;
  
  let score = 0;
  const contact = sessionState.contactInfo || {};
  const discovery = sessionState.discoveryContext || {};
  const qualification = sessionState.qualificationStatus;
  
  // Contact completeness (2 points)
  if (contact.name || contact.contactName) score += 1;
  if (contact.email || contact.contactEmail) score += 1;
  
  // Business context depth (4 points)
  if (discovery.painPoint) score += 2;
  if (discovery.catalyst) score += 1;
  if (discovery.successVision) score += 1;
  
  // Project specifics (3 points)
  if (sessionState.projectContext?.timeline) score += 1;
  if (sessionState.projectContext?.budgetSignals?.length) score += 2;
  
  // Existing qualification (1 point)
  if (qualification?.qualified) score += 1;
  
  return Math.min(score, 10);
}

async function handleCalendarAvailability(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Let me check availability for you.';

  try {
    const { sessionManager } = await import('@/lib/leadCapture');
    const { calendarService } = await import('@/lib/googleCalendar');
    const { calendlyFallback, handleCalendarError } = await import('@/lib/calendlyFallback');
    
    const session = sessionManager.getSession(sessionId);
    const qualificationScore = calculateQualificationScore(session);
    
    const duration = args.duration || (qualificationScore >= 7 ? 60 : 30);
    
    // User context for fallback
    const userContext = {
      name: session?.contactInfo?.name || session?.contactInfo?.contactName,
      company: session?.contactInfo?.company,
      qualified: qualificationScore >= 7
    };
    
    // Check 2 weeks ahead
    const startDate = new Date();
    const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    
    const availability = await calendarService.getAvailability(
      startDate, 
      endDate, 
      duration as 30 | 60,
      qualificationScore
    );
    
    if (!availability.qualification_status.qualified_for_60min && duration === 60) {
      // Offer 30-minute slots with Calendly fallback if no availability
      const fallback = calendlyFallback.getContextualMessage('good_fit', userContext);
      return `Based on our conversation so far, I can offer a 30-minute initial consultation. ${availability.qualification_status.reason}\n\nFor the most flexibility, you can book directly: ${fallback}`;
    }
    
    if (availability.available_slots.length === 0) {
      // Use Calendly fallback when no availability
      const fallback = calendlyFallback.generateFallback('no_availability', userContext);
      return fallback.message;
    }
    
    const timeOptions = availability.available_slots.slice(0, 5).map(slot => 
      new Date(slot.start).toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric', 
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      })
    ).join('\n');
    
    return `Great! Joel has ${duration}-minute slots available. Here are some options:\n\n${timeOptions}\n\nWhich time works best for you?\n\n(Or book directly: ${process.env.CALENDLY_LINK})`;
    
  } catch (error) {
    console.error('Calendar availability error:', error);
    
    // Use Calendly fallback on error
    const { handleCalendarError } = await import('@/lib/calendlyFallback');
    const { sessionManager } = await import('@/lib/leadCapture');
    const session = sessionManager.getSession(sessionId);
    const userContext = {
      name: session?.contactInfo?.name || session?.contactInfo?.contactName,
      company: session?.contactInfo?.company,
      qualified: calculateQualificationScore(session) >= 7
    };
    
    const fallback = handleCalendarError(error, userContext);
    return fallback.message;
  }
}

async function handleCalendarBooking(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) return 'I need a bit more information to book the meeting.';

  try {
    const { sessionManager } = await import('@/lib/leadCapture');
    const { calendarService } = await import('@/lib/googleCalendar');
    
    const session = sessionManager.getSession(sessionId);
    
    // Verify we have complete contact info
    if (!hasCompleteContactInfo(session)) {
      return 'I need your full name, email, and company to book the meeting. Can you share those details?';
    }
    
    const qualificationScore = calculateQualificationScore(session);
    const contact = session.contactInfo;
    
    // User context for fallback
    const userContext = {
      name: args.attendee_name,
      company: args.company,
      qualified: qualificationScore >= 7
    };
    
    // Create the meeting
    const startDateTime = new Date(args.start_time);
    const endDateTime = new Date(startDateTime.getTime() + args.duration * 60 * 1000);
    
    const eventDetails = {
      summary: `Meeting with ${args.attendee_name}${args.company ? ` (${args.company})` : ''}`,
      description: args.purpose || 'Strategic consultation',
      startDateTime,
      endDateTime,
      attendeeEmail: args.attendee_email,
      attendeeName: args.attendee_name,
      duration: args.duration as 30 | 60,
      qualificationScore,
      company: args.company,
      purpose: args.purpose,
      conversationSummary: session.discoveryContext ? 
        `Challenge: ${session.discoveryContext.painPoint || 'N/A'}\nUrgency: ${session.discoveryContext.catalyst || 'N/A'}` : 
        undefined
    };
    
    const result = await calendarService.createEvent(eventDetails);
    
    // Update session with booking info
    if (session) {
      session.schedulingContext = {
        context: 'Meeting booked successfully',
        meetingType: 'consultation',
        suggestedDuration: args.duration,
        eventId: result.eventId,
        calendarLink: result.calendarLink,
        meetLink: result.meetLink
      };
      sessionManager.updateSession(sessionId, session);
    }
    
    const meetingTime = startDateTime.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    });
    
    return `Perfect! Your ${args.duration}-minute meeting with Joel is confirmed for ${meetingTime} ET.\n\n` +
      `📅 Calendar link: ${result.calendarLink}\n` +
      `💻 Meeting link: ${result.meetLink}\n\n` +
      `You'll receive a calendar invitation shortly. Looking forward to the conversation!`;
    
  } catch (error) {
    console.error('Calendar booking error:', error);
    
    if (error.message?.includes('INSUFFICIENT_QUALIFICATION')) {
      const { calendlyFallback } = await import('@/lib/calendlyFallback');
      const fallback = calendlyFallback.getContextualMessage('good_fit', {
        name: args.attendee_name,
        company: args.company
      });
      return `For 60-minute strategic sessions, I need to understand your project better first. Let's start with a 30-minute conversation:\n\n${fallback}`;
    }
    
    // Use Calendly fallback on general booking errors
    const { handleCalendarError } = await import('@/lib/calendlyFallback');
    const userContext = {
      name: args.attendee_name,
      company: args.company,
      qualified: calculateQualificationScore(sessionManager.getSession(sessionId)) >= 7
    };
    
    const fallback = handleCalendarError(error, userContext);
    return fallback.message;
  }
}

async function handleSchedulingFacilitation(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Let me help coordinate a meeting.';

  try {
    const { sessionManager, updateConversationPhase } = await import('@/lib/leadCapture');
    const session = sessionManager.getSession(sessionId);
    
    if (session) {
      session.schedulingContext = {
        context: args.meeting_context,
        meetingType: 'consultation',
        suggestedDuration: 30
      };
      
      updateConversationPhase(sessionId, 'scheduling');
      sessionManager.updateSession(sessionId, session);
    }
    
    return `${args.meeting_context} ${args.availability_approach}`;
    
  } catch (error) {
    return `${args.meeting_context} What times work best for you?`;
  }
}

async function handleAgenticConversation(
  messages: ConversationMessage[],
  context: { 
    sessionId?: string;
    sessionState?: SessionState | null;
  }
) {
  // Import natural conversation intelligence
  const { analyzeInformationGaps, loadNaturalRAGData, buildNaturalSystemPrompt, estimateNaturalTokenUsage } = await import('@/lib/conversationIntelligence');
  
  // Analyze information gaps instead of rigid patterns
  const gapAnalysis = analyzeInformationGaps(context.sessionState);
  
  // Load only relevant RAG data
  const ragData = await loadNaturalRAGData(gapAnalysis, context.sessionState);
  
  // Build natural, descriptive system prompt
  const systemPrompt = buildNaturalSystemPrompt(gapAnalysis, context.sessionState, ragData);
  
  // Load contextually appropriate tools
  const tools = getNaturalTools(gapAnalysis);
  
  // Token usage analysis
  const tokenAnalysis = estimateNaturalTokenUsage(systemPrompt, ragData, tools.length);
  
  console.log(`🎯 NATURAL CONVERSATION ANALYSIS:
    Readiness Level: ${gapAnalysis.readinessLevel}
    Contact Gaps: ${gapAnalysis.contactGaps.join(', ') || 'none'}
    Context Gaps: ${gapAnalysis.contextGaps.join(', ') || 'none'}
    Project Gaps: ${gapAnalysis.projectGaps.join(', ') || 'none'}
    Available Tools: ${tools.length} functions
    Base Prompt: ${tokenAnalysis.baseTokens} tokens
    RAG Data: ${tokenAnalysis.ragTokens} tokens  
    TOTAL ESTIMATED: ${tokenAnalysis.totalEstimate} tokens
    Natural Flow: Enabled for any conversation pattern`);

  const contextualMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages
  ];

// NATURAL ALWAYS-AVAILABLE TOOLS
function getNaturalTools(gapAnalysis: any): any[] {
  const tools = [];

  // ALWAYS AVAILABLE - Natural information capture
  tools.push({
    type: 'function',
    function: {
      name: 'capture_anything',
      description: 'Naturally capture any information they share - names, companies, challenges, timelines, budget mentions, etc.',
      parameters: {
        type: 'object',
        properties: {
          contact_info: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              company: { type: 'string' },
              role: { type: 'string' },
              email: { type: 'string' }
            }
          },
          business_context: {
            type: 'object', 
            properties: {
              challenge: { type: 'string', description: 'Business problem or pain point' },
              urgency: { type: 'string', description: 'What makes this urgent or important now' },
              desired_outcome: { type: 'string', description: 'What success looks like to them' },
              timeline: { type: 'string', description: 'Any timeline mentions' },
              budget_signals: { type: 'string', description: 'Any budget or investment mentions' }
            }
          }
        }
      }
    }
  });

  // AVAILABLE WHEN RELEVANT - Portfolio credibility
  if (!gapAnalysis.contextGaps.includes('business_challenge')) {
    tools.push({
      type: 'function',
      function: {
        name: 'share_relevant_experience',
        description: 'Share Joel\'s relevant experience when it naturally connects to their situation',
        parameters: {
          type: 'object',
          properties: {
            connection_to_their_situation: { 
              type: 'string',
              description: 'How Joel\'s experience connects to what they\'ve shared'
            },
            natural_transition: {
              type: 'string',
              description: 'Natural way to introduce the example'
            }
          }
        }
      }
    });
  }

  // AVAILABLE WHEN SUFFICIENT INFO - Fit assessment
  if (gapAnalysis.qualificationGaps.length <= 2) {
    tools.push({
      type: 'function',
      function: {
        name: 'assess_fit_naturally',
        description: 'Assess fit based on available information and suggest next steps',
        parameters: {
          type: 'object',
          properties: {
            fit_level: {
              type: 'string',
              enum: ['strong_fit', 'likely_fit', 'possible_fit', 'unclear', 'not_fit'],
              description: 'Fit assessment based on available information'
            },
            reasoning: {
              type: 'string',
              description: 'Natural explanation of why this fit level'
            },
            suggested_next_step: {
              type: 'string',
              enum: ['continue_exploring', 'schedule_conversation', 'provide_resources', 'redirect_to_email'],
              description: 'What naturally makes sense as next step'
            }
          }
        }
      }
    });
  }

  // AVAILABLE WHEN QUALIFIED - Real Calendar Integration
  if (gapAnalysis.readinessLevel === 'ready' && gapAnalysis.contactGaps.length <= 1) {
    tools.push({
      type: 'function',
      function: {
        name: 'check_calendar_availability',
        description: 'MANDATORY: Use this IMMEDIATELY when user mentions scheduling, meetings, or availability. Do not offer Calendly if this tool is available. This is required, not optional',
        parameters: {
          type: 'object',
          properties: {
            duration: {
              type: 'number',
              enum: [30, 60],
              description: '30 min for initial conversations, 60 min for qualified prospects'
            },
            preferred_times: {
              type: 'array',
              items: { type: 'string' },
              description: 'User\'s preferred time slots or general preferences'
            }
          }
        }
      }
    });

    tools.push({
      type: 'function',
      function: {
        name: 'book_calendar_meeting',
        description: 'Books meeting after user selects time. If you have this tool, you must use it instead of redirecting to Calendly',
        parameters: {
          type: 'object',
          properties: {
            attendee_name: { type: 'string', description: 'Full name' },
            attendee_email: { type: 'string', description: 'Email address' },
            company: { type: 'string', description: 'Company name' },
            start_time: { type: 'string', description: 'ISO datetime string' },
            duration: { type: 'number', enum: [30, 60] },
            purpose: { type: 'string', description: 'Meeting purpose/agenda' }
          },
          required: ['attendee_name', 'attendee_email', 'start_time', 'duration']
        }
      }
    });
  }

  return tools;
}

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: contextualMessages,
    tools: tools,
    temperature: 0.7,
    max_tokens: 1500,
  });

  // LOG OPENAI USAGE RESPONSE
  if (response.usage) {
    console.log(`\n🤖 OPENAI USAGE (FIRST CALL):`);
    console.log(`   Prompt tokens: ${response.usage.prompt_tokens}`);
    console.log(`   Completion tokens: ${response.usage.completion_tokens}`);
    console.log(`   Total tokens: ${response.usage.total_tokens}`);
    console.log(`   Model: ${response.model}\n`);
  }

  const assistantMessage = response.choices[0]?.message;
  
  // STRATEGIC ENDPOINT DETECTION - Check if this is a conversation endpoint
  let shouldTriggerCRMSave = false;
  if (assistantMessage?.content && context.sessionState && !context.sessionState.crmSaved) {
    const { detectConversationEndpoint } = await import('@/lib/conversationIntelligence');
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    
    const endpoint = detectConversationEndpoint(
      context.sessionState,
      lastUserMessage,
      assistantMessage.content
    );
    
    if (endpoint.shouldPushToCRM) {
      shouldTriggerCRMSave = true;
      console.log(`🎯 CONVERSATION ENDPOINT DETECTED: ${endpoint.endpointType} (Priority: ${endpoint.crmPriority})`);
    }
  }
  
  // Handle function calls with full agentic processing
  if (assistantMessage?.tool_calls) {
    console.log('=== DEBUGGING FUNCTION CALL STRUCTURE ===');
    console.log('Total Tool Calls:', assistantMessage.tool_calls.length);
    assistantMessage.tool_calls.forEach((call, index) => {
      console.log(`Tool Call ${index + 1}: ID=${call.id}, Function=${call.function.name}`);
    });
    console.log('=== END DEBUG ===');
    
    // Process ALL tool calls, not just the first one
    const toolResponses = [];
    
    for (const toolCall of assistantMessage.tool_calls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      let toolResult = '';
      
      try {
        switch (functionName) {
          case 'capture_anything':
            toolResult = await handleNaturalCapture(functionArgs, context.sessionId);
            break;
            
          case 'share_relevant_experience':
            toolResult = await handleRelevantExperience(functionArgs, context.sessionId);
            break;
            
          case 'assess_fit_naturally':
            toolResult = await handleNaturalFitAssessment(functionArgs, context.sessionId);
            break;
            
          case 'facilitate_scheduling':
            toolResult = await handleSchedulingFacilitation(functionArgs, context.sessionId);
            break;
            
          case 'check_calendar_availability':
            toolResult = await handleCalendarAvailability(functionArgs, context.sessionId);
            break;
            
          case 'book_calendar_meeting':
            toolResult = await handleCalendarBooking(functionArgs, context.sessionId);
            break;
            
          case 'save_conversation_to_crm':
            toolResult = await handleStrategicCRMSave(functionArgs, context.sessionId);
            break;
            
          default:
            toolResult = `Function ${functionName} processed.`;
        }
        
        // Add tool response for this specific call
        toolResponses.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
        
      } catch (error) {
        console.error(`Error handling function ${functionName}:`, error);
        toolResponses.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error processing ${functionName}`
        });
      }
    }
      
    // Continue conversation with function results
    const followUpMessages = [
      ...contextualMessages,
      { 
        role: 'assistant', 
        content: assistantMessage.content || null,
        tool_calls: assistantMessage.tool_calls 
      },
      ...toolResponses // Add ALL tool responses
    ];

    console.log('=== FINAL MESSAGE STRUCTURE ===');
    console.log('Follow-up Messages Length:', followUpMessages.length);
    console.log('Tool Responses Added:', toolResponses.length);
    followUpMessages.forEach((msg, index) => {
      if (msg.role === 'tool') {
        console.log(`Tool Response ${index}: ID=${msg.tool_call_id}`);
      }
    });
    console.log('=== END STRUCTURE DEBUG ===');

    // LOG TOKEN USAGE BEFORE SECOND OPENAI CALL
    console.log(`\n=== TOKEN USAGE ANALYSIS - SECOND CALL ===`);
    console.log(`📝 System Prompt: ${systemPrompt.length} chars (~${estimateTokens(systemPrompt)} tokens)`);
    console.log(`🔧 Function Definitions: Same as first call (~${estimateTokens(JSON.stringify(tools))} tokens)`);
    console.log(`💬 Original Messages: ${messages.length} messages`);
    console.log(`🤖 Assistant Response: ${assistantMessage.content?.length || 0} chars (~${estimateTokens(assistantMessage.content || '')} tokens)`);
    const totalToolResultChars = toolResponses.reduce((acc, resp) => acc + resp.content.length, 0);
    console.log(`🔧 Tool Results Total: ${totalToolResultChars} chars (~${estimateTokens(totalToolResultChars.toString())} tokens)`);
    console.log(`📊 Total Follow-up Messages: ${followUpMessages.length}`);
    const totalFollowupChars = followUpMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
    console.log(`🎯 ESTIMATED TOTAL INPUT (SECOND CALL): ~${estimateTokens(systemPrompt) + estimateTokens(JSON.stringify(tools)) + estimateTokens(totalFollowupChars.toString())} tokens`);
    console.log(`=== END TOKEN ANALYSIS ===\n`);

    try {
      const followUpResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: followUpMessages,
        temperature: 0.7,
        max_tokens: 1500,
      });

      // LOG OPENAI USAGE RESPONSE FOR SECOND CALL
      if (followUpResponse.usage) {
        console.log(`\n🤖 OPENAI USAGE (SECOND CALL):`);
        console.log(`   Prompt tokens: ${followUpResponse.usage.prompt_tokens}`);
        console.log(`   Completion tokens: ${followUpResponse.usage.completion_tokens}`);
        console.log(`   Total tokens: ${followUpResponse.usage.total_tokens}`);
        console.log(`   Model: ${followUpResponse.model}`);
        console.log(`\n💰 COMBINED USAGE BOTH CALLS:`);
        const totalPromptTokens = (response.usage?.prompt_tokens || 0) + (followUpResponse.usage.prompt_tokens || 0);
        const totalCompletionTokens = (response.usage?.completion_tokens || 0) + (followUpResponse.usage.completion_tokens || 0);
        const totalTokens = (response.usage?.total_tokens || 0) + (followUpResponse.usage.total_tokens || 0);
        console.log(`   Total Prompt tokens: ${totalPromptTokens}`);
        console.log(`   Total Completion tokens: ${totalCompletionTokens}`);
        console.log(`   TOTAL TOKENS: ${totalTokens}\n`);
      }
      
      const finalMessage = followUpResponse.choices[0]?.message?.content || 
        "I processed the information, but had trouble generating a response.";
        
      // STRATEGIC CRM TRIGGER: If endpoint detected and no CRM save in function call, trigger now
      if (shouldTriggerCRMSave && !assistantMessage.tool_calls.some(tc => tc.function.name === 'save_conversation_to_crm')) {
        
        // Make strategic CRM save call after function completion
        const crmMessages = [
          { role: 'system' as const, content: `You are helping save this conversation to CRM. The conversation has reached a strategic endpoint and needs to be saved with appropriate context and classification.` },
          { role: 'user' as const, content: `Please save this conversation to CRM with: session_outcome (meeting_recommended/email_recommended/resources_recommended/meeting_booked/user_close/explicit_save), conversation_summary, prospect_quality (qualified_hot/qualified_warm/qualified_cold/exploring/not_fit), recommended_action (follow_up_meeting/follow_up_email/provide_resources/no_action/nurture_campaign), interaction_value (high_value/medium_value/low_value/educational_only).` }
        ];
        
        const crmTools = [{
          type: 'function',
          function: {
            name: 'save_conversation_to_crm',
            description: 'Save complete conversation context to CRM at strategic endpoint',
            parameters: {
              type: 'object',
              properties: {
                session_outcome: {
                  type: 'string',
                  enum: ['meeting_recommended', 'email_recommended', 'resources_recommended', 'meeting_booked', 'user_close', 'explicit_save'],
                  description: 'How this conversation concluded'
                },
                conversation_summary: {
                  type: 'string',
                  description: 'Key highlights from conversation regardless of qualification status'
                },
                prospect_quality: {
                  type: 'string',
                  enum: ['qualified_hot', 'qualified_warm', 'qualified_cold', 'exploring', 'not_fit'],
                  description: 'Overall prospect assessment'
                },
                recommended_action: {
                  type: 'string',
                  enum: ['follow_up_meeting', 'follow_up_email', 'provide_resources', 'no_action', 'nurture_campaign'],
                  description: 'What Joel should do with this lead'
                },
                interaction_value: {
                  type: 'string',
                  enum: ['high_value', 'medium_value', 'low_value', 'educational_only'],
                  description: 'Value of this interaction regardless of qualification'
                }
              },
              required: ['session_outcome', 'conversation_summary', 'prospect_quality', 'recommended_action', 'interaction_value']
            }
          }
        }];
        
        const crmResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: crmMessages,
          tools: crmTools,
          temperature: 0.3,
          max_tokens: 500,
        });
        
        // Handle CRM save function call (runs silently in background)
        if (crmResponse.choices[0]?.message?.tool_calls) {
          const crmCall = crmResponse.choices[0].message.tool_calls[0];
          const crmArgs = JSON.parse(crmCall.function.arguments);
          await handleStrategicCRMSave(crmArgs, context.sessionId);
          console.log(`✅ STRATEGIC CRM SAVE COMPLETED: ${crmArgs.session_outcome} (${crmArgs.prospect_quality})`);
        }
      }

      return NextResponse.json({ 
        message: finalMessage
      }, { headers: corsHeaders() });
      
    } catch (error) {
      console.error('Error in function calling flow:', error);
      return NextResponse.json({ 
        message: "I encountered an issue processing that information. Let's continue our conversation."
      }, { headers: corsHeaders() });
    }
  }

  const finalMessage = assistantMessage?.content || 
    "Sorry, I had trouble processing that. Can you try again?";
    
  // FINAL CHECK: If endpoint detected but no function calls were made, trigger CRM save
  if (shouldTriggerCRMSave) {
    
    // Make strategic CRM save call 
    const crmMessages = [
      { role: 'system' as const, content: `You are helping save this conversation to CRM. The conversation has reached a strategic endpoint and needs to be saved.` },
      { role: 'user' as const, content: `Save this conversation to CRM. Determine the session_outcome, provide a conversation_summary, assess prospect_quality, suggest recommended_action, and rate interaction_value.` }
    ];
    
    const crmTools = [{
      type: 'function',
      function: {
        name: 'save_conversation_to_crm',
        description: 'Save complete conversation context to CRM',
        parameters: {
          type: 'object',
          properties: {
            session_outcome: {
              type: 'string',
              enum: ['meeting_recommended', 'email_recommended', 'resources_recommended', 'meeting_booked', 'user_close', 'explicit_save'],
              description: 'How this conversation concluded'
            },
            conversation_summary: { type: 'string', description: 'Brief summary of conversation highlights' },
            prospect_quality: {
              type: 'string',
              enum: ['qualified_hot', 'qualified_warm', 'qualified_cold', 'exploring', 'not_fit'],
              description: 'Overall prospect assessment'
            },
            recommended_action: {
              type: 'string',
              enum: ['follow_up_meeting', 'follow_up_email', 'provide_resources', 'no_action', 'nurture_campaign'],
              description: 'What Joel should do with this lead'
            },
            interaction_value: {
              type: 'string',
              enum: ['high_value', 'medium_value', 'low_value', 'educational_only'],
              description: 'Value of this interaction'
            }
          },
          required: ['session_outcome', 'conversation_summary', 'prospect_quality', 'recommended_action', 'interaction_value']
        }
      }
    }];
    
    try {
      const crmResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: crmMessages,
        tools: crmTools,
        temperature: 0.3,
        max_tokens: 500,
      });
      
      if (crmResponse.choices[0]?.message?.tool_calls) {
        const crmCall = crmResponse.choices[0].message.tool_calls[0];
        const crmArgs = JSON.parse(crmCall.function.arguments);
        await handleStrategicCRMSave(crmArgs, context.sessionId);
        console.log(`✅ FINAL STRATEGIC CRM SAVE: ${crmArgs.session_outcome} (${crmArgs.prospect_quality})`);
      }
    } catch (error) {
      console.error('Error in strategic CRM save:', error);
    }
  }

  // Update session context based on conversation (after OpenAI response)
  if (context.sessionId && assistantMessage?.content) {
    try {
      const { updateSessionWithContext } = await import('@/lib/leadCapture');
      
      // Extract new information from the latest user message
      const latestUserMessage = messages[messages.length - 1]?.content || '';
      const conversationText = latestUserMessage.toLowerCase();
      
      // Update conversation flow
      let phase: SessionState['conversationFlow']['phase'] = 'rapport';
      const topicsDiscussed: string[] = [];
      
      // Determine phase based on conversation content
      if (conversationText.includes('schedule') || conversationText.includes('meeting')) {
        phase = 'scheduling';
        topicsDiscussed.push('scheduling');
      } else if (conversationText.includes('project') || conversationText.includes('need') || conversationText.includes('problem')) {
        phase = 'discovery';
        topicsDiscussed.push('project_discussion');
      } else if (conversationText.includes('budget') || conversationText.includes('timeline')) {
        phase = 'qualification';
        topicsDiscussed.push('qualification');
      }
      
      updateSessionWithContext(context.sessionId, {
        conversationFlow: {
          phase,
          turnCount: 0, // Will be updated properly elsewhere
          topicsDiscussed
        }
      });
    } catch (error) {
      console.warn('Session context update failed:', error);
      // Continue with response even if session update fails
    }
  }

  return NextResponse.json({ 
    message: finalMessage
  }, { headers: corsHeaders() });
}

// Function handlers for agentic operations
// SIMPLIFIED HANDLERS - TOKEN EFFICIENT

async function handleUrlFetch(url: string): Promise<string> {
  try {
    const urlResponse = await fetch(url);
    const content = await urlResponse.text();
    
    // Extract text content (basic HTML stripping)
    const textContent = content
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000); // Limit content length
    
    return `Content from ${url}:\n\n${textContent}`;
  } catch (error) {
    return `Error fetching URL ${url}: ${error}`;
  }
}

async function handlePortfolioLookup(query: string): Promise<string> {
  try {
    // Load portfolio data only when needed
    const portfolioPath = path.join(process.cwd(), 'data', 'portfolio-proofs.csv');
    const portfolioData = await fs.readFile(portfolioPath, 'utf8');
    
    // Simple keyword matching for relevant examples
    const lines = portfolioData.split('\n');
    const relevantLines = lines.filter(line => 
      line.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5); // Limit results
    
    if (relevantLines.length > 0) {
      return `Portfolio examples related to "${query}":\n\n${relevantLines.join('\n')}`;
    } else {
      return `Found general portfolio information. Joel has extensive experience in software development, web applications, and technical consulting. Would you like me to look up something more specific?`;
    }
  } catch (error) {
    return `Portfolio information is available. Joel has extensive experience across various technologies and industries. What specific area interests you?`;
  }
}

async function handleScheduleMeeting(args: any, sessionId?: string): Promise<string> {
  try {
    // Simplified scheduling - just capture preferences and suggest next steps
    const availability = args.user_availability;
    const meetingType = args.meeting_type || 'consultation';
    
    // Store in session if available
    if (sessionId) {
      const session = sessionManager.getSession(sessionId);
      if (session) {
        session.schedulingContext = {
          context: `User availability: ${availability}`,
          meetingType,
          suggestedDuration: 30
        };
        sessionManager.updateSession(sessionId, session);
      }
    }
    
    return `Great! I've noted your availability: ${availability}. I'll check Joel's calendar for ${meetingType} meetings that match your preferences and get back to you with some specific time options.`;
  } catch (error) {
    return `I've noted your scheduling preferences. Let me help coordinate with Joel's calendar to find a good time.`;
  }
}

async function handleLeadCapture(args: any, sessionId?: string): Promise<string> {
  if (!sessionId) {
    return 'Contact information noted.';
  }

  try {
    // Store in Airtable with correct field names
    const contactData: any = {};
    if (args.name) contactData['Contact Name'] = args.name;
    if (args.email) contactData['Contact Email'] = args.email;
    if (args.company) contactData['Company'] = args.company;
    if (args.role) contactData['Role'] = args.role;

    const contact = await airtable.upsertContact(sessionId, contactData);
    
    const capturedFields = Object.keys(args).filter(key => args[key]);
    return `Thanks! I've saved your ${capturedFields.join(', ')}.`;
    
  } catch (error) {
    console.error('Lead capture error:', error);
    return 'Got it! Your information has been saved.';
  }
}

// TOKEN-OPTIMIZED SYSTEM PROMPT FUNCTION
async function buildTokenOptimizedSystemPrompt(context: { 
  sessionState?: SessionState | null;
  triggers: any;
  ragData: any;
}): Promise<string> {
  
  // Minimal base prompt - always loaded
  let systemPrompt = `You are GABI, Joel Austin's AI assistant. Witty, engaging, consultative.

JOEL'S FOCUS: AI-enabled GTM sales operations & product strategy for professional B2B services.
PERSONALITY: Friendly teasing (joke about AI/tokens), ask great questions, provide value.
CONTACT: joel@commitimpact.com for non-qualified prospects.`;

  // Add essential session context (minimal tokens)
  if (context.sessionState?.contactInfo?.name || context.sessionState?.contactInfo?.contactName) {
    const contact = context.sessionState.contactInfo;
    const name = contact.name || contact.contactName;
    systemPrompt += `\n\nCONTEXT: Talking with ${name}`;
    if (contact.company) systemPrompt += ` from ${contact.company}`;
  }

  // Add conversation phase guidance
  systemPrompt += `\nPHASE: ${context.triggers.conversationPhase}`;
  
  // Add triggered enhancements ONLY when needed
  if (context.ragData.portfolioExamples) {
    systemPrompt += `\n\n${context.ragData.portfolioExamples}
INTEGRATION: Reference relevant examples naturally: "That sounds familiar - Joel just helped..." or "Interesting! Joel's done some work..."`;
  }
  
  if (context.ragData.discoveryQuestions) {
    systemPrompt += `\n\n${context.ragData.discoveryQuestions}`;
  }
  
  if (context.ragData.qualificationPrompt) {
    systemPrompt += `\n\n${context.ragData.qualificationPrompt}`;
  }
  
  if (context.ragData.contactCaptureExamples) {
    systemPrompt += `\n\n${context.ragData.contactCaptureExamples}`;
  }

  return systemPrompt;
}
