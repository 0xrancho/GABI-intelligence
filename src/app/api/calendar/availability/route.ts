import { NextRequest, NextResponse } from 'next/server';
import { calendarService } from '@/lib/googleCalendar';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const duration = parseInt(searchParams.get('duration') || '30') as 30 | 60;
    const qualificationScore = searchParams.get('qualification_score') 
      ? parseFloat(searchParams.get('qualification_score')!) 
      : undefined;
    const timezone = searchParams.get('timezone') || 'America/New_York';
    const startDateParam = searchParams.get('start_date');
    
    // Validate duration
    if (duration !== 30 && duration !== 60) {
      return NextResponse.json(
        { 
          error: 'INVALID_DURATION',
          message: 'Duration must be 30 or 60 minutes' 
        },
        { status: 400 }
      );
    }
    
    // Set date range (next 2 weeks)
    const startDate = startDateParam ? new Date(startDateParam) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 14);
    
    // Validate start date
    if (startDate < new Date()) {
      startDate.setTime(new Date().getTime());
    }
    
    // Check calendar availability
    const availability = await calendarService.getAvailability(
      startDate,
      endDate,
      duration,
      qualificationScore
    );
    
    // Add CORS headers
    const response = NextResponse.json(availability, { status: 200 });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    return response;
    
  } catch (error) {
    console.error('Calendar availability error:', error);
    
    // Handle specific error types
    if (error.message?.includes('Calendar client not initialized')) {
      return NextResponse.json(
        { 
          error: 'CALENDAR_CONFIG_ERROR',
          message: 'Calendar service not properly configured' 
        },
        { status: 503 }
      );
    }
    
    if (error.message?.includes('INSUFFICIENT_QUALIFICATION')) {
      return NextResponse.json(
        { 
          error: 'INSUFFICIENT_QUALIFICATION',
          message: error.message,
          available_slots: [],
          qualification_status: {
            qualified_for_60min: false,
            reason: error.message
          }
        },
        { status: 200 } // Not an error, just informational
      );
    }
    
    return NextResponse.json(
      { 
        error: 'AVAILABILITY_CHECK_FAILED',
        message: 'Failed to check calendar availability' 
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}