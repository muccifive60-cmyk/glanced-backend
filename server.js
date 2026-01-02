
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

// Initialize Gemini with your Hardcoded API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 1. HEALTH CHECK ---
app.get('/', (req, res) => res.send('GlanceID Server (Gemini Powered) Online 🟢'));

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

// --- 4. CHAT API (POWERED BY GEMINI) ---
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
  let systemInstructionText = "You are a helpful AI assistant.";
  
  console.log(`🔍 Requesting Agent: '${requestedModel}'...`);

  // Search for the agent in the database
  const { data: agentData, error: agentError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('name', requestedModel)
    .single();

  if (agentData) {
    console.log(`✅ AGENT FOUND: ${agentData.name}`);
    
    // Construct the Strict System Instruction based on DB Description
    systemInstructionText = `
      IDENTITY: You are ${agentData.name}.
      CORE MISSION: ${agentData.description}.
      
      STRICT GUIDELINES:
      1. You must act ONLY within the scope of your mission.
      2. If asked to do something outside your specific role (like writing poems, jokes, or general chat unrelated to your work), you must REFUSE politely but firmly. State exactly what you do.
      3. Maintain a professional tone suitable for your role.
      4. Do not mention you are an AI model; assume the role completely.
    `;
  } else {
    console.log("❌ Agent not found in DB. Using Generic AI Persona.");
  }

  // C. SEND TO GEMINI
  try {
    // Using Gemini 1.5 Flash for speed and instruction adherence
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstructionText // <--- Injecting the specific Persona
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

    // E. SEND RESPONSE TO FRONTEND (Standard OpenAI Format)
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