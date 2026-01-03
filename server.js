require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require('@google/generative-ai');

// OPTIONAL IMPORTS (already in your project)
const { incrementUsage } = require('./services/usageEngine');
const vapiWebhookRoute = require('./routes/vapiWebhook');

const app = express();
app.use(express.json());
app.use(cors());

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------
app.get('/', (req, res) => {
  res.send('GlanceID Server Online');
});

// --------------------------------------------------
// AGENTS SEARCH
// --------------------------------------------------
app.get('/agents', async (req, res) => {
  try {
    const { query, category, limit = 50 } = req.query;

    let q = supabase.from('ai_models').select('*');

    if (query) q = q.ilike('name', `%${query}%`);
    if (category) q = q.eq('category', category);

    const { data, error } = await q.limit(Number(limit));
    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------
// STRIPE CHECKOUT
// --------------------------------------------------
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'GlanceID Pro Credits' },
            unit_amount: 2900,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://glanceid-frontend.vercel.app/success',
      cancel_url: 'https://glanceid-frontend.vercel.app/cancel',
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------
// CHAT COMPLETIONS (GEMINI)
// --------------------------------------------------
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { model: requestedModel, messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const apiKey = authHeader.split(' ')[1];

    // Validate API key
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', apiKey)
      .eq('is_active', true)
      .single();

    if (keyError || !keyData) {
      return res.status(403).json({ error: 'Invalid or inactive API key' });
    }

    // Get agent
    const { data: agent } = await supabase
      .from('ai_models')
      .select('*')
      .ilike('name', requestedModel.trim())
      .maybeSingle();

    let systemPrompt = '';

    if (agent) {
      systemPrompt = `
IDENTITY: You are a professional enterprise AI agent.
SPECIALIZATION: ${agent.name}
DESCRIPTION: ${agent.description}

RULES:
- Answer only within your specialization
- No poems, jokes, or casual chat
- Be concise, technical, and authoritative
      `;
    } else {
      systemPrompt = `
You are a system guard.
The requested agent "${requestedModel}" does not exist.
Respond with an error message only.
      `;
    }

    const userMessage = messages[messages.length - 1].content;

    // ------------------ GEMINI FIX (ONLY CHANGE) ------------------
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
    });

    const result = await model.generateContent([
      {
        role: 'system',
        parts: [{ text: systemPrompt }],
      },
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ]);

    const response = await result.response;
    const aiReplyText = response.text();
    // -------------------------------------------------------------

    // Usage tracking
    try {
      if (incrementUsage) {
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        await incrementUsage(
          keyData.user_id,
          'chat_messages',
          periodStart,
          periodEnd
        );
      }
    } catch (usageErr) {
      console.error('Usage tracking failed:', usageErr.message);
    }

    res.json({
      id: 'chatcmpl-' + Date.now(),
      model: requestedModel,
      choices: [
        {
          message: {
            role: 'assistant',
            content: aiReplyText,
          },
        },
      ],
    });
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Gemini processing failed' });
  }
});

// --------------------------------------------------
// VAPI WEBHOOK
// --------------------------------------------------
app.use('/webhooks', vapiWebhookRoute.default || vapiWebhookRoute);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
