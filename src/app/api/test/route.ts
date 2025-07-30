import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    // Check environment
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    
    // Check data directory
    const dataDir = path.join(process.cwd(), 'data');
    let dataFiles = [];
    try {
      dataFiles = await fs.readdir(dataDir);
    } catch (e) {
      dataFiles = ['ERROR: data directory not found'];
    }

    return NextResponse.json({
      hasOpenAI,
      dataFiles,
      nodeEnv: process.env.NODE_ENV,
      pwd: process.cwd()
    });
  } catch (error) {
    return NextResponse.json({ error: error.message });
  }
}
