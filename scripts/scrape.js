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

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    // Extract listing names
    const listings = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div[role="feed"] > div > div[jsaction]'));
      const results = [];

      items.forEach(item => {
        const link = item.querySelector('a[href^="https://www.google.com/maps/place"]');
        if (link) {
          const name = link.getAttribute('aria-label');
          if (name) results.push(name);
        }
      });
      return results;
    });

    console.log(`Found ${listings.length} total listings from Maps.`);

    let addedCount = 0;
    for (const name of listings) {
      // Check if lead already exists to prevent duplicate writes
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('name', name);

      if (existing && existing.length > 0) continue;

      const { error } = await supabase.from('leads').insert([{
        name: name,
        category: 'Real Estate Developer',
        status: 'New Lead',
        email: 'Pending Verification',
        phone: 'Extracted via Web',
        source: 'Google Maps'
      }]);

      if (!error) {
        console.log(`✅ Saved new lead: ${name}`);
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