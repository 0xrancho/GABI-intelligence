import { google } from 'googleapis';

export interface AvailabilitySlot {
  start: string;
  end: string;
  duration: number;
  timezone: string;
}

export interface AvailabilityResponse {
  available_slots: AvailabilitySlot[];
  qualification_status: {
    score?: number;
    qualified_for_60min: boolean;
    reason: string;
  };
  business_hours: string;
  next_available?: string;
}

export interface BookingEligibility {
  can_book_30min: boolean;
  can_book_60min: boolean;
  qualification_score?: number;
  reason: string;
}

export interface EventDetails {
  summary: string;
  description: string;
  startDateTime: Date;
  endDateTime: Date;
  attendeeEmail: string;
  attendeeName: string;
  duration: 30 | 60;
  qualificationScore?: number;
  conversationSummary?: string;
  company?: string;
  purpose?: string;
}

export interface AvailableSlot {
  start: Date;
  end: Date;
  duration: number;
}

export interface MeetingRequest {
  attendee_name: string;
  attendee_email: string;
  company: string;
  project_summary: string;
  requested_duration: number;
  start_time?: string;
  end_time?: string;
  preferred_times?: string[];
}

export class GoogleCalendarService {
  private calendar;
  private oauth2Client;
  
  constructor() {
    this.initializeClient();
  }
  
  private initializeClient() {
    try {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
      );

      // Set refresh token for server-side calendar access
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        this.oauth2Client.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });
      }

      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    } catch (error) {
      console.error('Failed to initialize Google Calendar client:', error);
      this.calendar = null;
    }
  }
  
  private getQualificationThreshold(): number {
    return parseFloat(process.env.QUALIFICATION_THRESHOLD_60MIN || '7.0');
  }
  
  private getBusinessHours(): { start: number; end: number } {
    return {
      start: parseInt(process.env.BUSINESS_HOURS_START?.replace(':', '') || '700'), // 7:00 AM
      end: parseInt(process.env.BUSINESS_HOURS_END?.replace(':', '') || '1400')    // 2:00 PM
    };
  }
  
  private getTimezone(): string {
    return process.env.CALENDAR_TIMEZONE || 'America/New_York';
  }
  
  // Expose calendar for direct API access
  get calendarAPI() {
    return this.calendar;
  }
  
  checkBookingEligibility(duration: 30 | 60, qualificationScore?: number): BookingEligibility {
    const threshold = this.getQualificationThreshold();
    const score = qualificationScore || 0;
    
    if (duration === 30) {
      return {
        can_book_30min: true,
        can_book_60min: score >= threshold,
        qualification_score: score,
        reason: '30-minute meetings available to anyone'
      };
    }
    
    if (duration === 60) {
      const qualified = score >= threshold;
      return {
        can_book_30min: true,
        can_book_60min: qualified,
        qualification_score: score,
        reason: qualified 
          ? `Qualified for 60-minute meeting (score: ${score})`
          : `60-minute meetings require qualification score ≥ ${threshold} (current: ${score})`
      };
    }
    
    return {
      can_book_30min: false,
      can_book_60min: false,
      qualification_score: score,
      reason: 'Invalid meeting duration'
    };
  }
  
  private generateTimeSlots(
    startDate: Date, 
    endDate: Date, 
    duration: 30 | 60,
    busyTimes: Array<{ start: string; end: string }>
  ): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = [];
    const businessHours = this.getBusinessHours();
    const timezone = this.getTimezone();
    
    let currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    
    while (currentDate <= endDate) {
      // Skip weekends
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }
      
      // Generate slots for business hours
      const startHour = parseInt(businessHours.start.toString().slice(0, -2));
      const endHour = parseInt(businessHours.end.toString().slice(0, -2));
      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + duration);
          
          // Skip if slot would extend past business hours
          if (slotEnd.getHours() >= endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) {
            continue;
          }
          
          // Skip if slot is in the past
          if (slotStart < new Date()) {
            continue;
          }
          
          // Check for conflicts with busy times
          const hasConflict = busyTimes.some(busy => {
            const busyStart = new Date(busy.start);
            const busyEnd = new Date(busy.end);
            return (slotStart < busyEnd && slotEnd > busyStart);
          });
          
          if (!hasConflict) {
            slots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              duration,
              timezone
            });
          }
        }
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return slots.slice(0, 50); // Limit to 50 slots
  }
  
  async getAvailability(
    startDate: Date, 
    endDate: Date, 
    duration: 30 | 60 = 30,
    qualificationScore?: number
  ): Promise<AvailabilityResponse> {
    if (!this.calendar) {
      throw new Error('Google Calendar client not initialized');
    }
    
    try {
      const eligibility = this.checkBookingEligibility(duration, qualificationScore);
      
      // If requesting 60-min but not qualified, return empty slots with explanation
      if (duration === 60 && !eligibility.can_book_60min) {
        return {
          available_slots: [],
          qualification_status: {
            score: qualificationScore,
            qualified_for_60min: false,
            reason: eligibility.reason
          },
          business_hours: '9 AM - 5 PM ET, Monday-Friday'
        };
      }
      
      // Query calendar for busy times
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          items: [{ id: process.env.GOOGLE_CALENDAR_ID || 'primary' }],
          timeZone: this.getTimezone()
        }
      });
      
      const busyTimes = response.data.calendars?.[process.env.GOOGLE_CALENDAR_ID || 'primary']?.busy || [];
      
      // Generate available slots
      const availableSlots = this.generateTimeSlots(startDate, endDate, duration, busyTimes);
      
      return {
        available_slots: availableSlots,
        qualification_status: {
          score: qualificationScore,
          qualified_for_60min: eligibility.can_book_60min,
          reason: eligibility.reason
        },
        business_hours: '9 AM - 5 PM ET, Monday-Friday',
        next_available: availableSlots.length > 0 ? availableSlots[0].start : undefined
      };
      
    } catch (error) {
      console.error('Error checking calendar availability:', error);
      throw new Error('Failed to check calendar availability');
    }
  }
  
  async createEvent(eventDetails: EventDetails) {
    if (!this.calendar) {
      throw new Error('Google Calendar client not initialized');
    }
    
    try {
      // Validate booking eligibility
      const eligibility = this.checkBookingEligibility(eventDetails.duration, eventDetails.qualificationScore);
      
      if (eventDetails.duration === 60 && !eligibility.can_book_60min) {
        throw new Error(`INSUFFICIENT_QUALIFICATION: ${eligibility.reason}`);
      }
      
      // Create event description
      let description = `Meeting with ${eventDetails.attendeeName}`;
      if (eventDetails.company) {
        description += ` from ${eventDetails.company}`;
      }
      description += `\nDuration: ${eventDetails.duration} minutes`;
      if (eventDetails.purpose) {
        description += `\nPurpose: ${eventDetails.purpose}`;
      }
      description += `\nContact: ${eventDetails.attendeeEmail}`;
      
      if (eventDetails.duration === 60 && eventDetails.qualificationScore) {
        description += `\n\nQUALIFIED OPPORTUNITY`;
        description += `\nQualification Score: ${eventDetails.qualificationScore}/10`;
        
        if (eventDetails.conversationSummary) {
          description += `\n\nConversation Summary:\n${eventDetails.conversationSummary}`;
        }
      } else if (eventDetails.duration === 30) {
        description += `\n\nThis is an initial conversation.`;
      }
      
      // Create calendar event
      const event = {
        summary: eventDetails.summary,
        description: description,
        start: {
          dateTime: eventDetails.startDateTime.toISOString(),
          timeZone: this.getTimezone()
        },
        end: {
          dateTime: eventDetails.endDateTime.toISOString(),
          timeZone: this.getTimezone()
        },
        attendees: [
          { email: eventDetails.attendeeEmail, displayName: eventDetails.attendeeName }
        ],
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours
            { method: 'popup', minutes: 15 }       // 15 minutes
          ]
        }
      };
      
      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        requestBody: event,
        conferenceDataVersion: 1,
        sendNotifications: true
      });
      
      return {
        eventId: response.data.id,
        calendarLink: response.data.htmlLink,
        meetLink: response.data.conferenceData?.entryPoints?.[0]?.uri,
        status: response.data.status
      };
      
    } catch (error) {
      console.error('Error creating calendar event:', error);
      if (error.message?.includes('INSUFFICIENT_QUALIFICATION')) {
        throw error;
      }
      throw new Error('Failed to create calendar event');
    }
  }
  
  async updateEvent(eventId: string, updates: Partial<EventDetails>) {
    if (!this.calendar) {
      throw new Error('Google Calendar client not initialized');
    }
    
    try {
      const response = await this.calendar.events.patch({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        eventId: eventId,
        requestBody: updates
      });
      
      return response.data;
    } catch (error) {
      console.error('Error updating calendar event:', error);
      throw new Error('Failed to update calendar event');
    }
  }
  
  async deleteEvent(eventId: string) {
    if (!this.calendar) {
      throw new Error('Google Calendar client not initialized');
    }
    
    try {
      await this.calendar.events.delete({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        eventId: eventId
      });
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw new Error('Failed to delete calendar event');
    }
  }
}

export const calendarService = new GoogleCalendarService();

// Function calling interface for OpenAI integration
export const googleCalendar = {
  async checkAvailability(params: {
    preferredDates?: string[];
    timePreferences?: string;
    timezone?: string;
    duration?: number;
  }) {
    try {
      const startDate = new Date();
      const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 2 weeks from now
      
      const duration = (params.duration === 60 ? 60 : 30) as 30 | 60;
      const availability = await calendarService.getAvailability(startDate, endDate, duration);
      
      if (availability.available_slots.length > 0) {
        const suggestions = availability.available_slots
          .slice(0, 5)
          .map(slot => new Date(slot.start).toLocaleString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: params.timezone || 'America/New_York'
          }));
        
        return {
          available: true,
          suggestions,
          businessHours: availability.business_hours,
          nextAvailable: availability.next_available
        };
      } else {
        return {
          available: false,
          suggestions: [],
          businessHours: availability.business_hours,
          message: 'Limited availability - calendar link recommended'
        };
      }
    } catch (error) {
      console.error('Calendar availability check failed:', error);
      return {
        available: false,
        suggestions: [],
        error: 'Unable to check calendar at this time'
      };
    }
  },

  async createMeeting(params: {
    attendeeName: string;
    attendeeEmail: string;
    startTime: string;
    duration: number;
    company?: string;
    purpose?: string;
    qualificationScore?: number;
  }) {
    try {
      const startDateTime = new Date(params.startTime);
      const endDateTime = new Date(startDateTime.getTime() + params.duration * 60 * 1000);
      
      const eventDetails: EventDetails = {
        summary: `Meeting with ${params.attendeeName}${params.company ? ` (${params.company})` : ''}`,
        description: params.purpose || 'Strategic discussion',
        startDateTime,
        endDateTime,
        attendeeEmail: params.attendeeEmail,
        attendeeName: params.attendeeName,
        duration: (params.duration === 60 ? 60 : 30) as 30 | 60,
        qualificationScore: params.qualificationScore,
        company: params.company,
        purpose: params.purpose
      };
      
      const result = await calendarService.createEvent(eventDetails);
      return {
        success: true,
        eventId: result.eventId,
        calendarLink: result.calendarLink,
        meetLink: result.meetLink
      };
    } catch (error) {
      console.error('Meeting creation failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to create meeting'
      };
    }
  }
};