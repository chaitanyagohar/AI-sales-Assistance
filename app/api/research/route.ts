// app/api/research/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { id, url } = await req.json();

    if (!id || !url) {
      return NextResponse.json({ success: false, error: "Missing ID or URL" });
    }

    // 1. Fetch website HTML safely
    let html = "";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout
      const siteRes = await fetch(url, { 
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      clearTimeout(timeoutId);
      
      if (!siteRes.ok) throw new Error(`HTTP ${siteRes.status}`);
      html = await siteRes.text();
    } catch (err: any) {
      // If website blocks us or times out, save a failed state without breaking the lead
      const failedResearch = { status: "failed", error: `Website unreachable: ${err.message}` };
      await supabase.from('multi_business_leads').update({ ai_research: failedResearch }).eq('id', id);
      return NextResponse.json({ success: true, research: failedResearch });
    }

    // 2. Extract Lightweight Metadata (Cost Control)
    // We use basic regex to avoid heavy DOM parsing libraries
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "No Title";
    
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const description = descMatch ? descMatch[1].trim() : "No Description";
    
    const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    
    const cleanText = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
                          .replace(/<[^>]+>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .substring(0, 3000); // Limit to 3000 chars for token savings

    // 3. AI Analysis Call (Google Gemini)
    const systemPrompt = `You are a web development lead qualification AI. Analyze the provided website metadata and determine if the business is a good prospect for web development services. 
    
DO NOT MAKE UNVERIFIED CLAIMS. Only use observable evidence.
Determine the Opportunity Score (0-100) and Confidence Score (0-100).
Classify into ONE of these: NO_WEBSITE_SOCIAL_ACTIVE, WEBSITE_OUTDATED, WEBSITE_BASIC_TEMPLATE, WEBSITE_AI_OR_GENERATED_STYLE, WEBSITE_NEEDS_CONVERSION_IMPROVEMENT, WEBSITE_STRONG.
Recommend outreach: NO_WEBSITE, WEBSITE_REDESIGN, WEBSITE_UPGRADE, SOCIAL_TO_WEBSITE, LOW_CONVERSION_WEBSITE, NO_OUTREACH.

Return ONLY a valid JSON object matching this schema:
{
  "status": "completed",
  "classification": "STRING",
  "opportunityScore": NUMBER,
  "confidenceScore": NUMBER,
  "evidence": ["Array of short factual observation strings"],
  "summary": "Short 2-3 sentence summary of the opportunity",
  "personalizationInsight": "A single conversational sentence to use in an email noticing their digital state",
  "recommendedOutreachType": "STRING"
}`;

    const userContent = `Website URL: ${url}\nTitle: ${title}\nDescription: ${description}\nH1s: ${h1Matches.join(" | ")}\nVisible Text Snippet: ${cleanText}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable. Check your .env.local file.");
    }

    // Call Gemini 1.5 Flash REST API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    
    const aiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          parts: [{ text: userContent }]
        }],
        generationConfig: {
          response_mime_type: "application/json" // Forces Gemini to return valid JSON
        }
      })
    });

    if (!aiRes.ok) {
      const errorText = await aiRes.text();
      console.error("❌ GEMINI API ERROR DETAILS:", errorText);
      throw new Error(`Gemini API Rejected Request (Status: ${aiRes.status})`);
    }

    const aiData = await aiRes.json();
    
    // Safely extract the text response from the Gemini payload
    const responseText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error("Received empty or malformed response from Gemini");
    }

    const researchResult = JSON.parse(responseText);

    // 4. Update Database
    const { error: dbError } = await supabase
      .from('multi_business_leads')
      .update({ ai_research: researchResult })
      .eq('id', id);

    if (dbError) throw dbError;

    return NextResponse.json({ success: true, research: researchResult });

  } catch (error: any) {
    console.error("Research Error:", error);
    // Returning the exact message to the frontend so you don't get generic errors
    return NextResponse.json({ success: false, error: error.message });
  }
}