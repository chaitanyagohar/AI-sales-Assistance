require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function runSearchBridge() {
  console.log("🚀 Launching Phase 2: The Search Bridge...");
  
  // Fetch up to 20 K-RERA projects that don't have a URL yet
  const { data: projects, error } = await supabase
    .from('rera_projects')
    .select('*')
    .is('website_url', null)
    .limit(20);

  if (error || !projects || projects.length === 0) {
    console.log("No pending projects found. Make sure you run Phase 1 first to load the database!");
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const proj of projects) {
    // Highly targeted Google Search Query: Project Name + Builder + Bangalore
    const query = encodeURIComponent(`${proj.project_name} ${proj.builder_name} Bangalore official website`);
    console.log(`Searching for: ${proj.project_name}...`);
    
    await page.goto(`https://www.google.com/search?q=${query}`, { waitUntil: 'domcontentloaded' });
    
    const url = await page.evaluate(() => {
      // Grabs the very first organic search result link
      const link = document.querySelector('div.yuRUbf a');
      return link ? link.href : null;
    });

    if (url) {
      await supabase.from('rera_projects').update({ website_url: url }).eq('id', proj.id);
      console.log(`🔗 Nailed it: ${url}`);
    } else {
      console.log(`⚠️ No clear website found for ${proj.project_name}.`);
    }
    
    // 3-second delay to keep Google from shadow-banning the scraper
    await new Promise(r => setTimeout(r, 3000)); 
  }
  
  await browser.close();
  console.log("🏁 Phase 2 Complete. Your projects are now bridged with their digital footprints.");
}

runSearchBridge();