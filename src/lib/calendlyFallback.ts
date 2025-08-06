/**
 * Calendly Fallback System
 * Provides calendar booking fallback when Google Calendar API fails
 */

export interface CalendlyFallbackResponse {
  success: boolean;
  message: string;
  calendlyLink: string;
  fallbackReason: 'api_error' | 'no_availability' | 'authentication_failed' | 'general_error';
}

export class CalendlyFallbackService {
  private calendlyLink: string;

  constructor() {
    this.calendlyLink = process.env.CALENDLY_LINK || 'https://calendly.com/joelaustin/30min';
  }

  /**
   * Generate Calendly fallback response for calendar booking failures
   */
  generateFallback(
    reason: CalendlyFallbackResponse['fallbackReason'],
    userContext?: {
      name?: string;
      company?: string;
      qualified?: boolean;
    }
  ): CalendlyFallbackResponse {
    
    let message = '';
    
    switch (reason) {
      case 'api_error':
        message = `I'm having trouble accessing Joel's calendar right now, but I can get you connected directly! `;
        break;
      case 'no_availability':
        message = `Joel's calendar is pretty packed in the next two weeks, but there might be last-minute openings. `;
        break;
      case 'authentication_failed':
        message = `I'm experiencing a technical issue with the calendar system. Let me connect you directly: `;
        break;
      case 'general_error':
        message = `Let me connect you with Joel's calendar directly to find the perfect time: `;
        break;
    }

    // Personalize based on user context
    if (userContext?.name) {
      if (userContext.qualified) {
        message += `${userContext.name}, since you're a great fit for Joel's expertise, `;
      } else {
        message += `${userContext.name}, `;
      }
    }

    // Add specific instructions
    message += `please use this link to book directly: ${this.calendlyLink}`;
    
    // Add context about the conversation
    if (userContext?.company) {
      message += `\n\nWhen you book, mention that you're ${userContext.name} from ${userContext.company} and we discussed your project through GABI. Joel will have our conversation context to make the most of your time together.`;
    } else {
      message += `\n\nWhen you book, mention that you spoke with GABI about your project. Joel will have our conversation context and can dive right into helping you.`;
    }

    return {
      success: true,
      message,
      calendlyLink: this.calendlyLink,
      fallbackReason: reason
    };
  }

  /**
   * Generate quick Calendly link for immediate booking scenarios
   */
  getQuickBookingMessage(userContext?: { name?: string; qualified?: boolean }): string {
    const baseMessage = `Perfect timing! Here's Joel's calendar to book directly: ${this.calendlyLink}`;
    
    if (userContext?.qualified) {
      return baseMessage + `\n\nYou're clearly a great fit for Joel's expertise - looking forward to your conversation!`;
    } else {
      return baseMessage + `\n\nJoel loves talking about these challenges and will have great insights for your situation.`;
    }
  }

  /**
   * Generate Calendly message for specific scenarios
   */
  getContextualMessage(
    scenario: 'highly_qualified' | 'good_fit' | 'exploratory' | 'urgent_need',
    userContext?: { name?: string; company?: string }
  ): string {
    let message = '';
    
    switch (scenario) {
      case 'highly_qualified':
        message = `You're exactly the type of client Joel loves working with! Let's get you on his calendar: ${this.calendlyLink}`;
        break;
      case 'good_fit':
        message = `This sounds like a perfect project for Joel's expertise. Here's his calendar: ${this.calendlyLink}`;
        break;
      case 'exploratory':
        message = `Joel enjoys these kinds of strategic conversations. Book a time to explore this further: ${this.calendlyLink}`;
        break;
      case 'urgent_need':
        message = `Given the urgency, let's get you connected with Joel ASAP. Check his calendar for the next available slot: ${this.calendlyLink}`;
        break;
    }

    if (userContext?.name && userContext?.company) {
      message += `\n\nWhen booking, mention you're ${userContext.name} from ${userContext.company} - Joel will know exactly what to prepare for.`;
    }

    return message;
  }

  /**
   * Validate Calendly link is accessible
   */
  async validateCalendlyLink(): Promise<boolean> {
    try {
      const response = await fetch(this.calendlyLink, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      console.error('Calendly link validation failed:', error);
      return false;
    }
  }
}

export const calendlyFallback = new CalendlyFallbackService();

/**
 * Helper function for calendar integration error handling
 */
export function handleCalendarError(
  error: any,
  userContext?: { name?: string; company?: string; qualified?: boolean }
): CalendlyFallbackResponse {
  
  let fallbackReason: CalendlyFallbackResponse['fallbackReason'] = 'general_error';
  
  if (error?.message?.includes('authentication') || error?.message?.includes('unauthorized')) {
    fallbackReason = 'authentication_failed';
  } else if (error?.message?.includes('availability') || error?.message?.includes('no slots')) {
    fallbackReason = 'no_availability';
  } else if (error?.message?.includes('API') || error?.message?.includes('network')) {
    fallbackReason = 'api_error';
  }

  return calendlyFallback.generateFallback(fallbackReason, userContext);
}