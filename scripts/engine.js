require('dotenv').config({ path: '.env.local' });
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startEngine() {
  console.log("========================================");
  console.log("🚀 ODDLAMBDA AI SALES ENGINE ACTIVATED");
  console.log("========================================\n");

  while (true) {
    try {
      // 1. Ask the database what sources are currently active
      console.log("Checking active scraping targets from dashboard...");
      const { data: settings, error } = await supabase
        .from('scraping_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;

      console.log("\n--- [PHASE 1: SCRAPING] ---");

      // 2. Execute scrapers based on dashboard preferences
      if (settings.google_maps) {
        console.log("-> Google Maps is ENABLED. Running Maps scraper...");
        execSync('node scripts/scrape.js', { stdio: 'inherit' });
        await delay(5000);
      } else {
        console.log("-> Google Maps is DISABLED. Skipping.");
      }

      if (settings.ninety_nine_acres) {
        console.log("-> 99acres is ENABLED. Running 99acres scraper...");
        execSync('node scripts/scrape99acres.js', { stdio: 'inherit' });
        await delay(5000);
      } else {
        console.log("-> 99acres is DISABLED. Skipping.");
      }

      // PHASE 2 & 3: Enriching and AI Generation
      console.log("\n--- [PHASE 2: ENRICHING] ---");
      execSync('node scripts/enrich.js', { stdio: 'inherit' });
      
      console.log("Resting 10 seconds...");
      await delay(10000);

      console.log("\n--- [PHASE 3: AI GENERATION] ---");
      execSync('node scripts/generate.js', { stdio: 'inherit' });
      
      console.log("\n💤 Cycle complete. System resting for 30 minutes to bypass rate limits...");
      await delay(30 * 60 * 1000); 

    } catch (error) {
      console.error("\n⚠️ Pipeline encountered an error. Restarting in 5 minutes...", error.message);
      await delay(5 * 60 * 1000);
    }
  }
}

startEngine();