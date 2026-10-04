require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function enrichMultiBusinessLeads() {
  console.log("🔍 Starting Multi-Business Enrichment Engine...");

  // Fetch only leads from the new table that need enrichment
  const { data: leads, error } = await supabase
    .from('multi_business_leads')
    .select('*')
    .eq('status', 'New Lead');

  if (error || !leads || leads.length === 0) {
    console.log("No new multi-business leads found to enrich.");
    return;
  }

  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  for (const lead of leads) {
    console.log(`\n⚙️ Enriching: ${lead.business_name} (${lead.category})`);
    let foundEmail = lead.email;

    // If they have a website, try to scrape the email from it
    if (lead.website_available && lead.website_url && (!foundEmail || foundEmail === 'Pending Verification')) {
      try {
        await page.goto(lead.website_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const html = await page.content();
        
        // Simple regex to hunt for emails on their homepage
        const emailMatch = html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
        if (emailMatch) {
          // Filter out common image extensions that get caught in regex
          const validEmails = emailMatch.filter(e => !e.endsWith('.png') && !e.endsWith('.jpg'));
          if (validEmails.length > 0) {
            foundEmail = validEmails[0].toLowerCase();
            console.log(`📧 Found email via website: ${foundEmail}`);
          }
        }
      } catch (err) {
        console.log(`⚠️ Could not reach website for email extraction.`);
      }
    }

    // Update the multi_business_leads table
    await supabase
      .from('multi_business_leads')
      .update({
        email: foundEmail || 'Not Found',
        status: 'Enriched - Ready'
      })
      .eq('id', lead.id);
  }

  await browser.close();
  console.log("\n✅ Multi-Business Enrichment Complete!");
}

enrichMultiBusinessLeads();