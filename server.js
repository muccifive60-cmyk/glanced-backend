require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch'); // Replaces @google/generative-ai for stability

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
// CONFIGURATION & CHECKS
// --------------------------------------------------
if (!process.env.GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY is missing in Environment Variables.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY, // Must be Service Role Key
  {
    auth: {
      persistSession: false,
    },
  }
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
// CHAT COMPLETIONS (FIXED GEMINI LOGIC)
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

    const apiKey = authHeader.replace('Bearer ', '').trim();

    // 1. API KEY VALIDATION (SUPABASE)
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('id,user_id,is_active')
      .eq('key', apiKey)
      .single();

    if (keyError || !keyData || keyData.is_active !== true) {
      return res.status(403).json({ error: 'Invalid or inactive API key' });
    }

    // 2. AGENT LOOKUP
    // If no model is specified, default to a generic name to prevent errors
    const targetModelName = requestedModel ? requestedModel.trim() : 'General Assistant';
    
    const { data: agent } = await supabase
      .from('ai_models')
      .select('name,description,system_prompt')
      .ilike('name', targetModelName)
      .maybeSingle();

    // Fallback system prompt if agent is not found or has no prompt
    const systemPrompt =
      agent?.system_prompt ||
      `
IDENTITY: Enterprise AI Agent
SPECIALIZATION: ${targetModelName}
DESCRIPTION: ${agent?.description || 'General Assistant'}
RULES:
- Answer only within your specialization
- Be precise, technical, and professional
`.trim();

    const userMessage = messages[messages.length - 1].content;

    // 3. GEMINI REQUEST (RAW HTTP FETCH)
    // We combine System Prompt + User Message to avoid SDK errors
    const combinedPrompt = `[SYSTEM INSTRUCTION]: ${systemPrompt}\n\n[USER MESSAGE]: ${userMessage}`;

    const geminiPayload = {
      contents: [{
        parts: [{ text: combinedPrompt }]
      }]
    };

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const googleResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const googleData = await googleResponse.json();

    if (!googleResponse.ok) {
      console.error("Google Gemini Error:", JSON.stringify(googleData, null, 2));
      return res.status(500).json({ 
        error: "Gemini processing failed", 
        details: googleData 
      });
    }

    const aiReplyText = googleData.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated";

    // 4. USAGE TRACKING
    if (incrementUsage) {
      try {
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        await incrementUsage(
          keyData.user_id,
          'chat_messages',
          periodStart,
          periodEnd
        );
      } catch (usageErr) {
        console.error('Usage tracking failed:', usageErr.message);
      }
    }

    // 5. RESPONSE
    res.json({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      model: agent?.name || requestedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: aiReplyText,
          },
        },
      ],
    });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
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
