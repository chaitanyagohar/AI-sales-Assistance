require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 1. Accept dynamic arguments from the API Bridge
const category = process.argv[2] || 'Dentists';
const city = process.argv[3] || 'Delhi';
const customSearch = process.argv[4] || ''; 

async function scrapeMultiBusiness() {
  const searchQuery = customSearch.trim() !== '' ? customSearch : `${category} in ${city}`;
  console.log(`🚀 Starting Multi-Business Scraper for: "${searchQuery}"`);

  // 2. Launch Puppeteer with optimal background scraping settings
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

  const encodedQuery = encodeURIComponent(searchQuery);
  const url = `https://www.google.com/maps/search/${encodedQuery}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    console.log("Waiting for listings to load...");
    
    // Wait for the main feed container
    await page.waitForSelector('div[role="feed"]', { timeout: 10000 }).catch(() => {
      console.log("⚠️ Feed container not found. There might be no results for this query.");
    });

    // 3. Scroll mechanism to bypass lazy loading
    console.log("Scrolling to load leads...");
    await page.evaluate(async () => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return;
      for (let i = 0; i < 6; i++) {
        feed.scrollTop = feed.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    });

// 4. Extract URLs first to prevent DOM detachment errors
    console.log("Scrolling complete. Gathering all business links...");
    
    const urls = await page.evaluate(() => {
      // Find all the clickable business links in the feed
      const links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
      return links.map(link => link.href);
    });

    // Remove any duplicate URLs just in case Google loaded them twice
    const uniqueUrls = [...new Set(urls)];
    console.log(`Found ${uniqueUrls.length} unique businesses. Starting deep extraction...`);

    const listings = [];
    
    // 5. Visit each URL individually to scrape the data cleanly
    for (let i = 0; i < uniqueUrls.length; i++) {
      try {
        // Go directly to the specific business page
        await page.goto(uniqueUrls[i], { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Wait just a second for the contact info to render
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        const leadData = await page.evaluate(() => {
          const name = document.querySelector('h1')?.innerText || '';
          
          const panelText = document.querySelector('div[role="main"]')?.innerText || document.body.innerText;
          
          const phoneRegex = /(?:\+91[\s-]?)?(?:0\d{2,4}[\s-]?)?\d{4,5}[\s-]?\d{4,5}/g;
          const phoneMatches = panelText.match(phoneRegex);
          
          let phone = null;
          if (phoneMatches) {
            const valid = phoneMatches.filter(n => n.replace(/\D/g, '').length >= 10);
            if (valid.length > 0) phone = valid[0].trim();
          }

          const websiteAnchor = document.querySelector('a[data-item-id="authority"]');
          const websiteUrl = websiteAnchor ? websiteAnchor.href : null;

          return { name, phone, websiteAvailable: !!websiteUrl, websiteUrl };
        });

        // Save the lead if we got a valid name
        if (leadData.name) {
          listings.push({
            name: leadData.name,
            phone: leadData.phone,
            websiteAvailable: leadData.websiteAvailable,
            websiteUrl: leadData.websiteUrl
          });
          console.log(`[${i + 1}/${uniqueUrls.length}] Scraped: ${leadData.name} | Phone: ${leadData.phone || 'None'}`);
        }
      } catch (err) {
        console.log(`⚠️ Skipped lead ${i + 1} due to loading timeout.`);
      }
    }

    console.log(`Successfully scraped ${listings.length} full profiles.`);
    // 5. Database Insertion Logic (Strictly targeting multi_business_leads)
    let addedCount = 0;
    for (const lead of listings) {
      
      // Prevent duplicates by checking if the business name already exists
      const { data: existing } = await supabase
        .from('multi_business_leads')
        .select('id')
        .eq('business_name', lead.name);

      if (existing && existing.length > 0) continue;

      const { error } = await supabase.from('multi_business_leads').insert([{
        business_name: lead.name,
        category: category,
        city: city,
        status: 'New Lead',
        phone: lead.phone,
        whatsapp_number: lead.phone, // Default to phone, can be validated later
        website_available: lead.websiteAvailable,
        website_url: lead.websiteUrl,
        source: 'Google Maps'
      }]);

      if (!error) {
        console.log(`✅ Saved: ${lead.name} | Web: ${lead.websiteAvailable ? 'Yes' : 'No'} | Phone: ${lead.phone || 'None'}`);
        addedCount++;
      } else {
        console.error(`❌ Error saving ${lead.name}:`, error.message);
      }
    }

    console.log(`\n🎉 Finished! Added ${addedCount} net new leads for ${searchQuery}.`);

  } catch (err) {
    console.error(`⚠️ Maps scraper encountered a critical error: ${err.message}`);
  }

  await browser.close();
}

// Trigger the function
scrapeMultiBusiness();