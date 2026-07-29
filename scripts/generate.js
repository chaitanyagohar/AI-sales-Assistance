require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Using the highly stable older SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateMessages() {
  console.log("🧠 Waking up AI Assistant...");

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'Enriched - Ready');

  if (error || !leads || leads.length === 0) {
    console.log("No enriched leads found needing a message.");
    return;
  }

const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

  for (const lead of leads) {
    console.log(`\n✍️ Drafting email for: ${lead.name}`);
    
    const prompt = `
      You are the founder of Oddlambda, a software and web development agency. 
      Write a short, highly converting cold email to a prospective client.
      
      Client Details:
      - Name: ${lead.name}
      - Industry: ${lead.category}
      - Phone: ${lead.phone || 'Unknown'}
      - Email: ${lead.email}
      
      Your Goal: Pitch Oddlambda's services. Focus heavily on our expertise in building end-to-end digital marketing pipelines, highly optimized conversion funnels, and custom landing pages specifically engineered for real estate projects, channel partners, and corporate agencies. Mention how automation can streamline their CRM.
      
      Rules:
      - Keep it under 150 words.
      - Tone: Professional, candid, and peer-to-peer (founder to founder). No robotic buzzwords.
      - Do not send links.
      - End with a low-friction call to action (e.g., asking if they are open to a 5-minute chat).
      - Output ONLY the email subject line and body. No pleasantries before or after.
      
      Format:
      Subject: [Your Subject]
      
      Hi [Name or Team],
      [Body]
    `;

    try {
      const result = await model.generateContent(prompt);
      const generatedMessage = result.response.text();
      
      console.log("✅ Message drafted successfully!");

      await supabase
        .from('leads')
        .update({ 
          message_body: generatedMessage,
          status: 'Message Drafted',
          send_status: 'Pending Review'
        })
        .eq('id', lead.id);

      // Brief pause to respect API rate limits
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.log(`⚠️ Failed to generate message for ${lead.name}: ${err.message}`);
    }
  }
}

generateMessages();