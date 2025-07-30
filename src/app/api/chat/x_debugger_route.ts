import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Step 1: Check request parsing
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ 
        error: "Failed to parse request JSON", 
        details: e.message 
      }, { status: 400 });
    }

    // Step 2: Check environment variables
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ 
        error: "OPENAI_API_KEY environment variable missing",
        available_env: Object.keys(process.env).filter(k => k.includes('OPENAI')),
        all_env_keys: Object.keys(process.env).slice(0, 10) // First 10 keys
      }, { status: 500 });
    }

    // Step 3: Check OpenAI import
    let OpenAI;
    try {
      const openaiModule = await import('openai');
      OpenAI = openaiModule.default;
    } catch (e) {
      return NextResponse.json({ 
        error: "Failed to import OpenAI", 
        details: e.message 
      }, { status: 500 });
    }

    // Step 4: Check OpenAI initialization
    let openai;
    try {
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } catch (e) {
      return NextResponse.json({ 
        error: "Failed to initialize OpenAI", 
        details: e.message,
        key_length: process.env.OPENAI_API_KEY?.length || 0
      }, { status: 500 });
    }

    // Step 5: Check file system access
    let fs, path;
    try {
      fs = await import('fs/promises');
      path = await import('path');
    } catch (e) {
      return NextResponse.json({ 
        error: "Failed to import filesystem modules", 
        details: e.message 
      }, { status: 500 });
    }

    // Step 6: Check data directory
    const dataDir = path.join(process.cwd(), 'data');
    let files;
    try {
      files = await fs.readdir(dataDir);
    } catch (e) {
      return NextResponse.json({ 
        error: "Cannot read data directory", 
        details: e.message,
        attempted_path: dataDir,
        cwd: process.cwd()
      }, { status: 500 });
    }

    // Step 7: Try to load a data file
    try {
      const testFile = await fs.readFile(path.join(dataDir, 'gabi-personality.md'), 'utf8');
      const fileSize = testFile.length;
      
      return NextResponse.json({
        success: true,
        message: "All checks passed!",
        data: {
          openai_key_length: process.env.OPENAI_API_KEY.substring(0, 10) + "...",
          data_files: files,
          test_file_size: fileSize,
          messages_received: body.messages?.length || 0
        }
      });
      
    } catch (e) {
      return NextResponse.json({ 
        error: "Cannot read gabi-personality.md", 
        details: e.message,
        available_files: files,
        attempted_file: path.join(dataDir, 'gabi-personality.md')
      }, { status: 500 });
    }

  } catch (error) {
    return NextResponse.json({ 
      error: "Unexpected error in route handler", 
      details: error.message,
      stack: error.stack,
      name: error.name
    }, { status: 500 });
  }
}
