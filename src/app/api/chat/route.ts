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
      
      // Business Context (map to available Airtable fields)
      'Pain Point': session.discoveryContext?.painPoint || 'Not specified',
      'Project Context': `${session.discoveryContext?.catalyst ? 'Urgency: ' + session.discoveryContext.catalyst + '. ' : ''}${session.discoveryContext?.successVision ? 'Vision: ' + session.discoveryContext.successVision + '. ' : ''}${session.discoveryContext?.projectScope ? 'Scope: ' + session.discoveryContext.projectScope : ''}`.trim() || '',
      
      // Qualification Results (map to available fields)
      'Qualified': session.qualificationStatus?.qualified === true ? 'Yes' : 
                  session.qualificationStatus?.qualified === false ? 'No' : 'Pending',
      'Lead Score': String(session.qualificationStatus?.confidenceScore || 0),
      
      // Meeting Information (if applicable)
      'Meeting Scheduled': session.schedulingContext?.eventId ? 'Yes' : 'No',
      'Meeting Date': session.schedulingContext?.eventId ? 
        new Date().toISOString() : '', // Would need actual meeting date from calendar
      
      // Analytics Data (using available fields)
      'First Contact': (session.createdAt || new Date()).toISOString(),
      'Last Updated': new Date().toISOString(),
      
      // Lead Scoring (using available fields)
      'Lead Source': 'GABI Chat Widget'
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

// Helper to check if available slots match user preferences
function checkPreferenceMatch(availableSlots: any[], preferredTimes: string[]): boolean {
  if (!preferredTimes || preferredTimes.length === 0) return true;
  
  const preferences = preferredTimes.join(' ').toLowerCase();
  
  for (const slot of availableSlots) {
    const slotDate = new Date(slot.start);
    const dayName = slotDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hour = slotDate.getHours();
    
    // Check day matches
    if (preferences.includes(dayName)) {
      // Check time of day matches
      if (preferences.includes('morning') && hour >= 9 && hour < 12) return true;
      if (preferences.includes('afternoon') && hour >= 12 && hour < 17) return true;
      if (preferences.includes('lunch') && hour >= 11 && hour < 14) return true;
      if (!preferences.includes('morning') && !preferences.includes('afternoon') && !preferences.includes('lunch')) {
        // Day match without specific time = match
        return true;
      }
    }
  }
  
  return false;
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
  console.log('🗓️ CALENDAR AVAILABILITY DEBUG:', {
    args,
    sessionId,
    hasGoogleRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID
  });
  
  if (!sessionId) return 'Let me check availability for you.';

  try {
    const { sessionManager } = await import('@/lib/leadCapture');
    const { calendarService } = await import('@/lib/googleCalendar');
    const { calendlyFallback, handleCalendarError } = await import('@/lib/calendlyFallback');
    
    const session = sessionManager.getSession(sessionId);
    const qualificationScore = calculateQualificationScore(session);
    
    // Check for existing relationship indicators
    const messageText = JSON.stringify(args).toLowerCase();
    const isExistingRelationship = messageText.includes('lunch') || 
                                   messageText.includes('met with') || 
                                   messageText.includes('had meeting') ||
                                   messageText.includes('follow up');
    
    // Allow 60 min for existing relationships or high qualification scores
    const duration = args.duration || ((qualificationScore >= 7 || isExistingRelationship) ? 60 : 30);
    
    // User context for fallback
    const userContext = {
      name: session?.contactInfo?.name || session?.contactInfo?.contactName,
      company: session?.contactInfo?.company,
      qualified: qualificationScore >= 7
    };
    
    // Check 2 weeks ahead (calendar will return all available slots)
    const startDate = new Date();
    const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    
    const availability = await calendarService.getAvailability(
      startDate, 
      endDate, 
      duration as 30 | 60,
      qualificationScore
    );
    
    // Note user's preferences for the response
    const userPreferences = args.preferred_times ? `User requested: ${args.preferred_times.join(', ')}. ` : '';
    
    if (!availability.qualification_status.qualified_for_60min && duration === 60 && !isExistingRelationship) {
      // Offer 30-minute slots with Calendly fallback if no availability (unless existing relationship)
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
    
    console.log(`📅 Calendar slots found: ${availability.available_slots.length} total, returning first 5`);
    console.log(`📅 Time options being returned:\n${timeOptions}`);
    
    // Build response with user preference acknowledgment
    let response = `Joel has these ${duration}-minute slots available:\n\n${timeOptions}\n\n`;
    
    // Add preference acknowledgment if user specified preferences
    if (args.preferred_times && args.preferred_times.length > 0) {
      const preferenceText = args.preferred_times.join(', ');
      response = `You mentioned ${preferenceText}. Here's what Joel has available:\n\n${timeOptions}\n\n`;
      
      // Check if any slots match common preference patterns
      const hasMatchingSlots = checkPreferenceMatch(availability.available_slots, args.preferred_times);
      if (!hasMatchingSlots) {
        response += "I don't see exact matches for your preferred times, but these are the available options. ";
      }
    }
    
    response += "Which of these times works best for you?";
    
    console.log(`📅 FUNCTION RETURNING: ${response}`);
    return response;
    
  } catch (error) {
    console.error('🚨 CALENDAR AVAILABILITY ERROR - FULL DETAILS:', {
      errorMessage: error.message,
      errorStack: error.stack,
      errorObject: error,
      hasGoogleRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
      args,
      sessionId
    });
    
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
  console.log('🎯 CALENDAR BOOKING STARTED:', args);
  
  // Extract everything from args (OpenAI already validated these)
  const { 
    attendee_name = 'Guest', // Default if somehow missing
    attendee_email,
    company,
    start_time,
    duration = 30,
    role,
    team_size,
    pain_points = [],
    current_tools = [],
    timeline,
    budget_range,
    project_context = 'Meeting scheduled via GABI'
  } = args;

  // Only check for absolute minimum
  if (!attendee_email || !start_time) {
    console.error('❌ Missing critical booking data:', { attendee_email, start_time });
    return JSON.stringify({
      success: false,
      message: "I need your email and the meeting time. What's your email?"
    });
  }

  console.log('✅ Booking meeting with email:', attendee_email);

  try {
    // Initialize calendar service
    const { calendarService } = await import('@/lib/googleCalendar');
    
    // Parse dates
    const startDate = new Date(start_time);
    const endDate = new Date(startDate.getTime() + (duration * 60000));
    
    // Build rich description from whatever context we have
    const eventDescription = `
Meeting with ${attendee_name}${company ? ` from ${company}` : ''}
${role ? `Role: ${role}` : ''}
${team_size ? `Team Size: ${team_size}` : ''}

${pain_points.length > 0 ? `Pain Points:\n${pain_points.map(p => `- ${p}`).join('\n')}` : ''}

${project_context ? `Context:\n${project_context}` : ''}

${timeline ? `Timeline: ${timeline}` : ''}
${budget_range ? `Budget: ${budget_range}` : ''}

Contact: ${attendee_email}
Booked via: GABI Intelligent Qualification
`.trim();

    // Create the actual calendar event
    const event = {
      summary: `${attendee_name}${company ? ` - ${company}` : ''} (GABI Lead)`,
      description: eventDescription,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'America/New_York',
      },
      attendees: [
        { email: attendee_email },
        { email: 'joel@commitimpact.com' }
      ],
      conferenceData: {
        createRequest: {
          requestId: `gabi-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    console.log('📅 Creating calendar event:', {
      title: event.summary,
      start: startDate.toLocaleString(),
      attendees: event.attendees.map(a => a.email)
    });

    const createdEvent = await calendarService.calendarAPI.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'joel@commitimpact.com',
      resource: event,
      conferenceDataVersion: 1,
      sendNotifications: true  // Sends invites to attendees
    });

    // Update Airtable asynchronously (don't block the booking)
    const leadData = {
      email: attendee_email,
      name: attendee_name || 'Not provided',
      company: company || 'TBD',
      role: role || null,
      team_size: team_size || null,
      pain_points: Array.isArray(pain_points) ? pain_points.join(', ') : pain_points || null,
      current_tools: Array.isArray(current_tools) ? current_tools.join(', ') : current_tools || null,
      timeline: timeline || null,
      budget_range: budget_range || null,
      interest_level: 'hot', // They booked = hot
      assessment_status: 'qualified',
      meeting_scheduled: true,
      meeting_date: start_time,
      conversation_summary: project_context,
      next_steps: 'Meeting scheduled',
      last_interaction: new Date().toISOString()
    };

    // Save to Airtable async
    try {
      const airtable = new (await import('@/lib/airtableClient')).AirtableClient();
      airtable.saveLead(leadData).catch(error => {
        console.error('Airtable update failed (non-blocking):', error);
      });
    } catch (airtableError) {
      console.error('Airtable initialization failed (non-blocking):', airtableError);
    }

    return JSON.stringify({
      success: true,
      eventId: createdEvent.data.id,
      eventLink: createdEvent.data.htmlLink,
      meetLink: createdEvent.data.conferenceData?.entryPoints?.[0]?.uri || 'Will be in calendar invite',
      message: `Perfect! I've booked your meeting with Joel for ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}. You'll receive a calendar invite at ${attendee_email} shortly.`
    });

  } catch (error) {
    console.error('❌ Calendar booking failed:', error);
    return JSON.stringify({
      success: false,
      message: "I encountered an issue with the calendar system. Could you email Joel directly at joel@commitimpact.com? I'll make sure he knows you tried to book."
    });
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
  
  // Analyze information gaps instead of rigid patterns (include current conversation)
  const gapAnalysis = analyzeInformationGaps(context.sessionState, messages);
  
  // Load only relevant RAG data
  const ragData = await loadNaturalRAGData(gapAnalysis, context.sessionState);
  
  // Build natural, descriptive system prompt
  const todaysDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const systemPrompt = buildNaturalSystemPrompt(gapAnalysis, context.sessionState, ragData, scoringCriteria) + 
    `\n\nIMPORTANT: Today is ${todaysDate}. When generating dates:\n` +
    `- Use correct year (2025, not 2023 or 2024)\n` +
    `- Convert times like "Monday at 9:30am" to "2025-MM-DDTHH:mm:00" format\n` +
    `- Use 24-hour format for times (9:30am = 09:30)\n`;
  
  // Load contextually appropriate tools
  const tools = getNaturalTools(gapAnalysis, context);
  
  // Token usage analysis
  const tokenAnalysis = estimateNaturalTokenUsage(systemPrompt, ragData, tools.length);
  
  console.log(`🤖 OpenAI Call: ${tools.length} tools, ~${tokenAnalysis.totalEstimate} tokens`);

  const contextualMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages
  ];

// NATURAL ALWAYS-AVAILABLE TOOLS
function getNaturalTools(gapAnalysis: any, context?: any): any[] {
  // Load calendar tools if:
  // 1. User explicitly wants to schedule OR
  // 2. We have their email (from upfront collection) and they seem interested
  const normalizedMessage = context?.messages?.[context.messages.length - 1]?.content?.toLowerCase() || '';
  const hasSchedulingIntent = 
    normalizedMessage.includes('schedule') || 
    normalizedMessage.includes('book') ||
    normalizedMessage.includes('calendar') ||
    normalizedMessage.includes('meeting') ||
    normalizedMessage.includes('available') ||
    normalizedMessage.includes('meet with');

  const hasEmail = context?.sessionState?.contactInfo?.email || 
                   context?.sessionState?.contactInfo?.contactEmail ||
                   context?.messages?.some(m => m.content?.includes('@'));

  const shouldLoadCalendarTools = hasSchedulingIntent || hasEmail;

  console.log('📅 Calendar tools check:', { 
    hasSchedulingIntent, 
    hasEmail, 
    loading: shouldLoadCalendarTools 
  });

  console.log(`📊 Gap Analysis: ${gapAnalysis.readinessLevel} | Contact gaps: ${gapAnalysis.contactGaps.length} | Calendar tools: ${shouldLoadCalendarTools ? '✅' : '❌'}`);
  
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
  if (shouldLoadCalendarTools) {
    tools.push({
      type: 'function',
      function: {
        name: 'check_calendar_availability',
        description: 'Check Joel\'s actual calendar availability ONLY AFTER you have their email and availability preferences. Always ask "What times work best for you?" before calling this.',
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
        description: 'Book a meeting. Since we always collect email upfront, this should always work.',
        parameters: {
          type: 'object',
          required: ['attendee_email', 'start_time'],  // Email is all we really need
          properties: {
            // CORE REQUIREMENTS (we always have email from upfront collection)
            attendee_email: { 
              type: 'string',
              description: 'Email address (already collected via safety question)'
            },
            start_time: { 
              type: 'string',
              description: 'ISO datetime for meeting start'
            },
            duration: { 
              type: 'integer',
              enum: [30, 60],
              default: 30
            },
            
            // EXTRACT FROM CONVERSATION (don't ask for these)
            attendee_name: { 
              type: 'string',
              description: 'Their name if mentioned'
            },
            company: { 
              type: 'string',
              description: 'Company if mentioned'
            },
            role: { 
              type: 'string',
              description: 'Title/role if mentioned'
            },
            pain_points: {
              type: 'array',
              items: { type: 'string' },
              description: 'Problems like "long sales cycles", "no sales team"'
            },
            current_tools: {
              type: 'array',
              items: { type: 'string' }
            },
            timeline: {
              type: 'string'
            },
            budget_range: {
              type: 'string'
            },
            team_size: {
              type: 'integer'
            },
            project_context: {
              type: 'string',
              description: 'Summary of their needs'
            }
          }
        }
      }
    });
  } else {
    console.log('❌ CALENDAR TOOLS NOT LOADED - Conditions not met');
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
    console.log(`💰 Usage: ${response.usage.total_tokens} tokens`);
  }

  const assistantMessage = response.choices[0]?.message;
  
  // FUNCTION CALL DETECTION LOGGING
  if (assistantMessage?.tool_calls) {
    console.log(`🔧 Function calls: ${assistantMessage.tool_calls.map(call => call.function.name).join(', ')}`);
  } else {
    console.log(`🔧 No function calls`);
    
    // Check if calendar-related keywords in response suggest missing function call
    const responseText = assistantMessage?.content?.toLowerCase() || '';
    const calendarKeywords = ['check availability', 'schedule', 'calendar', 'meeting', 'book', 'appointment'];
    const hasCalendarKeywords = calendarKeywords.some(keyword => responseText.includes(keyword));
    
    if (hasCalendarKeywords) {
      console.log(`⚠️  POSSIBLE MISSING FUNCTION CALL - Response contains calendar keywords but no function calls:`);
      console.log(`   Calendar Keywords Found: ${calendarKeywords.filter(k => responseText.includes(k)).join(', ')}`);
      console.log(`   Response Preview: "${responseText.substring(0, 150)}..."`);
    }
  }
  
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
        
        // Log the raw function result
        console.log(`🔧 Function ${functionName} result:`, toolResult);
        
        // Parse JSON results if applicable
        let parsedResult = null;
        try {
          if (typeof toolResult === 'string' && toolResult.startsWith('{')) {
            parsedResult = JSON.parse(toolResult);
            console.log(`📊 Parsed result:`, parsedResult);
            
            // Check for failures and log them prominently
            if (parsedResult.success === false) {
              console.error(`❌ FUNCTION FAILED: ${functionName}`, {
                error: parsedResult.error,
                fallback: parsedResult.fallback
              });
              
              // Return honest error message to user
              toolResult = parsedResult.fallback || `I encountered an issue: ${parsedResult.error}. Please email Joel at joel@commitimpact.com`;
            } else if (parsedResult.success === true && parsedResult.message) {
              // Use the success message
              toolResult = parsedResult.message;
            }
          }
        } catch (parseError) {
          console.log('Result is not JSON, using as-is');
        }
        
        // Add tool response for this specific call
        toolResponses.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
        
      } catch (error) {
        console.error(`❌ Error handling function ${functionName}:`, error);
        toolResponses.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `I encountered a technical issue. Please email Joel directly at joel@commitimpact.com or use https://calendly.com/joelaustin/30min`
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


    // LOG TOKEN USAGE BEFORE SECOND OPENAI CALL

    try {
      const followUpResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: followUpMessages,
        temperature: 0.7,
        max_tokens: 1500,
      });

      if (followUpResponse.usage && response.usage) {
        const totalTokens = response.usage.total_tokens + followUpResponse.usage.total_tokens;
        console.log(`💰 Combined Usage: ${totalTokens} tokens`);
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
