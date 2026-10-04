require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function scrapeGoogleMaps() {
  // 1. Fetch the target city dynamically from Supabase settings
  const { data: settings } = await supabase
    .from('scraping_settings')
    .select('target_city')
    .eq('id', 1)
    .single();

  const city = settings?.target_city || 'Gurgaon';

  // 2. Rotating micro-niche queries tailored to the chosen city
  const queries = [
    `Real Estate Developers in ${city}`,
    `Top Builders in ${city}`,
    `Commercial Property Developers ${city}`,
    `Residential Builders ${city}`,
    `Luxury Real Estate Firms ${city}`
  ];

  // Pick a random query from the array on each engine cycle to bypass duplicate ceilings
  const randomQuery = queries[Math.floor(Math.random() * queries.length)];
  console.log(`🚀 Starting scraper for query: "${randomQuery}"`);

  // --- UPGRADE 1: Optimal 2026 Puppeteer Launch Settings ---
  const browser = await puppeteer.launch({
    headless: 'shell', 
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const encodedQuery = encodeURIComponent(randomQuery);
  const url = `https://www.google.com/maps/search/${encodedQuery}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    console.log("Waiting for listings to load...");
    
    // Wait for feed container
    await page.waitForSelector('div[role="feed"]', { timeout: 10000 }).catch(() => {});

    // Scroll mechanism to bypass lazy load
    console.log("Scrolling to load more leads...");
    await page.evaluate(async () => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return;
      for (let i = 0; i < 5; i++) {
        feed.scrollTop = feed.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    });

    // --- UPGRADE 2: Extract listing names AND scrape phone numbers using Regex ---
    const listings = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div[role="feed"] > div > div[jsaction]'));
      const results = [];

      items.forEach(item => {
        const link = item.querySelector('a[href^="https://www.google.com/maps/place"]');
        if (link) {
          const name = link.getAttribute('aria-label');
          const cardText = item.innerText || "";
          
          // Regex to find standard Indian phone numbers
          const phoneRegex = /(?:(?:\+|0{0,2})91(\s*[-]\s*)?|[0]?)?[6789]\d{9}/;
          const phoneMatch = cardText.match(phoneRegex);
          const rawPhone = phoneMatch ? phoneMatch[0].trim() : null;
          
          if (name) {
            results.push({ 
              name: name, 
              phone: rawPhone 
            });
          }
        }
      });
      return results;
    });

    console.log(`Found ${listings.length} total listings from Maps.`);

    let addedCount = 0;
    for (const lead of listings) {
      // Check if lead already exists to prevent duplicate writes
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('name', lead.name);

      if (existing && existing.length > 0) continue;

      // --- UPGRADE 3: Insert dynamic phone number instead of hardcoded string ---
      const { error } = await supabase.from('leads').insert([{
        name: lead.name,
        category: 'Real Estate Developer',
        status: 'New Lead',
        email: 'Pending Verification',
        phone: lead.phone, // Automatically maps to the scraped number or null
        source: 'Google Maps',
        city: city
      }]);

      if (!error) {
        console.log(`✅ Saved new lead: ${lead.name} | Phone: ${lead.phone || 'None'}`);
        addedCount++;
      }
    }

    console.log(`Finished scraping! Added ${addedCount} net new leads for ${city}.`);

  } catch (err) {
    console.error(`⚠️ Maps scraper error: ${err.message}`);
  }

  await browser.close();
}

scrapeGoogleMaps();