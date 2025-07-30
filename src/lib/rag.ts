import fs from 'fs/promises';
import path from 'path';
import csv from 'csv-parser';
import { createReadStream } from 'fs';

interface RAGData {
  systemPrompt: string;
  cv: string;
  goals: string;
  resumes: Array<{
    title: string;
    summary: string;
    content: string;
  }>;
}

export async function loadRAGData(): Promise<RAGData> {
  const dataDir = path.join(process.cwd(), 'data');

  try {
    // Load system prompt
    const systemPrompt = await fs.readFile(
      path.join(dataDir, 'system-prompt.md'), 
      'utf8'
    );

    // Load goals
    const goals = await fs.readFile(
      path.join(dataDir, 'goals.md'), 
      'utf8'
    );

    // Load CV data
    const cv = await loadCSVData(path.join(dataDir, 'cv.csv'));

    // Load resume variants
    const resumes = await loadResumeVariants(dataDir);

    return {
      systemPrompt,
      cv,
      goals,
      resumes,
    };

  } catch (error) {
    console.error('Error loading RAG data:', error);
    throw new Error('Failed to load RAG data');
  }
}

async function loadCSVData(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const results: any[] = [];
    
    createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        // Convert CSV to readable format
        const formatted = results.map(row => {
          return Object.entries(row)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        }).join('\n');
        
        resolve(`CV DATA:\n${formatted}`);
      })
      .on('error', reject);
  });
}

async function loadResumeVariants(dataDir: string): Promise<Array<{title: string, summary: string, content: string}>> {
  const resumesDir = path.join(dataDir, 'resumes');
  
  try {
    const files = await fs.readdir(resumesDir);
    const resumes = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await fs.readFile(path.join(resumesDir, file), 'utf8');
        const title = file.replace('.md', '').replace(/-/g, ' ');
        
        // Extract first paragraph as summary
        const lines = content.split('\n').filter(line => line.trim());
        const summary = lines[0] || 'Resume variant';

        resumes.push({
          title,
          summary,
          content,
        });
      }
    }

    return resumes;
    
  } catch (error) {
    console.warn('No resume variants found, using empty array');
    return [];
  }
}

// Simple vector search function (for future enhancement)
export function searchRAGData(query: string, ragData: RAGData): string[] {
  const searchTerms = query.toLowerCase().split(' ');
  const allContent = [
    ragData.cv,
    ragData.goals,
    ...ragData.resumes.map(r => r.content)
  ];

  return allContent.filter(content => 
    searchTerms.some(term => 
      content.toLowerCase().includes(term)
    )
  );
}
