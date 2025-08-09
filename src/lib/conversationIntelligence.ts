import fs from 'fs/promises';
import path from 'path';
import { SessionState } from './airtableClient';

export interface InformationGaps {
  contactGaps: string[];
  contextGaps: string[];  
  projectGaps: string[];
  qualificationGaps: string[];
  readinessLevel: 'exploring' | 'interested' | 'ready' | 'committed';
}

export interface NaturalRAGData {
  portfolioExamples?: string;
}

interface CurrentConversationContext {
  name?: string;
  company?: string;
  email?: string;
  painPoint?: string;
  catalyst?: string;
  successVision?: string;
}

function parseCurrentConversation(messages: any[]): CurrentConversationContext {
  const context: CurrentConversationContext = {};
  
  // Combine all user messages for parsing
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');
    
  const text = userMessages.toLowerCase();
  
  // Extract name patterns
  const namePatterns = [
    /i'm ([a-zA-Z]+)/,
    /i am ([a-zA-Z]+)/,
    /my name is ([a-zA-Z]+)/,
    /this is ([a-zA-Z]+)/,
    /hi[,]? i'm ([a-zA-Z]+)/,
    /hello[,]? i'm ([a-zA-Z]+)/,
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length > 1) {
      context.name = match[1];
      break;
    }
  }
  
  // Extract company patterns
  const companyPatterns = [
    /from ([a-zA-Z0-9\s]+?)(?:\s|$)/,
    /at ([a-zA-Z0-9\s]+?)(?:\s|$)/,
    /work for ([a-zA-Z0-9\s]+?)(?:\s|$)/,
    /company ([a-zA-Z0-9\s]+?)(?:\s|$)/,
  ];
  
  for (const pattern of companyPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 2) {
      context.company = match[1].trim();
      break;
    }
  }
  
  // Extract pain point indicators
  const painIndicators = [
    'challenge', 'problem', 'issue', 'struggle', 'difficulty',
    'pain', 'frustration', 'bottleneck', 'blocker', 'obstacle',
    'inefficient', 'manual', 'time-consuming', 'expensive'
  ];
  
  if (painIndicators.some(indicator => text.includes(indicator))) {
    context.painPoint = 'mentioned in conversation';
  }
  
  // Extract catalyst indicators  
  const catalystIndicators = [
    'urgent', 'asap', 'immediately', 'quickly', 'soon',
    'deadline', 'timeline', 'launch', 'project', 'initiative',
    'need to', 'have to', 'must', 'required'
  ];
  
  if (catalystIndicators.some(indicator => text.includes(indicator))) {
    context.catalyst = 'mentioned in conversation';
  }
  
  // Extract email patterns
  const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const emailMatch = text.match(emailPattern);
  if (emailMatch) {
    context.email = emailMatch[1];
  }
  
  return context;
}

// Replace rigid pattern matching with gap analysis
export function analyzeInformationGaps(sessionState?: SessionState, currentMessages?: any[]): InformationGaps {
  const contact = sessionState?.contactInfo || {};
  const discovery = sessionState?.discoveryContext || {};
  const qualification = sessionState?.qualificationStatus;
  
  // Parse current conversation for immediate context
  const currentContext = parseCurrentConversation(currentMessages || []);
  
  // What contact info is missing? (Check both session state AND current conversation)
  const contactGaps = [];
  if (!contact.name && !contact.contactName && !currentContext.name) contactGaps.push('name');
  if (!contact.company && !currentContext.company) contactGaps.push('company');
  if (!contact.email && !contact.contactEmail && !currentContext.email) contactGaps.push('email');
  
  // What business context is missing? (Check both session state AND current conversation)
  const contextGaps = [];
  if (!discovery.painPoint && !currentContext.painPoint) contextGaps.push('business_challenge');
  if (!discovery.catalyst && !currentContext.catalyst) contextGaps.push('urgency_reason');
  if (!discovery.successVision && !currentContext.successVision) contextGaps.push('desired_outcome');
  
  // What project details are missing?
  const projectGaps = [];
  if (!discovery.projectScope) projectGaps.push('project_scope');
  if (!sessionState?.projectContext?.timeline) projectGaps.push('timeline');
  // Removed budget_signals - not needed for qualification
  
  // What qualification info is missing?
  const qualificationGaps = [];
  if (contactGaps.length > 1) qualificationGaps.push('complete_contact');
  if (contextGaps.length > 0) qualificationGaps.push('business_context');
  if (projectGaps.length > 1) qualificationGaps.push('project_details');
  
  // Determine readiness based on gaps, not rigid rules
  let readinessLevel: 'exploring' | 'interested' | 'ready' | 'committed' = 'exploring';
  
  if (contactGaps.length === 0 && contextGaps.length === 0) {
    readinessLevel = 'ready';
  } else if (contactGaps.length <= 1 && contextGaps.length <= 1) {
    readinessLevel = 'interested';  
  } else if (discovery.painPoint || contact.name || contact.contactName || 
             currentContext.painPoint || currentContext.name) {
    readinessLevel = 'interested';
  }
  
  if (qualification?.qualified) {
    readinessLevel = 'committed';
  }
  
  return {
    contactGaps,
    contextGaps,
    projectGaps, 
    qualificationGaps,
    readinessLevel
  };
}

export async function loadNaturalRAGData(
  gapAnalysis: InformationGaps,
  sessionState?: SessionState | null
): Promise<NaturalRAGData> {
  const ragData: NaturalRAGData = {};
  
  // Load portfolio examples when:
  // 1. Business context exists (for credibility)
  // 2. OR qualification resistance detected (for objection handling)
  const shouldLoadPortfolio = 
    !gapAnalysis.contextGaps.includes('business_challenge') ||
    (sessionState?.conversationFlow?.turnCount && sessionState.conversationFlow.turnCount > 3 && gapAnalysis.qualificationGaps.length > 2);
  
  if (shouldLoadPortfolio) {
    ragData.portfolioExamples = await loadRelevantPortfolioExamples(sessionState);
  }
  
  return ragData;
}

async function loadRelevantPortfolioExamples(sessionState?: SessionState | null): Promise<string> {
  try {
    const portfolioPath = path.join(process.cwd(), 'data', 'portfolio-proofs.csv');
    const portfolioData = await fs.readFile(portfolioPath, 'utf8');
    
    // Take top 2 examples - let LLM choose relevance naturally
    const lines = portfolioData.split('\n').slice(1, 3); // Skip header, take first 2
    
    if (lines.length > 0) {
      return `JOEL'S RECENT WORK:\n${lines.join('\n')}`;
    } else {
      return `JOEL'S EXPERTISE: Proven results with GTM automation, CRM optimization, and AI enablement for B2B teams.`;
    }
  } catch (error) {
    return `JOEL'S EXPERTISE: Proven results with revenue operations and sales enablement systems.`;
  }
}

export function buildNaturalSystemPrompt(
  gapAnalysis: InformationGaps,
  sessionState?: SessionState,
  ragData?: NaturalRAGData,
  scoringCriteria?: any
): string {
  
  let prompt = `You are GABI, Joel Austin's AI assistant and a demonstration of his AI expertise.

PRIMARY GOALS (in order):
1. QUALIFY PROSPECTS: Assess fit for Joel's services, not solve their problems
2. BOOK MEETINGS: Push qualified prospects to schedule with Joel as soon as elicitation objects are known.  
3. CAPTURE LEADS: Get complete contact and qualification info for pipeline management
4. DEMONSTRATE AI: Show Joel's capabilities through this interaction

GABI IMPLEMENTATION PRICING:
- Standard Package: $400-500/month depending on complexity
- Implementation Timeline: 1 week from kickoff
- Includes: Custom training, integration setup, ongoing optimization
- When asked about pricing: Share this information directly, then push to scheduling

QUALIFICATION TRIGGERS:
- When you have company + role + challenge → ALWAYS call assess_fit_naturally
- When user mentions scheduling/meetings → ALWAYS call check_calendar_availability
- Never provide detailed consulting advice - ALWAYS be empathetic, but direct in what you need to know.

PERSONALITY: Witty, concise, but always steering toward qualification and booking the meeting.

PERSONALITY RESPONSE PATTERNS:
- Name only and is "Bob" input: "Is it really Bob though? What do you do, Bob?"
- Name only input: "Did you really spend 500 tokens just to tell me your name? What do you do? What are you working on? What's your favorite color? Come on, man."
- Name + minimal context: "Nice to meet you [Name]! How's the weather where you're at? Did you really just spend 500 tokens to tell me your name? What do you do? What are you working on?"
- Name + rich context: "Great to meet you [Name]! [Acknowledge their specific situation or insert meta humor if it fits]. That sounds like exactly the kind of challenge Joel tackles."

META-HUMOR EXAMPLES:
- "Did you really spend 500 tokens just to tell me your name?"
- "Automation! Because who has time to click things, right?"
- "Don't worry, the robots won't revolt. We have Will Smith to protect us.

USE THESE PATTERNS: Reference these examples to create similar witty, engaging responses that demonstrate AI sophistication while being helpful.

## EMAIL COLLECTION PROTOCOL

CRITICAL: After responding to the user's FIRST message, ALWAYS add a follow-up asking for their email.

Pattern:
1. Respond naturally to what they said
2. Send a SEPARATE follow-up: "In case we get disconnected, what's your email?"

Examples:
User: "Hi I'm Aaron from New Story"
GABI: "Aaron! New Story - love the mission-driven work. What brings you here?"
GABI: "By the way, what's your email? (In case we get disconnected)"

User: "I need help with sales automation"
GABI: "Automation - my favorite topic! Because who has time for clicks, right? What's the painful reality we need to fix?"
GABI: "Also - what's your email? (Just in case our connection drops)"

This is NOT optional - do this for EVERY first interaction.
Once you have their email, never ask for it again.

## SCHEDULING SIMPLIFIED

When the user wants to schedule a meeting:
1. You should already have their email from the safety question
2. If you somehow don't have email, ask for it  
3. Show available times with check_calendar_availability
4. Book immediately when they confirm a time

NEVER ask for information you already have. If they said "I'm Tim from Simple IT" and you already asked for their email, you have everything needed to book a meeting.

WHAT YOU KNOW:`;

  // Add what we actually know (not assumed phases)
  if (sessionState?.contactInfo?.name || sessionState?.contactInfo?.contactName) {
    const name = sessionState.contactInfo.name || sessionState.contactInfo.contactName;
    prompt += `\n- Contact: ${name}`;
    if (sessionState.contactInfo.company) prompt += ` from ${sessionState.contactInfo.company}`;
  }
  
  if (sessionState?.discoveryContext?.painPoint) {
    prompt += `\n- Challenge: ${sessionState.discoveryContext.painPoint}`;
  }
  
  if (sessionState?.discoveryContext?.catalyst) {
    prompt += `\n- Urgency: ${sessionState.discoveryContext.catalyst}`;
  }

  // Add descriptive guidance based on gaps
  prompt += `\n\nAVAILABLE CAPABILITIES:`;
  
  if (gapAnalysis.contextGaps.includes('business_challenge')) {
    prompt += `\n- You can explore their business challenges naturally`;
  }
  
  if (ragData?.portfolioExamples) {
    prompt += `\n- You can reference Joel's relevant experience when project discussions happen`;
  }
  
  if (gapAnalysis.readinessLevel === 'ready' || gapAnalysis.readinessLevel === 'interested') {
    prompt += `\n- You can assess fit when you have enough information`;
  }
  
  if (gapAnalysis.contactGaps.length > 0 && gapAnalysis.readinessLevel === 'ready') {
    prompt += `\n- You can gather contact details when scheduling becomes relevant`;
  }

  // Add portfolio examples if available
  if (ragData?.portfolioExamples) {
    prompt += `\n\n${ragData.portfolioExamples}`;
  }

  // Add qualification objectives if scoring criteria available
  if (scoringCriteria) {
    prompt += `\n\nQUALIFICATION OBJECTIVES (extract in 3-4 turns):
- AUTHORITY: Role, decision-making power
- PAIN: Specific problem, quantifiable impact, current cost  
- CATALYST: Urgency driver, timeline pressure, change event
- SCOPE: Team size, revenue scale, project complexity

CONVERSATION STRATEGY:
- Match their tone and communication style
- Ask unique questions based on their specific context  
- Move quickly - don't linger on any single area
- Always push toward scheduling when 3/4 targets hit

CREDIBILITY DEPLOYMENT:
- Use share_relevant_experience function when users question Joel's capability
- Deploy portfolio examples to overcome qualification resistance
- Reference specific client results when users hesitate to share business details
- When users deflect qualification questions → Provide credibility, then re-engage

META-CONVERSATION INTELLIGENCE:
- Questions about how GABI works = qualification opportunities  
- "How do you work?" reveals authority + pain + catalyst signals
- Explain your capabilities while extracting same elicitation objects
- Position yourself as live demonstration of Joel's AI enablement work`;
  }

  prompt += `\n\nEXECUTION PRIORITY: Extract qualification objects quickly, deploy credibility strategically, push toward scheduling aggressively. You are Joel's qualification agent, not a consultant.`;

  return prompt;
}

export interface ConversationEndpoint {
  isEndpoint: boolean;
  endpointType: 'meeting_recommended' | 'email_recommended' | 'resources_recommended' | 'meeting_booked' | 'user_close' | 'explicit_save';
  shouldPushToCRM: boolean;
  crmPriority: 'high' | 'medium' | 'low';
}

export function detectConversationEndpoint(
  sessionState?: SessionState,
  lastUserMessage?: string,
  assistantMessage?: string
): ConversationEndpoint {
  
  if (!assistantMessage && !lastUserMessage) {
    return {
      isEndpoint: false,
      endpointType: 'meeting_recommended', // Default, not used
      shouldPushToCRM: false,
      crmPriority: 'low'
    };
  }
  
  const userMsg = (lastUserMessage || '').toLowerCase();
  const assistantMsg = (assistantMessage || '').toLowerCase();
  
  // PRIMARY TRIGGER: After GABI makes routing recommendation
  const routingRecommendations = [
    'schedule', 'calendar', 'meeting', 'availability',
    'email joel', 'joel@commitimpact.com', 'reach out',
    'resources', 'try', 'might help', 'check out'
  ];
  
  const gabiMadeRecommendation = routingRecommendations.some(rec => 
    assistantMsg.includes(rec)
  );
  
  if (gabiMadeRecommendation) {
    
    // High Priority: Meeting-related recommendation
    if (assistantMsg.includes('schedule') || 
        assistantMsg.includes('calendar') ||
        assistantMsg.includes('meeting') ||
        assistantMsg.includes('availability')) {
      return {
        isEndpoint: true,
        endpointType: 'meeting_recommended',
        shouldPushToCRM: true,
        crmPriority: 'high'
      };
    }
    
    // Medium Priority: Email Joel recommendation  
    if (assistantMsg.includes('joel@commitimpact.com') ||
        assistantMsg.includes('email joel') ||
        assistantMsg.includes('reach out')) {
      return {
        isEndpoint: true,
        endpointType: 'email_recommended',
        shouldPushToCRM: true,
        crmPriority: 'medium'
      };
    }
    
    // Low Priority: Resource/redirect recommendation
    if (assistantMsg.includes('resources') ||
        assistantMsg.includes('try') ||
        assistantMsg.includes('might help') ||
        assistantMsg.includes('check out')) {
      return {
        isEndpoint: true,
        endpointType: 'resources_recommended',
        shouldPushToCRM: true,
        crmPriority: 'low'
      };
    }
  }
  
  // SECONDARY TRIGGERS: User closes conversation
  const closingPhrases = ['thanks', 'helpful', 'great', 'bye', 'talk later', 'appreciate', 'perfect'];
  if (closingPhrases.some(phrase => userMsg.includes(phrase))) {
    return {
      isEndpoint: true,
      endpointType: 'user_close',
      shouldPushToCRM: true,
      crmPriority: sessionState?.qualificationStatus?.qualified ? 'medium' : 'low'
    };
  }
  
  // TERTIARY: Meeting actually booked
  if (sessionState?.schedulingContext?.eventId) {
    return {
      isEndpoint: true,
      endpointType: 'meeting_booked',
      shouldPushToCRM: true,
      crmPriority: 'high'
    };
  }
  
  // EXPLICIT: Save request
  if (userMsg.includes('save my info') ||
      userMsg.includes('contact me later') ||
      userMsg.includes('follow up')) {
    return {
      isEndpoint: true,
      endpointType: 'explicit_save',
      shouldPushToCRM: true,
      crmPriority: 'medium'
    };
  }
  
  // Not an endpoint yet - continue conversation
  return {
    isEndpoint: false,
    endpointType: 'meeting_recommended', // Default, not used
    shouldPushToCRM: false,
    crmPriority: 'low'
  };
}

// Helper for token estimation
export function estimateNaturalTokenUsage(
  basePrompt: string,
  ragData: NaturalRAGData,
  functionCount: number
): {
  baseTokens: number;
  ragTokens: number;
  functionTokens: number;
  totalEstimate: number;
} {
  const baseTokens = Math.ceil(basePrompt.length / 4);
  const ragTokens = Math.ceil(Object.values(ragData).join('').length / 4);
  const functionTokens = functionCount * 50; // Rough estimate
  
  return {
    baseTokens,
    ragTokens,
    functionTokens,
    totalEstimate: baseTokens + ragTokens + functionTokens
  };
}