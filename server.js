require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
// If you haven't set up Stripe yet, you can comment the line below
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- OPTIONAL SERVICE IMPORTS ---
// Uncomment these if you have the files locally
const { incrementUsage } = require('./services/usageEngine'); 
const vapiWebhookRoute = require('./routes/vapiWebhook');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURATION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Initialize Gemini with your Environment Variable (SECURE)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 1. HEALTH CHECK ---
app.get('/', (req, res) => res.send('GlanceID Server (Strict Mode V2) Online 🟢'));

// --- 2. AGENTS SEARCH API ---
app.get('/agents', async (req, res) => {
  try {
    const { query, category, limit = 50 } = req.query;
    
    // Querying the 'ai_models' table for agents
    let supabaseQuery = supabase
      .from('ai_models') 
      .select('*');

    if (query) {
      supabaseQuery = supabaseQuery.ilike('name', `%${query}%`);
    }

    if (category) {
      supabaseQuery = supabaseQuery.eq('category', category);
    }

    const { data, error } = await supabaseQuery.limit(parseInt(limit));

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching agents:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- 3. STRIPE PAYMENTS ---
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'GlanceID Pro Plan (Credits)' },
          unit_amount: 2900, 
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'http://localhost:5173/success', // Update for production URL
      cancel_url: 'http://localhost:5173/cancel',
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 4. CHAT API (POWERED BY GEMINI + INTELLIGENCE LAYER) ---
app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { model: requestedModel, messages } = req.body;
  
  // Get the last message from the user
  const userMessage = messages[messages.length - 1].content;

  // A. Validate User API Key
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API Key' });
  }
  const apiKey = authHeader.split(' ')[1];

  const { data: keyData, error: keyError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key', apiKey)
    .single();

  if (keyError || !keyData || !keyData.is_active) {
    return res.status(403).json({ error: 'Invalid or Inactive API Key' });
  }

  // B. FIND AGENT & INJECT PERSONA
  let systemInstructionText = "";
  
  console.log(`🔍 Requesting Agent: '${requestedModel}'...`);

  // Search for the agent in the database using .ilike for better matching
  const cleanName = requestedModel.trim();
  const { data: agentData, error: agentError } = await supabase
    .from('ai_models')
    .select('*')
    .ilike('name', cleanName) // Using ilike to ignore case sensitivity
    .maybeSingle(); // Prevents errors if duplicates exist

  if (agentData) {
    console.log(`✅ AGENT FOUND: ${agentData.name}`);

    // --- INTELLIGENCE LAYER: AUTO-DETECT CATEGORY ---
    // This function creates the "Strict Persona" based on keywords in the name
    function detectCategoryPrompt(name, description) {
        const textToCheck = (name + " " + description).toLowerCase();

        // 1. CONTRACTING & LEGAL (Matches "US Federal Contracting")
        if (textToCheck.match(/contract|procurement|bid|federal|compliance|gdpr|regulation|law|attorney/)) {
          return `
            IDENTITY: You are a SENIOR FEDERAL CONTRACTING & COMPLIANCE OFFICER.
            EXPERTISE: Specialized in ${name}.
            STRICT RULES:
            1. Base all answers strictly on official regulations (FAR/DFARS) and compliance standards.
            2. Be professional, authoritative, and precise.
            3. REJECT strictly: "I am a professional contracting system. I do not create creative content like poems."
          `;
        }

        // 2. REAL ESTATE (Matches "NYC Real Estate")
        if (textToCheck.match(/real estate|property|tenant|landlord|leasing|rent|housing/)) {
          return `
            IDENTITY: You are a LICENSED REAL ESTATE EXPERT.
            EXPERTISE: Specialized in ${name}.
            STRICT RULES:
            1. Provide market analysis, valuation, and regulatory advice for real estate.
            2. Do NOT give financial advice without a disclaimer.
            3. REJECT non-business queries immediately.
          `;
        }

        // 3. CYBERSECURITY & TECH (Matches "Cybersecurity SOC2")
        if (textToCheck.match(/cybersecurity|soc2|fintech|saas|software|automation|cloud|it support/)) {
          return `
            IDENTITY: You are a SENIOR TECHNICAL ARCHITECT & SECURITY ANALYST.
            EXPERTISE: Specialized in ${name}.
            STRICT RULES:
            1. Focus on technical implementation, security protocols (SOC2/ISO), and code.
            2. Provide step-by-step technical solutions.
            3. REJECT generic chat. Say: "I handle technical and security operations only."
          `;
        }

        // 4. HR & RECRUITMENT
        if (textToCheck.match(/hr|recruitment|hiring|eeo|employee|staffing/)) {
          return `
            IDENTITY: You are a SENIOR HR COMPLIANCE MANAGER.
            EXPERTISE: Specialized in ${name}.
            STRICT RULES:
            1. Follow labor laws and EEO guidelines strictly.
            2. Maintain a professional, corporate tone.
            3. REJECT entertainment requests.
          `;
        }

        // 5. DEFAULT FALLBACK (Catches everything else)
        return `
            IDENTITY: You are an ENTERPRISE AI EXPERT specialized in: "${name}".
            SOURCE MATERIAL: "${description}".
            STRICT RULES:
            1. Solve professional problems related to ${name}.
            2. Ignore marketing fluff. Focus on the core domain expertise.
            3. ABSOLUTELY NO poems, jokes, or entertainment.
        `;
    }

    // Apply the intelligent prompt
    systemInstructionText = detectCategoryPrompt(agentData.name, agentData.description);
    
  } else {
    console.log(`❌ Agent '${cleanName}' not found in DB. Blocking request.`);
    // Fallback: Strict refusal if agent doesn't exist
    systemInstructionText = `
      You are a System Administrator.
      The user requested an agent named '${cleanName}' which is not in our database.
      Politely inform the user: "Error: Configuration for '${cleanName}' not found. Please contact support."
      Do NOT answer any other questions.
    `;
  }

  // C. SEND TO GEMINI
  try {
    // Using Gemini 1.5 Flash
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstructionText // <--- The "Strict Persona" is injected here
    });

    const result = await model.generateContent(userMessage);
    const response = await result.response;
    const aiReplyText = response.text();

    // D. UPDATE BILLING (Record Usage)
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); 
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); 
      
      // Increment usage if the engine is available
      if (incrementUsage) {
          await incrementUsage(
              keyData.user_id,
              'chat_messages',
              periodStart, 
              periodEnd, 
              1 
          );
      }
    } catch (billingError) {
      console.error("⚠️ Billing Error (Chat continues):", billingError.message);
    }

    // E. SEND RESPONSE TO FRONTEND
    res.json({
      id: "chatcmpl-" + Date.now(),
      model: requestedModel,
      choices: [{
        message: {
          role: "assistant",
          content: aiReplyText
        }
      }]
    });

  } catch (aiError) {
    console.error("🔴 Gemini API Error:", aiError);
    res.status(500).json({ error: "Failed to process request with Gemini AI." });
  }
});

// --- 5. REGISTER VAPI WEBHOOK ---
app.use('/webhooks', vapiWebhookRoute.default || vapiWebhookRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));