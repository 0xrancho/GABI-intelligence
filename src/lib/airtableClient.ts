import Airtable, { FieldSet, Record } from 'airtable';

// Configure Airtable
const base = new Airtable({
  personalAccessToken: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID || '');

// Lead qualification scoring weights
export const QUALIFICATION_WEIGHTS = {
  BUDGET_SIGNALS: 25,
  TIMELINE_URGENCY: 20,
  DECISION_AUTHORITY: 20,
  PROJECT_CLARITY: 15,
  COMPANY_SIZE: 10,
  ENGAGEMENT_DEPTH: 10
};

// Intent signal types
export const INTENT_SIGNALS = {
  HIGH: ['pricing', 'cost', 'timeline', 'deadline', 'budget', 'hire', 'need help'],
  MEDIUM: ['considering', 'exploring', 'looking into', 'thinking about', 'planning'],
  LOW: ['curious', 'learning', 'understanding', 'general question']
};

// Contact record interface
export interface ContactRecord {
  id?: string;
  fields: {
    'Contact Email'?: string;
    'Session ID'?: string;
    'Company'?: string;
    'Company Size'?: string;
    'URL'?: string;
    'Contact Name'?: string;
    'Role'?: string;
    'Industry'?: string;
    'Interest'?: string;
    'Pain Point'?: string;
    'Qualified'?: string;
    'Lead Score'?: string;
    'Lead Source'?: string;
    'Meeting Scheduled'?: string;
    'Referrals'?: string;
    'First Contact'?: string;
    'Last Updated'?: string;
    'Meeting Date'?: string;
    'Project Context'?: string;
    'Intent Signals'?: string;
    'Budget Signals'?: string;
    'Timeline Signals'?: string;
    'Decision Authority'?: string;
    'Next Action'?: string;
  };
}

// Session state interface
export interface SessionState {
  sessionId: string;
  
  // Contact Information
  contactInfo: {
    name?: string;
    email?: string;  
    company?: string;
    role?: string;
    // Keep backward compatibility
    contactName?: string;
    contactEmail?: string;
    industry?: string;
  };
  
  // Business Context Discovery
  businessContext?: {
    industry?: string;
    companySize?: string;
    businessModel?: string;
    currentPain?: string;
  };
  
  // Project Context
  projectContext: {
    challenges?: string[];
    timeline?: string;
    budgetSignals?: string[];
    requirements?: string[];
    painPoint?: string;
    interest?: string;
    // Enhanced project fields
    catalyst?: string; // What's driving urgency
    scope?: string; // What they want to accomplish
    budget?: string;
    urgency?: string;
  };
  
  // Conversation Flow Tracking
  conversationFlow?: {
    phase: 'rapport' | 'discovery' | 'qualification' | 'scheduling' | 'complete';
    turnCount: number;
    topicsDiscussed: string[];
    lastPortfolioReference?: string;
    qualificationAttempted?: boolean;
  };
  
  // Conversation Intelligence (for triggering)
  conversationState?: {
    phase: 'rapport' | 'discovery' | 'credibility' | 'qualification' | 'contact_capture' | 'scheduling' | 'complete';
    turnCount: number;
    personalityEstablished: boolean;
    portfolioReferenced: boolean;
    discoveryComplete: boolean;
    qualificationAttempted: boolean;
  };
  
  // Enhanced Discovery Context
  discoveryContext?: {
    painPoint?: string; // "What's broken?"
    catalyst?: string; // "Why now?"
    successVision?: string; // "What does success look like?"
    projectScope?: string; // "What's the scope?"
  };
  
  // Qualification Results
  qualificationStatus?: {
    hasContactInfo: boolean;
    hasBusinessContext: boolean;
    hasProjectCatalyst: boolean;
    hasProjectScope: boolean;
    hasTimelinePressure: boolean;
    hasBudgetSignals: boolean;
    qualified: boolean;
    reasoning: string;
    confidenceScore: number;
    assessedAt: Date;
    meetingEligible: boolean;
  };

  // Existing fields (keep for backward compatibility)
  qualificationScore: number;
  intentSignals: string[];
  captureStage: string;
  triggersUsed: string[];
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    triggers?: string[];
  }>;
  lastActivity: Date;
  createdAt?: Date;
  updatedAt?: Date;
  
  // Scheduling-related fields
  schedulingContext?: {
    context: string;
    meetingType: string;
    suggestedDuration?: number;
    eventId?: string; // Google Calendar event ID
    calendarLink?: string;
    meetLink?: string;
  };
  userAvailability?: {
    rawInput: string;
    preferences: any;
    processedAt: Date;
  };
  mutualAvailability?: {
    suggestions: string[];
    userPreferences: any;
    duration: number;
    generatedAt: Date;
  };
  
  // CRM Save Tracking
  crmSaved?: boolean;
  pendingBooking?: {
    proposedTime: Date;
    details: any;
    confirmedAt: Date;
  };
}

export class AirtableClient {
  private contactsTable = base('GABI-Leads');
  // private projectsTable = base('Projects'); // Removed - table doesn't exist
  // private interactionsTable = base('Interactions'); // Removed - table doesn't exist

  // Create or update contact with progressive capture
  async upsertContact(sessionId: string, contactData: Partial<ContactRecord['fields']>): Promise<ContactRecord> {
    try {
      // Check for existing contact by email or session
      const existingContact = await this.findExistingContact(contactData['Contact Email'], sessionId);
      
      if (existingContact) {
        // Update existing contact
        const updatedRecord = await this.contactsTable.update(existingContact.id, {
          ...contactData,
          'Last Updated': new Date().toISOString(),
          'Session ID': sessionId,
        });
        
        return {
          id: updatedRecord.id,
          fields: updatedRecord.fields as ContactRecord['fields']
        };
      } else {
        // Create new contact
        const newRecord = await this.contactsTable.create({
          ...contactData,
          'First Contact': new Date().toISOString(),
          'Last Updated': new Date().toISOString(),
          'Session ID': sessionId,
          'Qualified': 'New',
          'Lead Source': 'Chat Widget',
        });
        
        return {
          id: newRecord.id,
          fields: newRecord.fields as ContactRecord['fields']
        };
      }
    } catch (error) {
      console.error('Error upserting contact:', error);
      throw new Error('Failed to save contact information');
    }
  }

  // Find existing contact by email or session ID
  async findExistingContact(email?: string, sessionId?: string): Promise<Record<FieldSet> | null> {
    try {
      let filterFormula = '';
      
      if (email && sessionId) {
        filterFormula = `OR({Contact Email} = '${email}', {Session ID} = '${sessionId}')`;
      } else if (email) {
        filterFormula = `{Contact Email} = '${email}'`;
      } else if (sessionId) {
        filterFormula = `{Session ID} = '${sessionId}'`;
      } else {
        return null;
      }

      const records = await this.contactsTable.select({
        filterByFormula: filterFormula,
        maxRecords: 1
      }).firstPage();

      return records.length > 0 ? records[0] : null;
    } catch (error) {
      console.error('Error finding existing contact:', error);
      return null;
    }
  }

  // Calculate qualification score based on conversation data
  calculateQualificationScore(sessionState: SessionState): number {
    let score = 0;

    // Budget signals (25 points)
    const budgetKeywords = ['budget', 'cost', 'price', 'investment', 'funding', 'spend'];
    const budgetSignalCount = sessionState.projectContext.budgetSignals?.length || 0;
    score += Math.min(budgetSignalCount * 8, QUALIFICATION_WEIGHTS.BUDGET_SIGNALS);

    // Timeline urgency (20 points)
    const timelineKeywords = ['urgent', 'asap', 'deadline', 'soon', 'immediately', 'this month', 'this week'];
    const hasUrgentTimeline = sessionState.projectContext.timeline && 
      timelineKeywords.some(keyword => sessionState.projectContext.timeline?.toLowerCase().includes(keyword));
    score += hasUrgentTimeline ? QUALIFICATION_WEIGHTS.TIMELINE_URGENCY : 0;

    // Decision authority (20 points)
    const authorityRoles = ['ceo', 'cto', 'founder', 'director', 'manager', 'lead', 'head'];
    const hasAuthority = sessionState.contactInfo.role && 
      authorityRoles.some(role => sessionState.contactInfo.role?.toLowerCase().includes(role));
    score += hasAuthority ? QUALIFICATION_WEIGHTS.DECISION_AUTHORITY : 0;

    // Project clarity (15 points)
    const challengeCount = sessionState.projectContext.challenges?.length || 0;
    score += Math.min(challengeCount * 5, QUALIFICATION_WEIGHTS.PROJECT_CLARITY);

    // Company size (10 points) - estimate based on email domain or explicit mention
    const hasCompanyEmail = sessionState.contactInfo.contactEmail && 
      !sessionState.contactInfo.contactEmail.includes('gmail') && 
      !sessionState.contactInfo.contactEmail.includes('yahoo') && 
      !sessionState.contactInfo.contactEmail.includes('hotmail');
    score += hasCompanyEmail ? QUALIFICATION_WEIGHTS.COMPANY_SIZE : 0;

    // Engagement depth (10 points)
    const messageCount = sessionState.conversationHistory.length;
    const engagementScore = Math.min(messageCount * 2, QUALIFICATION_WEIGHTS.ENGAGEMENT_DEPTH);
    score += engagementScore;

    return Math.min(score, 100);
  }

  // Analyze intent signals from conversation
  analyzeIntentSignals(conversationHistory: SessionState['conversationHistory']): string[] {
    const allText = conversationHistory
      .map(msg => msg.content.toLowerCase())
      .join(' ');

    const signals: string[] = [];

    // Check for high intent signals
    INTENT_SIGNALS.HIGH.forEach(signal => {
      if (allText.includes(signal)) {
        signals.push(`HIGH: ${signal}`);
      }
    });

    // Check for medium intent signals
    INTENT_SIGNALS.MEDIUM.forEach(signal => {
      if (allText.includes(signal)) {
        signals.push(`MEDIUM: ${signal}`);
      }
    });

    // Check for low intent signals
    INTENT_SIGNALS.LOW.forEach(signal => {
      if (allText.includes(signal)) {
        signals.push(`LOW: ${signal}`);
      }
    });

    return signals;
  }

  // Update contact with progressive capture data
  async updateProgressiveCapture(
    contactId: string, 
    sessionState: SessionState,
    newTrigger?: string
  ): Promise<void> {
    try {
      const qualificationScore = this.calculateQualificationScore(sessionState);
      const intentSignals = this.analyzeIntentSignals(sessionState.conversationHistory);
      
      // Determine next capture stage
      const nextStage = this.determineNextCaptureStage(sessionState);
      
      // Update triggers used
      const triggersUsed = newTrigger ? 
        [...sessionState.triggersUsed, newTrigger] : 
        sessionState.triggersUsed;

      await this.contactsTable.update(contactId, {
        'Lead Score': qualificationScore.toString(),
        'Intent Signals': intentSignals.join(', '),
        'Project Context': JSON.stringify(sessionState.projectContext),
        'Last Updated': new Date().toISOString(),
      });

    } catch (error) {
      console.error('Error updating progressive capture:', error);
      throw new Error('Failed to update contact progression');
    }
  }

  // Determine next appropriate capture stage
  private determineNextCaptureStage(sessionState: SessionState): string {
    const { contactInfo } = sessionState;
    
    if (!contactInfo.contactName) return 'Name';
    if (!contactInfo.contactEmail) return 'Email';
    if (!contactInfo.company) return 'Company';
    if (!contactInfo.role) return 'Role';
    if (!sessionState.projectContext.challenges?.length) return 'Project';
    
    return 'Qualified';
  }

  // Log interaction for tracking - DISABLED (table doesn't exist)
  // async logInteraction(
  //   contactId: string,
  //   sessionId: string,
  //   interactionType: string,
  //   details: any
  // ): Promise<void> {
  //   try {
  //     await this.interactionsTable.create({
  //       'Contact': [contactId],
  //       'Session ID': sessionId,
  //       'Interaction Type': interactionType,
  //       'Timestamp': new Date().toISOString(),
  //       'Details': JSON.stringify(details),
  //     });
  //   } catch (error) {
  //     console.error('Error logging interaction:', error);
  //     // Don't throw error for logging failures
  //   }
  // }

  // Get contact by session ID for retrieval
  async getContactBySession(sessionId: string): Promise<ContactRecord | null> {
    try {
      const records = await this.contactsTable.select({
        filterByFormula: `{Session ID} = '${sessionId}'`,
        maxRecords: 1
      }).firstPage();

      if (records.length === 0) return null;

      return {
        id: records[0].id,
        fields: records[0].fields as ContactRecord['fields']
      };
    } catch (error) {
      console.error('Error getting contact by session:', error);
      return null;
    }
  }

  // Get all contacts with pagination
  async getContacts(
    filterBy?: 'all' | 'qualified' | 'new' | 'contacted',
    offset?: string
  ): Promise<{ records: ContactRecord[]; offset?: string }> {
    try {
      let filterFormula = '';
      
      switch (filterBy) {
        case 'qualified':
          filterFormula = 'VALUE({Lead Score}) >= 60';
          break;
        case 'new':
          filterFormula = '{Qualified} = "New"';
          break;
        case 'contacted':
          filterFormula = '{Qualified} = "Contacted"';
          break;
        default:
          // all contacts
          break;
      }

      const query = this.contactsTable.select({
        filterByFormula: filterFormula,
        sort: [{ field: 'Last Updated', direction: 'desc' }],
        pageSize: 25,
        offset: offset
      });

      const page = await query.firstPage();
      
      return {
        records: page.map(record => ({
          id: record.id,
          fields: record.fields as ContactRecord['fields']
        })),
        offset: query.offset
      };
    } catch (error) {
      console.error('Error getting contacts:', error);
      throw new Error('Failed to retrieve contacts');
    }
  }

  // Duplicate detection and enrichment
  async performDuplicateCheck(email: string, company?: string): Promise<ContactRecord[]> {
    try {
      let filterFormula = `{Contact Email} = '${email}'`;
      
      if (company) {
        filterFormula = `OR(${filterFormula}, AND({Company} = '${company}', {Contact Email} != ''))`;
      }

      const records = await this.contactsTable.select({
        filterByFormula: filterFormula
      }).firstPage();

      return records.map(record => ({
        id: record.id,
        fields: record.fields as ContactRecord['fields']
      }));
    } catch (error) {
      console.error('Error performing duplicate check:', error);
      return [];
    }
  }

  // Update contact status (for workflow management)
  async updateContactStatus(
    contactId: string, 
    status: string,
    nextAction?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        'Qualified': status,
        'Last Updated': new Date().toISOString(),
      };

      if (nextAction) {
        updateData['Next Action'] = nextAction;
      }

      await this.contactsTable.update(contactId, updateData);
    } catch (error) {
      console.error('Error updating contact status:', error);
      throw new Error('Failed to update contact status');
    }
  }

  // Mark calendar interaction
  async markCalendarSent(contactId: string): Promise<void> {
    try {
      await this.contactsTable.update(contactId, {
        'Meeting Scheduled': 'Calendar Sent',
        'Last Updated': new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error marking calendar sent:', error);
    }
  }

  async markMeetingBooked(contactId: string): Promise<void> {
    try {
      await this.contactsTable.update(contactId, {
        'Meeting Scheduled': 'Booked',
        'Qualified': 'Converted',
        'Meeting Date': new Date().toISOString(),
        'Last Updated': new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error marking meeting booked:', error);
    }
  }
}

export default AirtableClient;