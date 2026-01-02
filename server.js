require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- IMPORTS FOR BILLING & WEBHOOKS ---
const { incrementUsage } = require('./services/usageEngine');
const vapiWebhookRoute = require('./routes/vapiWebhook');

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE CONNECTION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 1. HEALTH CHECK ---
app.get('/', (req, res) => res.send('GlanceID Server & Payments Online 🟢'));

// --- 2. AGENTS SEARCH API ---
// This fetches agents from 'ai_models' table to show on Frontend
app.get('/agents', async (req, res) => {
  try {
    const { query, category, limit = 20 } = req.query;
    
    // CHANGED: We are now looking at 'ai_models' because that's where your data is
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
      success_url: 'http://localhost:5173/success',
      cancel_url: 'http://localhost:5173/cancel',
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 4. AI MARKETPLACE GATEWAY (FIXED FOR ai_models) ---
app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  const requestedModel = req.body.model; 

  // A. Validate API Key
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

  // B. FIND AGENT & INJECT PERSONA (The Fix)
  let agentSystemInstruction = "You are a helpful AI assistant.";
  let providerName = "GlanceID";

  console.log(`🔍 Searching for Agent: '${requestedModel}' in ai_models...`);

  // We look directly in 'ai_models' since your screenshot confirmed the data is there
  const { data: agentData, error: agentError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('name', requestedModel)
    .single();

  if (agentData) {
    console.log("✅ AGENT FOUND:", agentData.name);
    console.log("📝 Description:", agentData.description);
    
    // HAPA NDIPO UCHAWI ULIPO:
    // Tunachukua description kwenye DB na kumlazimisha AI aitumie
    agentSystemInstruction = `IMPORTANT: You are NOT a generic AI. You are ${agentData.name}. 
    Your Core Mission & Persona: ${agentData.description}. 
    RULES:
    1. Strictly follow this persona. 
    2. If asked to do something outside your mission (like writing poems or jokes), REFUSE politely and state your professional purpose.
    3. Use a tone appropriate for your role.`;
    
    providerName = agentData.provider || "Vapi";
  } else {
    console.log("❌ Agent not found in DB. Using Generic Persona.");
  }

  // C. Charge for Usage
  try {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); 
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); 
    
    await incrementUsage(
        keyData.user_id,
        'chat_messages',
        periodStart, 
        periodEnd, 
        1 
    );
  } catch (billingError) {
    console.error("Billing Error:", billingError.message);
  }

  // D. Success Response
  res.json({
    id: "chatcmpl-" + Date.now(),
    model: requestedModel,
    provider: providerName,
    choices: [{
      message: {
        role: "assistant",
        // Kumbuka: Hapa tunatuma jibu feki la haraka ili kutest connection.
        // Kwenye Production, hapa ndipo utapoita Gemini API na kumtumia 'agentSystemInstruction'
        content: `[System: Persona Active for ${requestedModel}]\n\nHello. I am ready to operate based on my protocols: ${agentData ? agentData.description : 'Standard AI'}. How may I assist with my specific expertise?`
      }
    }]
  });
});

// --- 5. REGISTER VAPI WEBHOOK ---
app.use('/webhooks', vapiWebhookRoute.default || vapiWebhookRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

