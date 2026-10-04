import { NextResponse } from 'next/server';
import { exec } from 'child_process';

export async function POST(request: Request) {
  try {
    const { category, city, customSearch } = await request.json();

    if (!category || !city) {
      return NextResponse.json({ success: false, error: 'Category and City are required' }, { status: 400 });
    }

    // Construct the terminal command to run your script
    const cmd = `node scripts/multiBusinessScraper.js "${category}" "${city}" "${customSearch || ''}"`;
    
    console.log(`Starting background process: ${cmd}`);

    // Execute the scraper in the background (asynchronously)
    // We do not await this, so the API responds instantly without timing out.
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Scraper Error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`⚠️ Scraper Stderr: ${stderr}`);
      }
      console.log(`✅ Scraper Output:\n${stdout}`);
    });

    return NextResponse.json({ 
      success: true, 
      message: `Scraper launched for ${category} in ${city}. Check your VS Code terminal for live logs!` 
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}