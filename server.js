require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- NEW IMPORTS FOR BILLING & WEBHOOKS ---
// Importing the Usage Engine to track costs
const { incrementUsage } = require('./services/usageEngine');
// Importing the Vapi Webhook Route
const vapiWebhookRoute = require('./routes/vapiWebhook');

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE CONNECTION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 1. HEALTH CHECK ---
app.get('/', (req, res) => res.send('GlanceID Server & Payments Online 🟢'));

// --- 2. STRIPE PAYMENTS (RESTORED) ---
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
      success_url: 'http://localhost:5173/success', // Redirect after pay
      cancel_url: 'http://localhost:5173/cancel',
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 3. AI MARKETPLACE GATEWAY (NEW ENGINE) ---
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

  // C. Check Model in Database
  const { data: modelData, error: modelError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('name', requestedModel)
    .single();

  if (modelError || !modelData) {
    return res.status(404).json({ 
      error: `Model '${requestedModel}' not found in GlanceID Marketplace.` 
    });
  }

  // --- NEW: CHARGE FOR USAGE (BILLING) ---
  try {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); 
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); 
    
    // Charge 1 unit per message/request
    await incrementUsage(
        keyData.user_id, // Get User ID from API Key
        'chat_messages', // Feature Key for Text
        periodStart, 
        periodEnd, 
        1 // Amount
    );
  } catch (billingError) {
    console.error("Billing Error:", billingError.message);
    // Optional: Return error if billing fails, or allow it but log error
    // return res.status(402).json({ error: "Billing Failed" });
  }

  // D. Success Response (Access Granted)
  res.json({
    id: "chatcmpl-" + Date.now(),
    model: modelData.name,
    provider: modelData.provider,
    choices: [{
      message: {
        role: "assistant",
        content: `Connection Established. You are now using ${modelData.name} provided by ${modelData.provider}.`
      }
    }]
  });
});

// --- NEW: REGISTER VAPI WEBHOOK ---
// This enables the server to receive call reports from Vapi
app.use('/webhooks', vapiWebhookRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
