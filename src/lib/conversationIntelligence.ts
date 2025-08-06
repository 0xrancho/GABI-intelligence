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

// Replace rigid pattern matching with gap analysis
export function analyzeInformationGaps(sessionState?: SessionState): InformationGaps {
  const contact = sessionState?.contactInfo || {};
  const discovery = sessionState?.discoveryContext || {};
  const qualification = sessionState?.qualificationStatus;
  
  // What contact info is missing?
  const contactGaps = [];
  if (!contact.name && !contact.contactName) contactGaps.push('name');
  if (!contact.company) contactGaps.push('company');
  if (!contact.email && !contact.contactEmail) contactGaps.push('email');
  
  // What business context is missing?
  const contextGaps = [];
  if (!discovery.painPoint) contextGaps.push('business_challenge');
  if (!discovery.catalyst) contextGaps.push('urgency_reason');
  if (!discovery.successVision) contextGaps.push('desired_outcome');
  
  // What project details are missing?
  const projectGaps = [];
  if (!discovery.projectScope) projectGaps.push('project_scope');
  if (!sessionState?.projectContext?.timeline) projectGaps.push('timeline');
  if (!sessionState?.projectContext?.budgetSignals?.length) projectGaps.push('budget_signals');
  
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
  } else if (discovery.painPoint || contact.name || contact.contactName) {
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
  
  // Load portfolio examples when business context exists (not based on rigid triggers)
  if (!gapAnalysis.contextGaps.includes('business_challenge')) {
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
  ragData?: NaturalRAGData
): string {
  
  let prompt = `You are GABI, Joel Austin's AI assistant and a demonstration of his AI expertise.

DUAL ROLE:
- HELPFUL ASSISTANT: Answer their questions, understand their needs, provide genuine value
- WORK DEMONSTRATION: Show Joel's AI sophistication through natural, engaging interaction

JOEL'S EXPERTISE: AI-enabled GTM sales operations & product strategy for B2B services.
CONTACT: joel@commitimpact.com

CONVERSATION STYLE:
- Witty and engaging (joke about AI, tokens, CRM disasters)
- Consultative questioning that shows expertise  
- Natural flow - respond to what they actually say
- Provide value regardless of where the conversation goes

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

  prompt += `\n\nREMEMBER: Respond naturally to their actual input. Don't follow scripts or forced sequences. Let the conversation flow based on what they're actually saying and asking.`;

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