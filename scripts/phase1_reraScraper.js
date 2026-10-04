require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function scrapeKarnatakaRera() {
  console.log("🚀 Launching Phase 1: Karnataka RERA Extraction (Bangalore Focus)...");
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    // Navigate to Karnataka RERA's approved projects page
    await page.goto('https://rera.karnataka.gov.in/approvedProjectList', { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log("Waiting for the RERA project table to render...");
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    const projects = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const cols = row.querySelectorAll('td');
        // K-RERA typically structures their public tables like this:
        // Col 1: S.No, Col 2: Project Name, Col 3: Promoter Name, Col 4: Registration No, Col 5: District
        if (cols.length >= 5) {
          const projectName = cols[1]?.innerText.trim();
          const builderName = cols[2]?.innerText.trim();
          const district = cols[4]?.innerText.trim();
          
          return { projectName, builderName, location: district };
        }
        return null;
      }).filter(p => p && p.projectName && p.location?.toLowerCase().includes('bangalore')); // Filter for Bangalore only
    });

    console.log(`🔥 Extracted ${projects.length} Bangalore projects. Pumping to Supabase...`);

    let added = 0;
    for (const proj of projects) {
      // Check if project already exists to prevent duplicates
      const { data: existing } = await supabase
        .from('rera_projects')
        .select('id')
        .eq('project_name', proj.projectName);
      
      if (!existing || existing.length === 0) {
        await supabase.from('rera_projects').insert([{
          project_name: proj.projectName,
          builder_name: proj.builderName,
          location: proj.location
        }]);
        console.log(`✅ Saved: ${proj.projectName} by ${proj.builderName}`);
        added++;
      }
    }
    
    console.log(`🏁 Phase 1 Complete. Added ${added} net new Bangalore projects to your pipeline.`);
  } catch (err) {
    console.error("⚠️ Error scraping K-RERA. The government portal might be temporarily down or heavily loaded.", err.message);
  } finally {
    await browser.close();
  }
}

scrapeKarnatakaRera();