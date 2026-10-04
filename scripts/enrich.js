require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Regex patterns to find emails and Indian phone numbers
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+91|91|0)?[ -]*[6-9][0-9]{4}[ -]*[0-9]{5}/g;

// Domains to ignore so we don't accidentally scrape directories
const IGNORED_DOMAINS = ['99acres', 'magicbricks', 'housing.com', 'justdial', 'indiamart', 'linkedin', 'facebook', 'zaubacorp', 'tofler'];

async function enrichLeads() {
  console.log("🚀 Starting the Enrichment Engine...");

  // 1. Fetch leads that need enrichment
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('email', 'Pending Verification') // Or whatever status you used
    .limit(10); // Process 10 at a time to avoid getting blocked

  if (error || !leads || leads.length === 0) {
    console.log("✅ No pending leads found for enrichment.");
    return;
  }

  console.log(`Found ${leads.length} leads to enrich. Booting browser...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  for (const lead of leads) {
    console.log(`\n🔍 Hunting contact info for: ${lead.name} (${lead.city})`);
    
    try {
      // Use DuckDuckGo for searching because Google blocks bots aggressively
      const searchQuery = encodeURIComponent(`${lead.name} real estate developer ${lead.city} official website contact`);
      await page.goto(`https://html.duckduckgo.com/html/?q=${searchQuery}`, { waitUntil: 'domcontentloaded' });
      
      // 2. Extract the best website URL
      const bestUrl = await page.evaluate((ignored) => {
        const links = Array.from(document.querySelectorAll('a.result__url'));
        for (let link of links) {
          const url = link.href.toLowerCase();
          const isIgnored = ignored.some(domain => url.includes(domain));
          if (!isIgnored && url.includes('http')) {
            return link.href; // Return the first official-looking URL
          }
        }
        return null;
      }, IGNORED_DOMAINS);

      if (!bestUrl) {
        console.log(`⚠️ No valid website found for ${lead.name}. Skipping...`);
        await markAsEnriched(lead.id, 'Website Not Found', 'Website Not Found', null);
        continue;
      }

      console.log(`🔗 Found website: ${bestUrl}. Scanning for details...`);

      // 3. Visit their actual website
      await page.goto(bestUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      
      // Extract all text from the website body
      const pageText = await page.evaluate(() => document.body.innerText);

      // 4. Run Regex to find emails and phones
      const emails = [...new Set(pageText.match(EMAIL_REGEX) || [])];
      let phones = [...new Set(pageText.match(PHONE_REGEX) || [])];

      // Clean up phone formatting and filter out generic image sizes/pixels that match the regex
      phones = phones.map(p => p.replace(/\D/g, '')).filter(p => p.length >= 10);

      const finalEmail = emails.length > 0 ? emails[0].toLowerCase() : 'Not Found';
      const finalPhone = phones.length > 0 ? phones[0] : 'Not Found';

      console.log(`   📧 Email: ${finalEmail}`);
      console.log(`   📱 Phone: ${finalPhone}`);

      // 5. Update the Database
      await markAsEnriched(lead.id, finalEmail, finalPhone, bestUrl);

    } catch (err) {
      console.log(`❌ Error enriching ${lead.name}: ${err.message}`);
    }

    // Wait a few seconds between leads to act like a human
    await new Promise(r => setTimeout(r, 4000));
  }

  await browser.close();
  console.log("\n🎉 Enrichment batch complete!");
}

// Helper function to update Supabase
async function markAsEnriched(id, email, phone, website) {
  await supabase
    .from('leads')
    .update({
      email: email,
      phone: phone,
      website: website,
      status: email !== 'Not Found' || phone !== 'Not Found' ? 'Enriched - Ready' : 'Enrichment Failed'
    })
    .eq('id', id);
}

enrichLeads();