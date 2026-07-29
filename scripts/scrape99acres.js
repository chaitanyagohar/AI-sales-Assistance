require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function scrape99Acres() {
  // Fetch target city from Supabase settings
  const { data: settings } = await supabase
    .from('scraping_settings')
    .select('target_city')
    .eq('id', 1)
    .single();

  const city = settings?.target_city || 'Gurgaon';
  console.log(`🚀 Starting 99acres Index Scraper for city: "${city}"...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Broader query to capture profiles
  const query = `site:99acres.com "Real Estate Developer" "${city}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const rawListings = await page.evaluate(() => {
      const results = [];
      const blocks = document.querySelectorAll('.result');

      blocks.forEach(block => {
        const titleElem = block.querySelector('.result__title');

        if (titleElem) {
          let name = titleElem.innerText.replace(/Builder|Developer|Projects|99acres\.com|Listing/gi, '').trim();
          name = name.replace(/[-|:]/g, '').trim();

          // Anti-Garbage Filter: Ensure it's not a search engine error message
          const lowerName = name.toLowerCase();
          const isGarbage = lowerName.includes('no results found') || lowerName.includes('check spelling') || lowerName.includes('suggestions');

          if (name && name.length > 3 && !isGarbage) {
            results.push({
              name: name,
              category: 'Real Estate Developer',
              status: 'New Lead',
              email: 'Pending Verification',
              phone: 'Extracted via 99acres',
              source: '99acres'
            });
          }
        }
      });
      return results;
    });

    console.log(`Found ${rawListings.length} valid listings from 99acres index.`);

    let addedCount = 0;
    for (const lead of rawListings) {
      const { data: existing } = await supabase.from('leads').select('id').eq('name', lead.name);
      if (existing && existing.length > 0) continue;

      const { error } = await supabase.from('leads').insert([lead]);
      if (!error) {
        console.log(`✅ Saved 99acres Lead: ${lead.name}`);
        addedCount++;
      }
    }
  } catch (err) {
    console.error(`⚠️ 99acres Scraper error: ${err.message}`);
  }

  await browser.close();
}

// Ensure the city matches your target market
scrape99Acres('Gurgaon');