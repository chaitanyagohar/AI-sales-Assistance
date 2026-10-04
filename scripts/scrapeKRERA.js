require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function scrapeKarnatakaRERA() {
  console.log("🚀 Starting Karnataka RERA Scraper (Disclaimer Bypass Mode)...");

  const rootUrl = 'https://rera.karnataka.gov.in';

  const browser = await puppeteer.launch({
    headless: false, // Keeping it visible so you can watch the magic happen
    defaultViewport: null, 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
  });

  try {
    const pages = await browser.pages();
    let page = pages[0];
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log("Homepage loaded. Scanning for Project links...");
    
    // Switch to English
    const engBtn = await page.$('a.english, a[translate="no"]');
    if (engBtn) {
      await engBtn.click();
      await new Promise(r => setTimeout(r, 2000)); 
    }

    // Find and click the Project Status / Search link
    const searchData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const targetUrl = links.find(a => {
        const href = a.href.toLowerCase();
        return (href.includes('project') || href.includes('details') || href.includes('status')) 
                && !href.includes('login') && !href.includes('pdf');
      });

      if (targetUrl) {
        targetUrl.click();
        return true;
      }
      return false;
    });

    if (searchData) {
        console.log("✅ Clicked the project link. Waiting for the next page...");
        await new Promise(r => setTimeout(r, 6000)); 
    } else {
        console.log("⚠️ Could not find a project link. Exiting.");
        await browser.close();
        return;
    }

    // Switch to the new tab (which is likely the Disclaimer Page)
    let allPages = await browser.pages();
    if (allPages.length > 1) {
        page = allPages[allPages.length - 1]; 
        await page.bringToFront();
    }

    console.log("Checking for a Disclaimer/Terms page...");
    
    // 🚨 NEW: The Disclaimer Bypass Engine
    const isDisclaimer = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('agree') || text.includes('read') || text.includes('terms');
    });

    if (isDisclaimer) {
        console.log("🚧 Disclaimer page detected! Executing mandatory document clicks...");
        
        // 1. Click all the document links to satisfy the site's requirements
        await page.evaluate(() => {
            // Find links that open in new tabs or look like PDF documents
            const links = Array.from(document.querySelectorAll('a'));
            const docLinks = links.filter(a => a.target === '_blank' || (a.href && a.href.toLowerCase().includes('.pdf')));
            
            docLinks.forEach(link => {
                link.click(); // This spawns the required background tabs
            });
        });

        console.log("Clicked the documents. Waiting 4 seconds for the site to register it...");
        await new Promise(r => setTimeout(r, 4000));

        // 2. Check checkboxes and click Agree
        console.log("Clicking 'Agree'...");
        await page.evaluate(() => {
            // Check any mandatory checkboxes first
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
            checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });

            // Find and click the Agree button
            const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn'));
            const agreeBtn = buttons.find(b => {
                const txt = (b.innerText || b.value || '').toLowerCase();
                return txt.includes('agree') || txt.includes('accept') || txt.includes('proceed');
            });
            
            if (agreeBtn) agreeBtn.click();
        });

        console.log("Agree button clicked! Waiting for the Search Dashboard to load...");
        await new Promise(r => setTimeout(r, 6000)); 
    }

    // Re-check tabs in case clicking "Agree" opened the dashboard in YET ANOTHER tab
    allPages = await browser.pages();
    page = allPages[allPages.length - 1]; 
    await page.bringToFront();

    console.log("We are on the Search Dashboard. Looking for the 'Applications Approved' tab...");
    
    // 🚨 Piercing iframes to find the Approved tab
    let targetFrame = page;
    let tabClicked = false;

    for (const frame of page.frames()) {
      try {
        const found = await frame.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('a, span, div, td'));
          const approvedTab = elements.find(el => {
            const text = el.innerText || '';
            return text.includes('Applications Approved') || text.includes('Approved');
          });

          if (approvedTab) {
            approvedTab.click();
            return true;
          }
          return false;
        });

        if (found) {
          console.log(`✅ Found and clicked 'Applications Approved'!`);
          targetFrame = frame;
          tabClicked = true;
          break; 
        }
      } catch (err) { }
    }

    if (tabClicked) {
        console.log("Waiting 8 seconds for the massive data table to render...");
        await new Promise(r => setTimeout(r, 8000)); 
    } else {
        console.log("⚠️ Couldn't find the Approved tab. Saving debug image...");
        await page.screenshot({ path: 'rera-debug-dashboard-failed.png', fullPage: true });
    }

    // Aggressive DOM Extraction for builders
    console.log("Scanning for RERA records...");
    const extractedData = await targetFrame.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const results = [];

      rows.forEach(row => {
        const rowText = row.innerText || '';
        if (rowText.includes('PRM/KA/RERA') || rowText.includes('ACK/KA/RERA')) {
          const columns = row.querySelectorAll('td');
          if (columns.length >= 4) {
            const projectName = columns[1]?.innerText?.trim() || 'Unknown Project';
            const promoterName = columns[2]?.innerText?.trim() || 'Unknown Promoter';
            const reraId = columns[3]?.innerText?.trim() || 'Unknown ID';

            if (promoterName && !promoterName.toLowerCase().includes('promoter')) {
              results.push({ name: promoterName, projectName, reraId });
            }
          }
        }
      });
      return results;
    });

    console.log(`Extracted ${extractedData.length} raw records.`);

    if (extractedData.length > 0) {
        let addedCount = 0;
        for (const lead of extractedData) {
          const { data: existing } = await supabase.from('leads').select('id').eq('name', lead.name);
          if (existing && existing.length > 0) continue;

          const { error } = await supabase.from('leads').insert([{
            name: lead.name,
            category: 'RERA Verified Builder',
            status: 'New Lead',
            email: 'Pending Verification',
            phone: 'Pending Extraction', 
            source: `Karnataka RERA (${lead.reraId})`,
            city: 'Bangalore' 
          }]);

          if (!error) {
            console.log(`✅ Saved RERA Lead: ${lead.name} (${lead.projectName})`);
            addedCount++;
          }
        }
        console.log(`\n🎉 Finished! Added ${addedCount} net new verified builders.`);
    }

  } catch (err) {
    console.error(`⚠️ KRERA scraper error: ${err.message}`);
  } finally {
    // Keeping the browser open for an extra 5 seconds so you can see the final state
    await new Promise(r => setTimeout(r, 5000));
    await browser.close();
  }
}

scrapeKarnatakaRERA();