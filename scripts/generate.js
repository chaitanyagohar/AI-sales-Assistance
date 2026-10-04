require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateMessages() {
  console.log("🧠 Waking up AI Assistant (Anti-Spam Mode)...");

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'Enriched - Ready');

  if (error || !leads || leads.length === 0) {
    console.log("No enriched leads found needing a message.");
    return;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

  for (const lead of leads) {
    console.log(`\n✍️ Drafting outreach assets for: ${lead.name}`);
    
    // Extract a cleaner name (e.g., removing "LLP" or "Private Limited" for a natural greeting)
    const prompt = `
      You are the founder of Oddlambda, a digital marketing agency.
      Write two distinct outreach pitches for this real estate developer.
      
      Client Details:
      - Company/Name: ${lead.name}
      - City: ${lead.city || 'Bangalore'}
      - Source: ${lead.source || 'RERA portal'}
      
      Your Goal: Generate an email and a WhatsApp message based EXACTLY on the frameworks below. Do not add any extra words, fluff, or promotional spam words.
      
      EMAIL FRAMEWORK (Keep under 100 words):
      Subject: Digital pipeline for ${lead.name}
      
      Hi Team,
      
      I saw your recent project activity on the ${lead.source || 'RERA portal'} and wanted to reach out.
      
      We specialize in building conversion funnels and tracking infrastructure (like custom Meta Pixel and GTM setups) specifically for real estate developers in ${lead.city || 'Bangalore'}. We help agencies and builders streamline their lead generation so they are not relying entirely on third-party directories.
      
      Would a quick teardown of your current setup be useful?
      
      Best,
      Chaitanya Gohar
      Founder, Oddlambda
      
      WHATSAPP FRAMEWORK (Max 2 sentences):
      Hi, saw your latest project updates. We build custom landing pages and Meta Pixel tracking pipelines for real estate developers in ${lead.city || 'Bangalore'}—are you open to upgrading your digital setup for higher conversions?
      
      Return your response strictly as a JSON object with two keys:
      1. "email": The personalized email based on the framework.
      2. "whatsapp": The personalized WhatsApp text based on the framework.
    `;

       try {
      const result = await model.generateContent(prompt);
      const textResponse = result.response.text();

      const cleanJsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanJsonStr);

      console.log("✅ Message assets drafted successfully!");

      await supabase
        .from('leads')
        .update({
          message_body: parsedData.email,
          whatsapp_message: parsedData.whatsapp,
          status: 'Message Drafted',
          send_status: 'Pending Review'
        })
        .eq('id', lead.id);

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {

      // ===== Option 1: Wait and Retry on Rate Limit =====
      if (
        err.message.includes("429") ||
        err.message.includes("Too Many Requests") ||
        err.message.includes("quota")
      ) {
        console.log("⏳ Gemini rate limit reached. Waiting 60 seconds before retrying...");

        await new Promise(r => setTimeout(r, 60000));

        try {
          const result = await model.generateContent(prompt);
          const textResponse = result.response.text();

          const cleanJsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsedData = JSON.parse(cleanJsonStr);

          console.log("✅ Message assets drafted successfully after retry!");

          await supabase
            .from('leads')
            .update({
              message_body: parsedData.email,
              whatsapp_message: parsedData.whatsapp,
              status: 'Message Drafted',
              send_status: 'Pending Review'
            })
            .eq('id', lead.id);

          await new Promise(r => setTimeout(r, 2000));

          continue;

        } catch (retryErr) {
          console.log(`⚠️ Retry failed for ${lead.name}: ${retryErr.message}`);
          continue;
        }
      }

      console.log(`⚠️ Failed to generate message for ${lead.name}: ${err.message}`);
    }
  }
}

generateMessages();