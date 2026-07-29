require('dotenv').config({ path: '.env.local' });
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// High-value directories that contain rich contact info (Phone/Email)
const DIRECTORY_DOMAINS = [
  'justdial.com', '99acres.com', 'magicbricks.com', 
  'housing.com', 'indiamart.com', 'propertywala.com'
];

// 🛑 Expanded Junk Domains (Added cybo and amazonaws)
const JUNK_DOMAINS = [
  'glassdoor.com', 'glassdoor.co.in', 'ambitionbox.com', 'zaubacorp.com', 
  'tofler.in', 'tradeindia.com', 'sulekha.com', 'google.com', 
  'realestateindia.com', 'crunchbase.com', 'quikr.com', 'linkedin.com',
  'dialme24.co.in', 'makaan.com', 'wikipedia.org', 'cybo.com', 'amazonaws.com',
  'indiamart.com' // Moved IndiaMart to Junk if it's yielding bad profiles
];

function cleanDDGUrl(rawUrl) {
  if (rawUrl.includes('uddg=')) {
    try {
      const urlObj = new URL(rawUrl);
      const uddg = urlObj.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    } catch(e) {}
  }
  return rawUrl;
}

function getDomain(urlString) {
  try {
    return new URL(urlString).hostname.replace('www.', '').toLowerCase();
  } catch(e) {
    return '';
  }
}

async function enrichLeads() {
  console.log("🚀 Starting Hybrid Enrichment Engine...");

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .in('status', ['New Lead', 'Missing Data'])
    .limit(5);

  if (error || !leads || leads.length === 0) {
    console.log("No leads require enrichment right now.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
  const phoneRegex = /(?:\+91|0)?[ -]?\d{4,5}[ -]?\d{5,6}/g;

  for (const lead of leads) {
    console.log(`\n🔍 Researching: ${lead.name}`);
    
    let targetUrl = null;
    let isDirectory = false;
    let foundEmail = null;
    let foundPhone = lead.phone !== 'Extracted via Web' ? lead.phone : null;

    const searchQuery = `"${lead.name}" real estate contact phone email`;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const rawLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.result__url')).map(a => a.href || a.innerText.trim());
      });

      let candidateOfficialSite = null;
      let candidateDirectorySite = null;

      // Classify the search results
      for (let rawLink of rawLinks) {
     if (!rawLink.startsWith('http')) rawLink = 'https://' + rawLink;
        const realLink = cleanDDGUrl(rawLink);
        const domain = getDomain(realLink);
        
        // Anti-PDF and Junk Filter
        if (!domain || realLink.toLowerCase().endsWith('.pdf') || JUNK_DOMAINS.some(d => domain.includes(d))) {
          continue;
        }
        
        if (!domain || JUNK_DOMAINS.some(d => domain.includes(d))) continue;

        // Check if it is a useful directory vs standalone website
        if (DIRECTORY_DOMAINS.some(d => domain.includes(d))) {
          if (!candidateDirectorySite) candidateDirectorySite = realLink;
        } else {
          if (!candidateOfficialSite) candidateOfficialSite = realLink;
        }
      }

      // Priority: 1. Official Standalone Website, 2. Reputable Directory Listing
      if (candidateOfficialSite) {
        targetUrl = candidateOfficialSite;
        isDirectory = false;
        console.log(`🌐 Discovered Standalone Website: ${targetUrl}`);
      } else if (candidateDirectorySite) {
        targetUrl = candidateDirectorySite;
        isDirectory = true;
        console.log(`📋 Found Directory Listing: ${targetUrl}`);
      }

      // Crawl the targeted URL to extract contact details
      if (targetUrl) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          const pageText = await page.evaluate(() => document.body.innerText);
          
          // Extract Email
          const emails = pageText.match(emailRegex);
          if (emails) {
            const validEmails = emails.filter(e => 
              !e.endsWith('.png') && !e.endsWith('.jpg') && 
              !e.endsWith('.webp') && !e.includes('sentry') &&
              !DIRECTORY_DOMAINS.some(d => e.includes(d)) // Ignore portal administrative emails
            );
            if (validEmails.length > 0) foundEmail = validEmails[0].toLowerCase();
          }

          // Extract Phone Number
          const phones = pageText.match(phoneRegex);
          if (phones && !foundPhone) {
            foundPhone = phones[0].trim();
          }
        } catch (crawlError) {
          console.log(`⚠️ Could not crawl ${targetUrl}: ${crawlError.message}`);
        }
      } else {
        console.log(`❌ No usable website or directory listing found.`);
      }

      // Determine website state for database & AI context
      let websiteField = null;
      if (targetUrl) {
        websiteField = isDirectory ? `Portal Only (${getDomain(targetUrl)})` : targetUrl;
      }

      const updatePayload = {
        website: websiteField,
        email: foundEmail || 'Pending Verification',
        phone: foundPhone || 'Unknown',
        status: foundEmail ? 'Enriched - Ready' : 'Missing Data'
      };

      if (foundEmail) console.log(`✅ Extracted Email: ${foundEmail}`);
      if (foundPhone) console.log(`📞 Extracted Phone: ${foundPhone}`);

      await supabase.from('leads').update(updatePayload).eq('id', lead.id);
      await new Promise(r => setTimeout(r, 4000));

    } catch (err) {
      console.log(`⚠️ Enrichment failed for ${lead.name}: ${err.message}`);
    }
  }

  await browser.close();
  console.log('\n🎉 Finished Hybrid Discovery batch!');
}

enrichLeads();