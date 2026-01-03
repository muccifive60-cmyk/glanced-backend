require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { incrementUsage } = require("./services/usageEngine");
const vapiWebhookRoute = require("./routes/vapiWebhook");

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- CONFIG ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---------------- HEALTH CHECK ----------------
app.get("/", (req, res) =>
  res.send("GlanceID Server (Gemini Stable Mode) Online")
);

// ---------------- AGENTS SEARCH ----------------
app.get("/agents", async (req, res) => {
  try {
    const { query, category, limit = 50 } = req.query;

    let q = supabase.from("ai_models").select("*");

    if (query) q = q.ilike("name", `%${query}%`);
    if (category) q = q.eq("category", category);

    const { data, error } = await q.limit(Number(limit));
    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- STRIPE ----------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "GlanceID Pro Credits" },
            unit_amount: 2900,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://glanceid.com/success",
      cancel_url: "https://glanceid.com/cancel",
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- CHAT (GEMINI FIXED) ----------------
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { model: requestedModel, messages } = req.body;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing API Key" });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    const apiKey = authHeader.split(" ")[1];

    const { data: keyData } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key", apiKey)
      .single();

    if (keyError || !keyData) {
  return res.status(403).json({ error: 'Invalid API Key' });
}

    const userMessage = messages[messages.length - 1].content;
    const cleanName = requestedModel.trim();

    const { data: agent } = await supabase
      .from("ai_models")
      .select("*")
      .ilike("name", cleanName)
      .maybeSingle();

    let systemPrompt;

    if (agent) {
      systemPrompt = `
IDENTITY:
You are a STRICT enterprise AI agent named "${agent.name}"

ROLE DEFINITION:
${agent.description}

RULES:
- Only answer questions related to your defined role
- No poetry, jokes, romance, or casual conversation
- If the request is outside scope, politely refuse
`;
    } else {
      systemPrompt = `
SYSTEM ERROR:
Agent "${cleanName}" does not exist.
Respond only with:
"Configuration error: requested agent not found."
`;
    }

    // --------- GEMINI STABLE IMPLEMENTATION ----------
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const result = await model.generateContent([
      {
        role: "user",
        parts: [
          {
            text: `
SYSTEM ROLE:
${systemPrompt}

USER MESSAGE:
${userMessage}
            `,
          },
        ],
      },
    ]);

    const response = result.response.text();

    // --------- BILLING ----------
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      await incrementUsage(
        keyData.user_id,
        "chat_messages",
        periodStart,
        periodEnd
      );
    } catch (e) {
      console.warn("Billing warning:", e.message);
    }

    res.json({
      id: "chatcmpl-" + Date.now(),
      model: requestedModel,
      choices: [
        {
          message: {
            role: "assistant",
            content: response,
          },
        },
      ],
    });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Gemini processing failed" });
  }
});

// ---------------- WEBHOOKS ----------------
app.use("/webhooks", vapiWebhookRoute.default || vapiWebhookRoute);

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
