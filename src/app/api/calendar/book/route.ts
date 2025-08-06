import { NextRequest, NextResponse } from 'next/server';
import { calendarService } from '@/lib/googleCalendar';

interface BookingRequest {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  datetime: string;
  duration: 30 | 60;
  purpose?: string;
  qualification_score?: number;
  conversation_summary?: string;
  timezone?: string;
}

function validateBookingRequest(body: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    errors.push('Valid name is required');
  }
  
  if (!body.email || typeof body.email !== 'string' || !isValidEmail(body.email)) {
    errors.push('Valid email address is required');
  }
  
  if (!body.datetime || !isValidDatetime(body.datetime)) {
    errors.push('Valid datetime is required (ISO format)');
  }
  
  if (!body.duration || (body.duration !== 30 && body.duration !== 60)) {
    errors.push('Duration must be 30 or 60 minutes');
  }
  
  if (body.qualification_score !== undefined && 
      (typeof body.qualification_score !== 'number' || 
       body.qualification_score < 0 || 
       body.qualification_score > 10)) {
    errors.push('Qualification score must be a number between 0 and 10');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidDatetime(datetime: string): boolean {
  const date = new Date(datetime);
  return !isNaN(date.getTime()) && date > new Date();
}

export async function POST(request: NextRequest) {
  try {
    const body: BookingRequest = await request.json();
    
    // Validate request data
    const validation = validateBookingRequest(body);
    if (!validation.isValid) {
      return NextResponse.json(
        { 
          error: 'VALIDATION_ERROR',
          message: 'Invalid booking request',
          details: validation.errors
        },
        { status: 400 }
      );
    }
    
    // Check qualification for 60-minute meetings
    if (body.duration === 60) {
      const threshold = parseFloat(process.env.QUALIFICATION_THRESHOLD_60MIN || '7.0');
      const score = body.qualification_score || 0;
      
      if (score < threshold) {
        return NextResponse.json(
          {
            success: false,
            error: 'INSUFFICIENT_QUALIFICATION',
            message: `60-minute meetings require qualification score ≥ ${threshold} (current: ${score})`,
            qualification_score: score,
            alternative: {
              duration: 30,
              message: '30-minute meeting available - book to continue qualification'
            }
          },
          { status: 400 }
        );
      }
    }
    
    // Parse datetime and create end time
    const startDateTime = new Date(body.datetime);
    const endDateTime = new Date(startDateTime);
    endDateTime.setMinutes(endDateTime.getMinutes() + body.duration);
    
    // Check if the requested time is in the past
    if (startDateTime < new Date()) {
      return NextResponse.json(
        {
          error: 'INVALID_DATETIME',
          message: 'Cannot book meetings in the past'
        },
        { status: 400 }
      );
    }
    
    // Check availability before booking
    const availability = await calendarService.getAvailability(
      startDateTime,
      endDateTime,
      body.duration,
      body.qualification_score
    );
    
    // Verify the requested slot is available
    const requestedSlot = availability.available_slots.find(slot => 
      new Date(slot.start).getTime() === startDateTime.getTime() &&
      slot.duration === body.duration
    );
    
    if (!requestedSlot) {
      return NextResponse.json(
        {
          error: 'TIME_SLOT_UNAVAILABLE',
          message: 'The requested time slot is not available',
          available_alternatives: availability.available_slots.slice(0, 5)
        },
        { status: 409 }
      );
    }
    
    // Create calendar event
    const eventDetails = {
      summary: `Meeting with ${body.name}${body.company ? ` (${body.company})` : ''}`,
      description: body.purpose || 'Initial conversation',
      startDateTime,
      endDateTime,
      attendeeEmail: body.email,
      attendeeName: body.name,
      duration: body.duration,
      qualificationScore: body.qualification_score,
      conversationSummary: body.conversation_summary,
      company: body.company,
      purpose: body.purpose
    };
    
    const calendarEvent = await calendarService.createEvent(eventDetails);
    
    // Prepare response
    const response = {
      success: true,
      booking_id: calendarEvent.eventId,
      meeting_details: {
        datetime: startDateTime.toISOString(),
        duration: body.duration,
        timezone: body.timezone || 'America/New_York',
        calendar_link: calendarEvent.calendarLink,
        meet_link: calendarEvent.meetLink,
        attendee: {
          name: body.name,
          email: body.email,
          company: body.company
        }
      },
      qualification: body.duration === 60 ? {
        score: body.qualification_score,
        qualified: true,
        message: `60-minute qualified meeting booked successfully (score: ${body.qualification_score})`
      } : {
        score: body.qualification_score,
        message: '30-minute meeting booked successfully'
      }
    };
    
    // Add CORS headers
    const nextResponse = NextResponse.json(response, { status: 201 });
    nextResponse.headers.set('Access-Control-Allow-Origin', '*');
    nextResponse.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    nextResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    return nextResponse;
    
  } catch (error) {
    console.error('Calendar booking error:', error);
    
    // Handle specific error types
    if (error.message?.includes('INSUFFICIENT_QUALIFICATION')) {
      const parts = error.message.split(': ');
      const message = parts.length > 1 ? parts[1] : error.message;
      
      return NextResponse.json(
        {
          success: false,
          error: 'INSUFFICIENT_QUALIFICATION',
          message: message,
          alternative: {
            duration: 30,
            message: '30-minute meeting available'
          }
        },
        { status: 400 }
      );
    }
    
    if (error.message?.includes('Calendar client not initialized')) {
      return NextResponse.json(
        {
          error: 'CALENDAR_CONFIG_ERROR',
          message: 'Calendar service not properly configured'
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      {
        error: 'BOOKING_FAILED',
        message: 'Failed to create calendar booking'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  // Handle CORS preflight
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}