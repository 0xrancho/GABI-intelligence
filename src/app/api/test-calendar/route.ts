import { NextResponse } from 'next/server';
import { calendarService } from '@/lib/googleCalendar';

export async function GET() {
  console.log('🧪 TESTING CALENDAR BOOKING FUNCTION');
  
  // Test with sample data
  const testArgs = {
    start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
    duration: 30,
    attendee_email: 'test@example.com',
    attendee_name: 'Test User',
    company: 'Test Company',
    purpose: 'Test meeting to verify calendar integration'
  };
  
  console.log('📅 Test args:', testArgs);
  
  try {
    // Test calendar service directly
    const startDateTime = new Date(testArgs.start_time);
    const endDateTime = new Date(startDateTime.getTime() + testArgs.duration * 60 * 1000);
    
    const eventDetails = {
      summary: `TEST: ${testArgs.attendee_name} - ${testArgs.company}`,
      description: testArgs.purpose,
      startDateTime,
      endDateTime,
      attendeeEmail: testArgs.attendee_email,
      attendeeName: testArgs.attendee_name,
      duration: testArgs.duration as 30 | 60,
      company: testArgs.company,
      purpose: testArgs.purpose
    };
    
    console.log('📅 Creating test event:', eventDetails);
    const result = await calendarService.createEvent(eventDetails);
    
    console.log('📊 Raw result:', result);
    
    
    return NextResponse.json({
      test: 'Calendar Booking Test',
      timestamp: new Date().toISOString(),
      googleRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
      googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return NextResponse.json({
      test: 'Calendar Booking Test',
      error: error.message,
      stack: error.stack,
      googleRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
      googleCalendarId: process.env.GOOGLE_CALENDAR_ID
    }, { status: 500 });
  }
}

// Also handle POST for testing with custom data
export async function POST(request: Request) {
  const body = await request.json();
  
  console.log('🧪 TESTING CALENDAR WITH CUSTOM DATA:', body);
  
  try {
    const startDateTime = new Date(body.start_time);
    const endDateTime = new Date(startDateTime.getTime() + (body.duration || 30) * 60 * 1000);
    
    const eventDetails = {
      summary: `TEST: ${body.attendee_name} - ${body.company}`,
      description: body.purpose || 'Test event',
      startDateTime,
      endDateTime,
      attendeeEmail: body.attendee_email,
      attendeeName: body.attendee_name,
      duration: (body.duration || 30) as 30 | 60,
      company: body.company,
      purpose: body.purpose || 'Test event'
    };
    
    const result = await calendarService.createEvent(eventDetails);
    
    return NextResponse.json({
      test: 'Calendar Booking Test (Custom)',
      input: body,
      result: result
    });
    
  } catch (error) {
    return NextResponse.json({
      test: 'Calendar Booking Test (Custom)',
      input: body,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}