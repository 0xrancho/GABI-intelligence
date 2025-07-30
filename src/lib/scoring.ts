// scoring.ts - Pure reference document for LLM scoring
// No calculation logic - just criteria and context

export interface FitScore {
  strategic: number;
  technical: number;
  scale: number;
  domain: number;
  impact: number;
  compensation: number;
  workEnvironment: number;
  engagementType: number;
  cultural: number;
  growth: number;
  aggregate: number;
  dealbreakers: string[];
  recommendation: 'schedule' | 'email' | 'redirect';
  reasoning: {
    strategic: string;
    technical: string;
    scale: string;
    domain: string;
    impact: string;
    compensation: string;
    workEnvironment: string;
    engagementType: string;
    cultural: string;
    growth: string;
  };
}

export const joelProfile = {
  currentPositioning: "GTM Product Strategy • AI Sales Enablement • Cross-Functional Innovation",
  
  coreExpertise: {
    strategic: [
      // Joel's proven strategic outcomes
      'gtm product strategy', 'ai sales enablement', 'cross-functional innovation',
      'revenue operations', 'revenue ops', 'revops', 'gtm', 'go-to-market', 
      'sales enablement', 'product strategy', 'ai workflow', 'ai enablement',
      'digital transformation', 'strategic technology', 'strategic initiatives',
      'crm optimization', 'salesforce', 'automation', 'process optimization',
      'data-driven decisioning', 'zero-to-one execution', 'workflow optimization',
      // Proven outcomes from resume
      'qualification rates', 'conversion improvement', 'operating margin',
      'pre-sales cycle', 'sales velocity', 'pipeline growth', 'churn modeling'
    ],
    adjacent: [
      'product management', 'business development', 'customer success',
      'data strategy', 'workflow automation', 'system integration',
      'change management', 'stakeholder alignment', 'rapid prototyping',
      'user onboarding', 'lead enrichment', 'objection handling',
      'partnership performance', 'field sales strategy'
    ],
    transferable: [
      'project management', 'business analysis', 'process improvement',
      'marketing operations', 'data analysis', 'consulting', 'business turnaround',
      'operational efficiency', 'systems thinking', 'franchise operations'
    ]
  },

  technicalStack: {
    current: [
      // 2025 active tech stack
      'salesforce', 'crm', 'python', 'sql', 'openai', 'gpt', 'llm', 'rag',
      'automation', 'workflow automation', 'api integration', 'database',
      'business intelligence', 'data analysis', 'reporting', 'dashboards',
      'ai tools', 'machine learning', 'generative ai', 'chatgpt',
      'rag-based tools', 'customer data analysis', 'ai prototypes', 'sms tools'
    ],
    adjacent: [
      'hubspot', 'javascript', 'analytics platforms', 'cloud platforms',
      'saas platforms', 'integration platforms', 'cpq systems',
      'business process automation', 'data pipeline', 'databricks',
      'lead enrichment tools', 'proposal generation', 'demo tools'
    ],
    learning: [
      // Currently learning (Databricks cert in progress)
      'react', 'node', 'aws', 'advanced ml', 'data science',
      'typescript', 'cloud infrastructure', 'devops', 'databricks platform'
    ]
  }
};

export const scoringCriteria = {
  compensation: {
    w2Salary: {
      range: [110000, 250000],
      lowerEnd: {
        threshold: 130000,
        expectation: "Strategy and thought leadership focus, less managerial/delivery ownership",
        example: "Director of Innovation at nonprofit - thought leadership heavy"
      },
      higherEnd: {
        threshold: 180000,
        expectation: "Delivery ownership + OTE/equity at growth companies",
        includes: "Revenue share, equity, startup growth potential"
      }
    },
    hourlyRate: {
      minimum: 80, // 30% premium over W2 equivalent for SE tax + no benefits
      reasoning: "$60/hr = $100k FTE, but hourly lacks benefits and requires SE tax",
      preferred: 100
    },
    projectWork: {
      idealRange: [7500, 25000],
      focus: "1-2 growth indicators only",
      planning: "End-to-end automation roadmaps with GABI framework",
      constraints: {
        yes: ["lightweight RAG processes", "self-managed embedding", "open source LLMs", "llama/openai/claude", "librechat", "custom dev chat", "n8n"],
        no: ["saas solutions like box.com", "lindi.ai", "vendor lock-in"],
        principle: "Clients retain their own data"
      }
    }
  },

  workEnvironment: {
    location: {
      priority1: "Indianapolis businesses - strong preference for serving local market",
      acceptable: "Remote work for any geography",
      travel: "International consulting welcome - experienced world traveler, 4 continents, global events",
      constraint: "Home base must remain Indianapolis, Indiana, USA - family of 7 (5 children)"
    },
    decisionMaking: {
      preferred: "3-person buying committee maximum",
      structure: "1 senior leader + 1 line manager + 1 user",
      rejection: "9-12 month Salesforce implementation sales cycles - NO LONGER INTERESTED"
    }
  },

  engagementType: {
    w2Employment: "Full-time roles with strategic + delivery components",
    contract: "Project-based with clear scope and timeline",
    consulting: "International travel acceptable, growth-focused outcomes",
    fractional: "Part-time strategic advisory acceptable",
    
    timeline: "Flexible start dates - bot triages both immediate and future opportunities"
  },

  cultural: {
    processComplexity: {
      preference: "Deep, complex processes where big impact is possible",
      requirement: "Must be open to system disruption and innovation",
      tension: "Innovation vs process - need balance"
    },
    decisionSpeed: "Quick decision making strongly preferred",
    salesCycle: {
      reject: "9-12 month enterprise sales cycles",
      prefer: "Rapid evaluation and decision processes"
    },
    missionAlignment: {
      high: [
        "Praxis community",
        "Faith-based entrepreneurship (FDE/FDI)",
        "Christian capital formation groups",
        "Family offices with portfolio companies",
        "Mission-driven organizations"
      ],
      general: "Growth-stage B2B companies with clear impact metrics"
    }
  },

  scale: {
    sweetSpot: "Growth-stage companies (Series B-C, scaling phase)",
    acceptable: {
      startup: "Early stage with clear product-market fit",
      enterprise: "If role focuses on innovation/transformation vs maintenance"
    },
    indicators: {
      growth: ["expanding", "scaling", "series c", "revenue growth"],
      startup: ["early stage", "series a", "series b", "scale-up"],
      enterprise: ["transformation", "innovation labs", "new initiatives"]
    }
  },

  domain: {
    core: {
      saas: 10, // Strongest domain expertise
      b2b: 10,
      education: 9, // Mission-driven work (Early Learning Indiana, CCA applications)
      tech: 9 // Current AI/automation focus
    },
    adjacent: {
      logistics: 7, // Previous business experience
      fintech: 6, // Some experience
      healthcare: 6 // Limited but has worked with regulatory/pharma
    },
    growth: [
      "AI/automation implementation",
      "International business expansion", 
      "GTM operations at scale",
      "Revenue architecture consulting"
    ]
  },

  impact: {
    provenOutcomes: [
      // From resume - highest weight for demonstrated capabilities
      'qualification rates improvement', 'conversion optimization', 'operating margin growth',
      'sales velocity increases', 'pipeline growth', 'cycle time reduction',
      'automation savings', 'operational scale', 'efficiency gains'
    ],
    strategicLevel: [
      'strategic initiatives', 'cross-functional leadership', 'zero-to-one execution',
      'innovation programs', 'enablement systems', 'stakeholder alignment',
      'digital transformation', 'roadmap development'
    ],
    quantifiableMetrics: [
      'revenue impact', 'growth metrics', 'performance improvement', 'roi',
      'productivity gains', 'cost reduction', 'time savings', 'margin improvement'
    ],
    leadershipLevel: [
      'director', 'head of', 'vp', 'chief', 'founder', 'ceo',
      'strategy', 'team leadership', 'ownership', 'program management'
    ]
  },

  dealbreakers: [
    "Extended travel requirements (>25% travel for W2 roles)",
    "Relocation requirements outside Indianapolis",
    "PhD or advanced degree requirements", 
    "Security clearance requirements",
    "Heavily regulated industries with slow decision making",
    "Pure research roles without business application",
    "Maintenance-focused roles without innovation component",
    "9+ month sales cycles or procurement processes",
    "Vendor-locked solutions that don't allow client data ownership",
    "Roles requiring physical presence for daily operations"
  ]
};

// Helper function to provide context about Joel's experience progression
export const experienceContext = {
  currentFocus: "AI-powered GTM operations and workflow automation",
  careerProgression: "Lead → Director → CEO → Strategic Consultant",
  provenOutcomes: {
    salesEfficiency: "Improved qualification rates and conversion metrics",
    operationalScale: "Built systems for operational margin growth",
    aiImplementation: "Delivered RAG-based tools and customer data analysis",
    crossFunctional: "Led zero-to-one execution across multiple stakeholders"
  },
  geographicExperience: "4 continents, global events, international client implementation",
  industryBreadth: "B2B SaaS, Education, Logistics, Healthcare, Fintech"
};

// Instructions for LLM scoring
export const scoringInstructions = `
Analyze the job/project description against Joel's profile using these steps:

1. DEALBREAKER CHECK: First identify any dealbreakers that would make this unsuitable
2. SEMANTIC ANALYSIS: Understand the actual role requirements beyond keywords
3. DIMENSION SCORING: Score 1-10 for each dimension with detailed reasoning
4. RECOMMENDATION: Based on aggregate score and fit quality

Scoring Scale:
- 9-10: Exceptional fit, core expertise match
- 7-8: Strong fit, adjacent expertise or great learning opportunity  
- 5-6: Moderate fit, transferable skills needed
- 3-4: Weak fit, significant gaps
- 1-2: Poor fit, major misalignment

Recommendation Logic:
- "schedule": Score 7+ with no major dealbreakers, strong mutual fit
- "email": Score 5-7 or good fit needing clarification/customization
- "redirect": Score <5 or major dealbreakers present

Always provide specific reasoning for each dimension score.
`;
