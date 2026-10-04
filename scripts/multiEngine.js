require('dotenv').config({ path: '.env.local' });
const { execSync } = require('child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startMultiEngine() {
  console.log("==================================================");
  console.log("🚀 ODDLAMBDA MULTI-BUSINESS ENGINE ACTIVATED");
  console.log("==================================================\n");

  while (true) {
    try {
      // NOTE: Phase 1 (Scraping) is skipped here because you trigger it 
      // dynamically via the Dashboard UI (Category/City inputs).
      // This engine automatically processes whatever you scrape!

      console.log("\n--- [PHASE 1: ENRICHING LOCAL BUSINESSES] ---");
      console.log("Hunting for missing emails and social links...");
      // CHANGE THIS to your actual multi-business enricher script name
      execSync('node scripts/enrichMultiBusinessLeads.js', { stdio: 'inherit' });
      
      console.log("Resting 10 seconds...");
      await delay(10000);

      console.log("\n--- [PHASE 2: AI PITCH GENERATION] ---");
      console.log("Drafting custom pitches for enriched leads...");
      // CHANGE THIS to your actual multi-business pitcher script name
      execSync('node scripts/generateMultiBusinessPitches.js', { stdio: 'inherit' });
      
      console.log("\n💤 Cycle complete. System resting for 30 minutes to avoid rate limits...");
      await delay(30 * 60 * 1000); 

    } catch (error) {
      console.error("\n⚠️ Multi-Business Pipeline encountered an error. Restarting in 5 minutes...", error.message);
      await delay(5 * 60 * 1000);
    }
  }
}

startMultiEngine();