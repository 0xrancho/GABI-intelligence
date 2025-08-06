# Product Requirements Document - GABI Qualify

## Overview
GABI is Joel Austin's AI qualification agent that engages prospects in natural conversations to assess fit for his AI-enabled GTM sales operations and product strategy consulting services.

## Core Objectives
1. **Natural Qualification**: Assess prospect fit through conversational intelligence
2. **Strategic Lead Capture**: Gather contact and business context organically  
3. **Calendar Integration**: Schedule qualified prospects directly with Joel
4. **CRM Automation**: Save all interactions to Airtable with proper categorization

## User Personas

### Primary: B2B Service Professionals
- **Business Challenge**: Need AI-enabled sales operations or product strategy
- **Pain Points**: Manual processes, unclear GTM strategy, product-market fit issues
- **Success Criteria**: Clear next steps and qualified meeting with Joel

### Secondary: Exploratory Prospects  
- **Business Challenge**: General interest in AI/automation
- **Pain Points**: Information gathering phase
- **Success Criteria**: Helpful resources and potential future engagement

## Core Features

### 1. Conversational Intelligence
- **Natural Flow**: No rigid qualification scripts
- **Context Awareness**: Remembers previous conversation elements
- **Adaptive Response**: Adjusts approach based on prospect engagement level

### 2. Qualification Assessment
- **Contact Information**: Name, email, company, role
- **Business Context**: Challenge, urgency catalyst, desired outcomes
- **Project Scope**: Timeline, budget signals, decision-making authority

### 3. Calendar Integration
- **Real Availability**: Checks Joel's actual Google Calendar
- **Smart Duration**: 30min for initial, 60min for qualified prospects  
- **Automatic Booking**: Creates calendar events with meeting context

### 4. CRM Integration
- **Session Tracking**: All conversations logged to Airtable
- **Lead Scoring**: Automatic qualification scoring and categorization
- **Follow-up Actions**: Clear next steps based on conversation outcome

## Success Metrics
- **Qualification Rate**: % of conversations that identify clear business fit
- **Calendar Conversion**: % of qualified prospects who book meetings
- **CRM Data Quality**: Completeness of captured prospect information
- **User Experience**: Natural conversation flow without obvious "bot" interactions

## Technical Requirements
- **Platform**: Next.js web application with embedded chat widget
- **AI Engine**: OpenAI GPT-4o with function calling
- **Integrations**: Google Calendar API, Airtable API
- **Deployment**: Vercel with environment variable configuration

## Constraints & Assumptions
- **Rate Limits**: OpenAI API limits managed through intelligent caching
- **Calendar Limits**: Google Calendar API quotas respected
- **Data Privacy**: All prospect data handled according to privacy standards
- **Joel's Availability**: Calendar integration reflects real scheduling constraints