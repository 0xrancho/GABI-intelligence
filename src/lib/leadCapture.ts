import { SessionState } from './airtableClient';

// Enhanced lead data interface
export interface LeadData {
  name: string;
  email: string;
  company?: string;
  role?: string;
  phone?: string;
  projectDescription?: string;
  challenges?: string[];
  budget?: string;
  timeline?: string;
  qualificationScore?: number;
  conversationSummary?: string;
  intentSignals?: string[];
  captureMethod?: string;
  sessionData?: SessionState;
}

// Conversation trigger patterns for progressive capture
export const CAPTURE_TRIGGERS = {
  NAME_REQUESTS: [
    "What's your name",
    "May I have your name",
    "Can I get your name",
    "Who am I speaking with",
    "I'd love to personalize this",
    "Let me know your name"
  ],
  EMAIL_REQUESTS: [
    "What's your email",
    "Can I get your email address",
    "Email so I can send this",
    "Your email for the resource",
    "I'll send that to your email",
    "Email for follow-up"
  ],
  COMPANY_REQUESTS: [
    "What company are you with",
    "Where do you work",
    "Company name for context",
    "Your organization",
    "Which company",
    "Company for relevant examples"
  ],
  ROLE_REQUESTS: [
    "What's your role",
    "Your position",
    "What do you do there",
    "Your title",
    "Role at the company"
  ],
  PROJECT_EXPLORATION: [
    "Tell me about your project",
    "What challenges are you facing",
    "What's driving this need",
    "Current situation",
    "Pain points",
    "Goals for this project"
  ]
};

// Intent analysis patterns
const INTENT_PATTERNS = {
  HIGH_INTENT: {
    budget: /\$[\d,]+|budget.*\$|invest.*\$|spend.*\$/i,
    urgency: /urgent|asap|deadline|immediately|this week|this month|rush/i,
    hiring: /hire|need help|looking for|want to work with|partner/i,
    decision: /approve|decision|moving forward|ready to proceed|next steps/i
  },
  MEDIUM_INTENT: {
    exploring: /considering|exploring|looking into|thinking about|planning/i,
    timeline: /when|timeline|schedule|timeframe|by when/i,
    comparison: /vs|versus|compare|alternative|options|other solutions/i,
    requirements: /need|require|must have|important|priority/i
  },
  LOW_INTENT: {
    learning: /curious|learning|understanding|just wondering|general question/i,
    research: /research|investigate|study|analyze|information/i,
    academic: /student|school|university|thesis|paper|study/i
  }
};

// Session state management utilities
export class SessionStateManager {
  private static sessions = new Map<string, SessionState>();
  
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  static initializeSession(sessionId?: string): SessionState {
    const id = sessionId || this.generateSessionId();
    
    const newSession: SessionState = {
      sessionId: id,
      contactInfo: {},
      projectContext: {
        challenges: [],
        budgetSignals: [],
        requirements: []
      },
      qualificationScore: 0,
      intentSignals: [],
      captureStage: 'Initial',
      triggersUsed: [],
      conversationHistory: [],
      lastActivity: new Date(),
      engagementLevel: 'Low'
    };
    
    this.sessions.set(id, newSession);
    return newSession;
  }
  
  static getSession(sessionId: string): SessionState | null {
    return this.sessions.get(sessionId) || null;
  }
  
  static updateSession(sessionId: string, updates: Partial<SessionState>): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const updatedSession = {
      ...session,
      ...updates,
      lastActivity: new Date()
    };
    
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }
  
  static addMessage(
    sessionId: string, 
    role: 'user' | 'assistant', 
    content: string,
    triggers?: string[]
  ): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    
    session.conversationHistory.push({
      role,
      content,
      timestamp: new Date(),
      triggers
    });
    
    // Update engagement level based on conversation length
    const messageCount = session.conversationHistory.length;
    session.engagementLevel = messageCount > 10 ? 'High' : 
                             messageCount > 5 ? 'Medium' : 'Low';
    
    this.sessions.set(sessionId, session);
  }
  
  // Cleanup old sessions (call periodically)
  static cleanupOldSessions(maxAgeHours: number = 24): void {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

// Progressive lead capture service
export class LeadCaptureService {
  
  // Validate contact information
  static validateContactInfo(data: Partial<LeadData>): { 
    isValid: boolean; 
    errors: string[]; 
    warnings: string[] 
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Email validation
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        errors.push('Invalid email format');
      }
      
      // Check for personal email domains
      const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
      const domain = data.email.split('@')[1]?.toLowerCase();
      if (personalDomains.includes(domain)) {
        warnings.push('Personal email domain detected');
      }
    }
    
    // Name validation
    if (data.name && data.name.length < 2) {
      errors.push('Name too short');
    }
    
    // Company validation
    if (data.company && data.company.length < 2) {
      warnings.push('Company name seems incomplete');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  // Extract contact information from conversation
  static extractContactInfo(conversationHistory: Array<{ role: string; content: string }>): Partial<LeadData> {
    const extracted: Partial<LeadData> = {};
    const allText = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .join(' ');
    
    // Email extraction
    const emailMatch = allText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      extracted.email = emailMatch[0];
    }
    
    // Name extraction (simple patterns)
    const namePatterns = [
      /i'm\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /call me\s+([a-zA-Z]+)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = allText.match(pattern);
      if (match && match[1].length > 1) {
        extracted.name = match[1].trim();
        break;
      }
    }
    
    // Company extraction
    const companyPatterns = [
      /work at\s+([a-zA-Z0-9\s&.,]+?)(?:\s|$|\.)/i,
      /company is\s+([a-zA-Z0-9\s&.,]+?)(?:\s|$|\.)/i,
      /from\s+([a-zA-Z0-9\s&.,]+?)(?:\s|$|\.)/i
    ];
    
    for (const pattern of companyPatterns) {
      const match = allText.match(pattern);
      if (match && match[1].length > 2) {
        extracted.company = match[1].trim();
        break;
      }
    }
    
    return extracted;
  }
  
  // Analyze intent signals from conversation
  static analyzeIntentSignals(conversationHistory: Array<{ role: string; content: string }>): {
    signals: string[];
    score: number;
    level: 'High' | 'Medium' | 'Low';
  } {
    const userMessages = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content.toLowerCase())
      .join(' ');
    
    const signals: string[] = [];
    let score = 0;
    
    // Check high intent patterns
    Object.entries(INTENT_PATTERNS.HIGH_INTENT).forEach(([key, pattern]) => {
      if (pattern.test(userMessages)) {
        signals.push(`HIGH: ${key}`);
        score += 3;
      }
    });
    
    // Check medium intent patterns
    Object.entries(INTENT_PATTERNS.MEDIUM_INTENT).forEach(([key, pattern]) => {
      if (pattern.test(userMessages)) {
        signals.push(`MEDIUM: ${key}`);
        score += 2;
      }
    });
    
    // Check low intent patterns
    Object.entries(INTENT_PATTERNS.LOW_INTENT).forEach(([key, pattern]) => {
      if (pattern.test(userMessages)) {
        signals.push(`LOW: ${key}`);
        score += 1;
      }
    });
    
    const level = score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low';
    
    return { signals, score, level };
  }
  
  // Calculate comprehensive qualification score
  static calculateQualificationScore(sessionState: SessionState): number {
    let score = 0;
    
    // Contact completeness (30 points)
    const contactFields = ['name', 'email', 'company', 'role'];
    const filledFields = contactFields.filter(field => 
      sessionState.contactInfo[field as keyof typeof sessionState.contactInfo]
    ).length;
    score += (filledFields / contactFields.length) * 30;
    
    // Intent signals (25 points)
    const intentAnalysis = this.analyzeIntentSignals(sessionState.conversationHistory);
    score += Math.min(intentAnalysis.score * 3, 25);
    
    // Project context (20 points)
    const projectScore = Math.min(
      (sessionState.projectContext.challenges?.length || 0) * 5 +
      (sessionState.projectContext.budgetSignals?.length || 0) * 3 +
      (sessionState.projectContext.requirements?.length || 0) * 2,
      20
    );
    score += projectScore;
    
    // Engagement level (15 points)
    const engagementPoints = sessionState.engagementLevel === 'High' ? 15 :
                           sessionState.engagementLevel === 'Medium' ? 10 : 5;
    score += engagementPoints;
    
    // Company email domain (10 points)
    const hasBusinessEmail = sessionState.contactInfo.email &&
      !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].some(domain =>
        sessionState.contactInfo.email?.includes(domain)
      );
    score += hasBusinessEmail ? 10 : 0;
    
    return Math.min(Math.round(score), 100);
  }
  
  // Determine appropriate capture trigger based on conversation stage
  static suggestCaptureStrategy(sessionState: SessionState): {
    trigger: string;
    message: string;
    priority: 'high' | 'medium' | 'low';
  } {
    const { contactInfo, captureStage, conversationHistory } = sessionState;
    const messageCount = conversationHistory.length;
    
    // Not enough conversation yet
    if (messageCount < 3) {
      return {
        trigger: 'build_rapport',
        message: 'Continue building rapport before capture',
        priority: 'low'
      };
    }
    
    // Progressive capture based on missing info
    if (!contactInfo.name) {
      return {
        trigger: 'name_capture',
        message: "I'd love to personalize our conversation. What's your name?",
        priority: 'medium'
      };
    }
    
    if (!contactInfo.email && messageCount > 5) {
      return {
        trigger: 'email_capture',
        message: "I can send you some helpful resources. What's your email address?",
        priority: 'high'
      };
    }
    
    if (!contactInfo.company && messageCount > 7) {
      return {
        trigger: 'company_capture',
        message: "What company are you with? I'd like to provide relevant examples.",
        priority: 'medium'
      };
    }
    
    if (!contactInfo.role && contactInfo.company) {
      return {
        trigger: 'role_capture',
        message: "What's your role at " + contactInfo.company + "?",
        priority: 'medium'
      };
    }
    
    // Project context capture
    if (!sessionState.projectContext.challenges?.length && messageCount > 10) {
      return {
        trigger: 'project_capture',
        message: "Tell me more about the specific challenges you're facing with this project.",
        priority: 'high'
      };
    }
    
    return {
      trigger: 'qualification_complete',
      message: 'Lead appears fully qualified',
      priority: 'low'
    };
  }
  
  // Format conversation summary for CRM
  static formatLeadSummary(leadData: LeadData): string {
    const sections: string[] = [];
    
    // Contact info section
    if (leadData.name || leadData.email || leadData.company) {
      sections.push('**Contact Information:**');
      if (leadData.name) sections.push(`- Name: ${leadData.name}`);
      if (leadData.email) sections.push(`- Email: ${leadData.email}`);
      if (leadData.company) sections.push(`- Company: ${leadData.company}`);
      if (leadData.role) sections.push(`- Role: ${leadData.role}`);
    }
    
    // Project details
    if (leadData.projectDescription || leadData.challenges?.length) {
      sections.push('\n**Project Details:**');
      if (leadData.projectDescription) {
        sections.push(`- Description: ${leadData.projectDescription}`);
      }
      if (leadData.challenges?.length) {
        sections.push(`- Challenges: ${leadData.challenges.join(', ')}`);
      }
      if (leadData.timeline) sections.push(`- Timeline: ${leadData.timeline}`);
      if (leadData.budget) sections.push(`- Budget: ${leadData.budget}`);
    }
    
    // Qualification data
    sections.push('\n**Qualification:**');
    sections.push(`- Score: ${leadData.qualificationScore || 0}/100`);
    if (leadData.intentSignals?.length) {
      sections.push(`- Intent Signals: ${leadData.intentSignals.join(', ')}`);
    }
    if (leadData.captureMethod) {
      sections.push(`- Capture Method: ${leadData.captureMethod}`);
    }
    
    // Conversation summary
    if (leadData.conversationSummary) {
      sections.push(`\n**Summary:**\n${leadData.conversationSummary}`);
    }
    
    return sections.join('\n');
  }
  
  // Check if lead meets qualification threshold
  static isQualified(qualificationScore: number, minimumThreshold: number = 60): boolean {
    return qualificationScore >= minimumThreshold;
  }
  
  // Generate capture triggers for AI responses
  static generateCapturePrompt(sessionState: SessionState): string {
    const strategy = this.suggestCaptureStrategy(sessionState);
    
    if (strategy.priority === 'low') {
      return '';
    }
    
    return `CAPTURE_TRIGGER: Consider naturally incorporating this request into your response: "${strategy.message}"`;
  }
}

export function updateSessionWithContext(
  sessionId: string, 
  updates: {
    contactInfo?: Partial<SessionState['contactInfo']>;
    businessContext?: Partial<SessionState['businessContext']>;
    projectContext?: Partial<SessionState['projectContext']>;
    conversationFlow?: Partial<SessionState['conversationFlow']>;
    discoveryContext?: Partial<SessionState['discoveryContext']>;
  }
): SessionState | null {
  const session = sessionManager.getSession(sessionId);
  if (!session) return null;
  
  // Merge updates with existing data
  if (updates.contactInfo) {
    session.contactInfo = { ...session.contactInfo, ...updates.contactInfo };
  }
  
  if (updates.businessContext) {
    session.businessContext = { ...session.businessContext, ...updates.businessContext };
  }
  
  if (updates.projectContext) {
    session.projectContext = { ...session.projectContext, ...updates.projectContext };
  }
  
  if (updates.discoveryContext) {
    session.discoveryContext = { ...session.discoveryContext, ...updates.discoveryContext };
  }
  
  if (updates.conversationFlow) {
    session.conversationFlow = { ...session.conversationFlow, ...updates.conversationFlow };
    session.conversationFlow.turnCount = (session.conversationFlow.turnCount || 0) + 1;
    session.conversationFlow.topicsDiscussed = session.conversationFlow.topicsDiscussed || [];
  }
  
  session.updatedAt = new Date();
  sessionManager.updateSession(sessionId, session);
  return session;
}

export function updateConversationPhase(
  sessionId: string,
  phase: SessionState['conversationState']['phase'],
  additionalUpdates?: Partial<SessionState['conversationState']>
): SessionState | null {
  const session = sessionManager.getSession(sessionId);
  if (!session) return null;

  if (!session.conversationState) {
    session.conversationState = {
      phase: 'rapport',
      turnCount: 0,
      personalityEstablished: false,
      portfolioReferenced: false,
      discoveryComplete: false,
      qualificationAttempted: false
    };
  }

  session.conversationState.phase = phase;
  session.conversationState.turnCount += 1;
  
  if (additionalUpdates) {
    Object.assign(session.conversationState, additionalUpdates);
  }

  sessionManager.updateSession(sessionId, session);
  return session;
}

export function updateQualificationResults(
  sessionId: string,
  qualificationData: Omit<SessionState['qualificationStatus'], 'assessedAt' | 'meetingEligible'>
): SessionState | null {
  const session = sessionManager.getSession(sessionId);
  if (!session) return null;

  session.qualificationStatus = {
    ...qualificationData,
    assessedAt: new Date(),
    meetingEligible: qualificationData.qualified
  };

  // Update conversation phase
  updateConversationPhase(
    sessionId, 
    qualificationData.qualified ? 'contact_capture' : 'discovery',
    { qualificationAttempted: true }
  );

  return session;
}

// Export session manager and lead capture service
export const sessionManager = SessionStateManager;
export const leadCapture = LeadCaptureService;

// Utility functions for frontend integration
export const leadCaptureUtils = {
  // Initialize or retrieve session
  initSession: (sessionId?: string) => sessionManager.initializeSession(sessionId),
  
  // Add message to session
  addMessage: (sessionId: string, role: 'user' | 'assistant', content: string) => 
    sessionManager.addMessage(sessionId, role, content),
  
  // Get session state
  getSession: (sessionId: string) => sessionManager.getSession(sessionId),
  
  // Calculate current qualification score
  getQualificationScore: (sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    return session ? leadCapture.calculateQualificationScore(session) : 0;
  },
  
  // Get next capture suggestion
  getNextCapture: (sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    return session ? leadCapture.suggestCaptureStrategy(session) : null;
  },
  
  // Extract contact info from current session
  extractContactInfo: (sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    return session ? leadCapture.extractContactInfo(session.conversationHistory) : {};
  }
};