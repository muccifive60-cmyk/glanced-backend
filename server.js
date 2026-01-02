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

// --- 2. AGENTS SEARCH API (NEW) ---
// Allows Frontend to fetch and search through the 800,000 agents
app.get('/agents', async (req, res) => {
  try {
    const { query, category, limit = 20 } = req.query;
    
    let supabaseQuery = supabase
      .from('agents')
      .select('*');

    // Search by Name (Case insensitive)
    if (query) {
      supabaseQuery = supabaseQuery.ilike('name', `%${query}%`);
    }

    // Filter by Category
    if (category) {
      supabaseQuery = supabaseQuery.eq('category', category);
    }

    // Pagination limit to prevent server overload
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
          unit_amount: 2900, // $29.00
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

// --- 4. AI MARKETPLACE GATEWAY (UPDATED) ---
// Handles chat requests and injects specific agent personas
app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  const requestedModel = req.body.model; 

  // A. Validate API Key
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API Key' });
  }
  const apiKey = authHeader.split(' ')[1];

  // B. Check Key in Database
  const { data: keyData, error: keyError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key', apiKey)
    .single();

  if (keyError || !keyData || !keyData.is_active) {
    return res.status(403).json({ error: 'Invalid or Inactive API Key' });
  }

  // C. Find Agent & Get "Description" (Persona Injection)
  let agentSystemInstruction = "You are a helpful AI assistant.";
  let providerName = "GlanceID";

  // Check 'agents' table first (for the 800k agents)
  const { data: agentData, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('name', requestedModel)
    .single();

  if (agentData) {
    // Found in Agents table: Inject the description as the persona
    agentSystemInstruction = `You are ${agentData.name}. Your role is: ${agentData.description}. Strict adherence to this persona is required.`;
    providerName = agentData.provider || "Vapi";
  } else {
    // Fallback: Check 'ai_models' table for standard models
    const { data: modelData } = await supabase
        .from('ai_models')
        .select('*')
        .eq('name', requestedModel)
        .single();
        
    if (!modelData) {
        return res.status(404).json({ error: `Agent/Model '${requestedModel}' not found.` });
    }
    providerName = modelData.provider;
  }

  // D. Charge for Usage (Billing)
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

  // E. Success Response (Simulating AI Response with Context)
  res.json({
    id: "chatcmpl-" + Date.now(),
    model: requestedModel,
    provider: providerName,
    choices: [{
      message: {
        role: "assistant",
        content: `[System Connected to ${requestedModel}]\n[Persona Active]\n\nHello! I am ready to assist you as ${requestedModel}.`
      }
    }]
  });
});

// --- 5. REGISTER VAPI WEBHOOK ---
app.use('/webhooks', vapiWebhookRoute.default || vapiWebhookRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));