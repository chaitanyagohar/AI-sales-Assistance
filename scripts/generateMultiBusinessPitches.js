require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateMultiBusinessPitches() {
  console.log("🧠 Waking up Oddlambda AI Assistant (Multi-Business Mode)...");

  // Only pull from the new table
  const { data: leads, error } = await supabase
    .from('multi_business_leads')
    .select('*')
    .eq('status', 'Enriched - Ready');

  if (error || !leads || leads.length === 0) {
    console.log("No enriched multi-business leads found needing a message.");
    return;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  for (const lead of leads) {
    console.log(`\n✍️ Drafting outreach assets for: ${lead.business_name} | Has Website: ${lead.website_available}`);
    
    // DYNAMIC PITCH LOGIC: 
    // If they have no website, sell the build. If they have one, sell the upgrade/funnel.
    const pitchAngle = lead.website_available 
      ? `They already have a website. Pitch a performance upgrade, conversion funnel optimization, and modernizing their tech stack (Next.js/React) so they stop losing customers to slow load times.`
      : `They DO NOT have a website. This is an urgent missed opportunity. Pitch building their first lightning-fast, highly-optimized website to capture local search traffic in ${lead.city} and establish trust.`;

    const prompt = `
      You are Chaitanya Gohar, founder of Oddlambda, a digital marketing and web development agency.
      Write two distinct outreach pitches for this prospective local business client.
      
      Client Details:
      - Business Name: ${lead.business_name}
      - Category: ${lead.category}
      - City: ${lead.city}
      
      Your Goal: Generate an email and a WhatsApp message based exactly on this angle:
      ANGLE: ${pitchAngle}
      
      EMAIL FRAMEWORK (Keep under 100 words, no fluff, peer-to-peer tone):
      Subject: Digital setup for ${lead.business_name}
      Body: Mention you are looking at local ${lead.category} businesses in ${lead.city}. Execute the ANGLE described above. End with a low-friction question asking if they are open to a quick chat. 
      Sign off as:
      Best,
      Chaitanya Gohar
      Founder, Oddlambda
      
      WHATSAPP FRAMEWORK (Max 2 sentences, casual, direct):
      Execute the ANGLE described above in one or two short sentences. Ask a direct question. No sign-offs.
      
      Return your response strictly as a JSON object with two keys:
      1. "email": The personalized email.
      2. "whatsapp": The personalized WhatsApp text.
    `;

    try {
      const result = await model.generateContent(prompt);
      const textResponse = result.response.text();
      
      const cleanJsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanJsonStr);
      
      console.log("✅ Message assets drafted successfully!");

      // Update the correct independent table
      await supabase
        .from('multi_business_leads')
        .update({ 
          message_body: parsedData.email,
          whatsapp_message: parsedData.whatsapp,
          status: 'Message Drafted'
        })
        .eq('id', lead.id);

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.log(`⚠️ Failed to generate message for ${lead.business_name}: ${err.message}`);
    }
  }
}

generateMultiBusinessPitches();