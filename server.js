require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');

// OPTIONAL IMPORTS (Usage Engine)
let incrementUsage;
try {
  ({ incrementUsage } = require('./services/usageEngine'));
} catch (_) {}

// OPTIONAL IMPORTS (Vapi)
let vapiWebhookRoute;
try {
  vapiWebhookRoute = require('./routes/vapiWebhook');
} catch (_) {}

const app = express();
app.use(express.json());
app.use(cors());

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { persistSession: false } }
);

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
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'GlanceID Pro Credits' },
          unit_amount: 2900,
        },
        quantity: 1,
      }],
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
// CHAT COMPLETIONS (GEMINI – FIXED)
// --------------------------------------------------
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { model: requestedModel, messages } = req.body;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    const apiKey = authHeader.replace('Bearer ', '').trim();

    const { data: keyData } = await supabase
      .from('api_keys')
      .select('user_id,is_active')
      .eq('key', apiKey)
      .single();

    if (!keyData || keyData.is_active !== true) {
      return res.status(403).json({ error: 'Invalid or inactive API key' });
    }

    const targetModelName = requestedModel?.trim() || 'General Assistant';

    const { data: agent } = await supabase
      .from('ai_models')
      .select('name,description,system_prompt')
      .ilike('name', targetModelName)
      .maybeSingle();

    const systemPrompt = agent?.system_prompt || `You are ${targetModelName}`;
    const userMessage = messages[messages.length - 1].content;

    const combinedPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;

    // ✅ CORRECT GEMINI ENDPOINT
    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const googleResponse = await axios.post(geminiUrl, {
      contents: [
        {
          role: 'user',
          parts: [{ text: combinedPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    });

    const aiReplyText =
      googleResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (incrementUsage) {
      await incrementUsage(keyData.user_id, 'chat_messages', new Date(), new Date());
    }

    res.json({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      model: targetModelName,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: aiReplyText,
        },
      }],
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Gemini processing failed' });
  }
});

// --------------------------------------------------
// VAPI WEBHOOK
// --------------------------------------------------
if (vapiWebhookRoute) {
  app.use('/webhooks', vapiWebhookRoute.default || vapiWebhookRoute);
}

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
