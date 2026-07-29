require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listMyModels() {
  console.log("🔍 Checking available models for your API Key...");
  try {
    // We make a dummy request to list models
    const fetch = require('node-fetch'); // Next.js environment usually supports global fetch, but we'll use native fetch
    const response = await globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    
    if (data.models) {
      console.log("\n✅ You have access to the following models that support generation:");
      data.models.forEach(m => {
        if (m.supportedGenerationMethods.includes('generateContent')) {
          console.log(`- ${m.name.replace('models/', '')}`);
        }
      });
      console.log("\n👉 Copy one of the names above and paste it into scripts/generate.js!");
    } else {
      console.log("⚠️ Error fetching models:", data);
    }
  } catch (error) {
    console.log("Failed to fetch models:", error.message);
  }
}

listMyModels();