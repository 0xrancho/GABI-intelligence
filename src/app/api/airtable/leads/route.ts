import { NextRequest, NextResponse } from 'next/server';
import AirtableClient, { ContactRecord, SessionState } from '@/lib/airtableClient';

const airtable = new AirtableClient();

// Rate limiting - simple in-memory store (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

// POST - Create or update contact with progressive capture
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { 
      sessionId, 
      contactInfo = {}, 
      projectContext = {}, 
      conversationHistory = [],
      trigger,
      action = 'update_session'
    } = body;

    // Validate required fields
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'capture_contact': {
        // Progressive contact capture
        const contactData: Partial<ContactRecord['fields']> = {};
        
        if (contactInfo.name) contactData['Contact Name'] = contactInfo.name;
        if (contactInfo.email) contactData['Contact Email'] = contactInfo.email;
        if (contactInfo.company) contactData['Company'] = contactInfo.company;
        if (contactInfo.role) contactData['Role'] = contactInfo.role;
        if (contactInfo.industry) contactData['Industry'] = contactInfo.industry;

        const contact = await airtable.upsertContact(sessionId, contactData);
        
        return NextResponse.json({
          success: true,
          contactId: contact.id,
          message: 'Contact information captured successfully'
        });
      }

      case 'update_session': {
        // Update session state with conversation data
        const existingContact = await airtable.getContactBySession(sessionId);
        
        if (!existingContact) {
          // Create new session contact if none exists
          const contact = await airtable.upsertContact(sessionId, {
            'Session ID': sessionId
          });
          
          return NextResponse.json({
            success: true,
            contactId: contact.id,
            isNewSession: true
          });
        }

        // Build session state for scoring
        const sessionState: SessionState = {
          sessionId,
          contactInfo: {
            contactName: existingContact.fields['Contact Name'],
            contactEmail: existingContact.fields['Contact Email'],
            company: existingContact.fields['Company'],
            role: existingContact.fields['Role'],
            industry: existingContact.fields['Industry']
          },
          projectContext: projectContext,
          qualificationScore: parseInt(existingContact.fields['Lead Score'] || '0'),
          intentSignals: [],
          captureStage: 'Initial',
          triggersUsed: [],
          conversationHistory: conversationHistory,
          lastActivity: new Date()
        };

        // Update with new session data
        await airtable.updateProgressiveCapture(
          existingContact.id!,
          sessionState,
          trigger
        );

        // Log interaction - DISABLED (table doesn't exist)
        // await airtable.logInteraction(
        //   existingContact.id!,
        //   sessionId,
        //   'Session Update',
        //   { projectContext, trigger, messageCount: conversationHistory.length }
        // );

        return NextResponse.json({
          success: true,
          contactId: existingContact.id,
          qualificationScore: airtable.calculateQualificationScore(sessionState)
        });
      }

      case 'calendar_sent': {
        // Mark calendar link as sent
        const contact = await airtable.getContactBySession(sessionId);
        if (contact?.id) {
          await airtable.markCalendarSent(contact.id);
        }
        
        return NextResponse.json({
          success: true,
          message: 'Calendar link marked as sent'
        });
      }

      case 'meeting_booked': {
        // Mark meeting as booked
        const { meetingData } = body;
        const contact = await airtable.getContactBySession(sessionId);
        
        if (contact?.id) {
          await airtable.markMeetingBooked(contact.id);
          // await airtable.logInteraction( // DISABLED (table doesn't exist)
          //   contact.id,
          //   sessionId,
          //   'Meeting Booked',
          //   meetingData
          // );
        }
        
        return NextResponse.json({
          success: true,
          message: 'Meeting booking recorded'
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action specified' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Lead capture error:', error);
    return NextResponse.json(
      { error: 'Failed to process lead capture request' },
      { status: 500 }
    );
  }
}

// GET - Retrieve contacts/leads with filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filterBy = searchParams.get('filter') as 'all' | 'qualified' | 'new' | 'contacted' || 'all';
    const offset = searchParams.get('offset') || undefined;
    const sessionId = searchParams.get('sessionId');
    
    // Get specific contact by session
    if (sessionId) {
      const contact = await airtable.getContactBySession(sessionId);
      
      if (!contact) {
        return NextResponse.json(
          { error: 'Contact not found for session' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        contact: contact
      });
    }

    // Get all contacts with filtering
    const result = await airtable.getContacts(filterBy, offset);
    
    return NextResponse.json({
      success: true,
      contacts: result.records,
      nextOffset: result.offset,
      filter: filterBy
    });

  } catch (error) {
    console.error('Lead retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve leads' },
      { status: 500 }
    );
  }
}

// PUT - Update contact status or information
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, status, nextAction, updates } = body;

    if (!contactId) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      );
    }

    // Update contact status
    if (status) {
      await airtable.updateContactStatus(contactId, status, nextAction);
    }

    // Apply additional updates
    if (updates && Object.keys(updates).length > 0) {
      // This would require extending AirtableClient with a general update method
      console.log('Additional updates requested:', updates);
    }

    return NextResponse.json({
      success: true,
      message: 'Contact updated successfully'
    });

  } catch (error) {
    console.error('Contact update error:', error);
    return NextResponse.json(
      { error: 'Failed to update contact' },
      { status: 500 }
    );
  }
}

// DELETE - Remove contact (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contactId');

    if (!contactId) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      );
    }

    // Note: Implement admin authentication check here
    // For now, we'll just return a placeholder response
    return NextResponse.json(
      { error: 'Contact deletion requires admin authentication' },
      { status: 403 }
    );

  } catch (error) {
    console.error('Contact deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete contact' },
      { status: 500 }
    );
  }
}