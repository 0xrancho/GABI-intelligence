import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { scoringCriteria, joelProfile } from '@/lib/scoring';
import { RateLimiter } from '@/middleware/rateLimiter';

// Add CORS headers function
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // or 'https://joelaustin.xyz'
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Handle OPTIONS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function loadDocument(filename: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'data', filename);
  return await fs.readFile(filePath, 'utf8');
}

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();
    
    // Validate messages array
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Get the latest user message for rate limiting
    const latestMessage = messages[messages.length - 1];
    const messageText = latestMessage?.content || '';

    // Check rate limits
    const rateLimitResponse = await RateLimiter.checkLimits(
      request, 
      messageText, 
      corsHeaders()
    );
    
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Load reference documents
    const [gabiPersonality, portfolioProofs, fitTemplate] = await Promise.all([
      loadDocument('gabi-personality.md'),
      loadDocument('portfolio-proofs.csv'),
      loadDocument('fit-analysis-template.txt')
    ]);

    // Single conversation mode - GABI decides when to use fit analysis
    const response = await handleConversation(messages, {
      gabiPersonality,
      portfolioProofs,
      fitTemplate
    });

    // Add rate limit headers to successful response
    return RateLimiter.addRateLimitHeaders(response, request, messageText);

  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}

async function handleConversation(
  messages: ConversationMessage[],
  context: { gabiPersonality: string; portfolioProofs: string; fitTemplate: string }
) {
  const systemPrompt = buildUnifiedSystemPrompt(context);
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'fetch_url',
          description: 'Fetch content from a URL to read job descriptions, company pages, or other relevant information',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to fetch content from'
              }
            },
            required: ['url']
          }
        }
      }
    ],
    temperature: 0.7,
    max_tokens: 1200,
  });

  const assistantMessage = response.choices[0]?.message;
  
  // Handle function calls
  if (assistantMessage?.tool_calls) {
    const toolCall = assistantMessage.tool_calls[0];
    
    if (toolCall.function.name === 'fetch_url') {
      const { url } = JSON.parse(toolCall.function.arguments);
      
      try {
        // Fetch the URL content
        const urlResponse = await fetch(url);
        const content = await urlResponse.text();
        
        // Extract text content (basic HTML stripping)
        const textContent = content
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<style[^>]*>.*?<\/style>/gis, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000); // Limit content length
        
        // Continue conversation with fetched content
        const followUpResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
            { 
              role: 'assistant', 
              content: assistantMessage.content,
              tool_calls: assistantMessage.tool_calls 
            },
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Content from ${url}:\n\n${textContent}`
            }
          ],
          temperature: 0.7,
          max_tokens: 1200,
        });
        
        const finalMessage = followUpResponse.choices[0]?.message?.content || 
          "I was able to read the content, but had trouble generating a response.";
          
        return NextResponse.json({ 
          message: finalMessage
        }, { headers: corsHeaders() });
        
      } catch (error) {
        console.error('Error fetching URL:', error);
        return NextResponse.json({ 
          message: "I had trouble accessing that URL. Could you copy and paste the content instead?"
        }, { headers: corsHeaders() });
      }
    }
  }

  const finalMessage = assistantMessage?.content || 
    "Sorry, I had trouble processing that. Can you try again?";

  return NextResponse.json({ 
    message: finalMessage
  }, { headers: corsHeaders() });
}

function buildUnifiedSystemPrompt(context: { gabiPersonality: string; portfolioProofs: string; fitTemplate: string }): string {
  return `${context.gabiPersonality}

## Joel's Complete Portfolio
${context.portfolioProofs}

## Joel's Profile & Scoring Criteria
${JSON.stringify(joelProfile, null, 2)}

${JSON.stringify(scoringCriteria, null, 2)}

## Fit Analysis Template
When someone shares a specific job description, role details, or project requirements, automatically provide a structured fit analysis using this template:

${context.fitTemplate}

## STEP-BY-STEP ANALYSIS PROCESS

### STEP 1: Extract Role Requirements
From the conversation, identify:
- Role title and company
- Key responsibilities 
- Required technologies/skills
- Compensation range (if mentioned)
- Timeline and work arrangement

### STEP 2: Match Portfolio Projects
Review Joel's portfolio and identify 2-3 most relevant projects that match:
- Similar technologies
- Comparable business outcomes
- Relevant domain/industry
- Similar role scope

### STEP 3: Calculate Numerical Scores (1-10 scale)

**Strategic Alignment (1-10):**
- 9-10: Perfect match for Joel's GTM/AI/RevOps expertise
- 7-8: Strong match with some relevant experience
- 5-6: Moderate fit, transferable skills
- 3-4: Weak alignment
- 1-2: Poor fit

**Technical Match (1-10):**
- 9-10: Uses Joel's current tech stack (Salesforce, Python, AI tools)
- 7-8: Adjacent technologies Joel has worked with
- 5-6: Technologies Joel could learn quickly
- 3-4: Significant technical gap
- 1-2: Completely different tech stack

**Scale & Growth (1-10):**
- 10: Growth-stage B2B SaaS (Joel's sweet spot)
- 9: Early-stage with clear product-market fit
- 7-8: Enterprise with innovation focus
- 5-6: Established company, unclear stage
- 3-4: Very early or very large/bureaucratic
- 1-2: Wrong scale entirely

**Domain Expertise (1-10):**
- 10: B2B SaaS, Education, AI/Tech
- 8-9: Adjacent domains with transferable experience
- 6-7: New domain but relevant skills
- 4-5: Limited domain overlap
- 1-3: No relevant domain experience

**Impact Potential (1-10):**
- 9-10: Clear measurable outcomes possible, matches Joel's proven impact areas
- 7-8: Good potential for quantifiable results
- 5-6: Some impact potential, may need clarification
- 3-4: Limited impact measurement
- 1-2: Unclear or maintenance-focused role

**Work Environment (1-10):**
- 10: Remote, Indianapolis priority, quick decisions, innovation culture
- 8-9: Remote with good culture fit
- 6-7: Remote but some concerns (slow decisions, etc.)
- 4-5: Some work environment issues
- 1-3: Major dealbreakers (relocation, etc.)

### STEP 4: Make Recommendation
- **SCHEDULE (7+ overall):** Strong mutual fit, no dealbreakers
- **EMAIL (5-7):** Moderate fit, needs exploration
- **REDIRECT (<5):** Poor fit or dealbreakers present

### STEP 5: Format Using Template
Use the template structure exactly, including numerical scores and specific portfolio project references.

## When to Use Structured Analysis
Use the structured template and scoring process when:
- Someone shares a job description or URL
- They ask about fit for a specific role
- They describe a project and want to know if Joel is a good match
- They mention specific requirements or responsibilities

For general questions about Joel's experience, skills, or background, respond conversationally without the template.

Always be helpful, direct, and reference specific portfolio examples when relevant.`;
} 