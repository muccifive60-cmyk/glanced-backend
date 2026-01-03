require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Optional internal services (kept, not removed)
const { incrementUsage } = require("./services/usageEngine");
const vapiWebhookRoute = require("./routes/vapiWebhook");

const app = express();
app.use(express.json());
app.use(cors());

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ------------------------------------------------------------------
// HEALTH
// ------------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("GlanceID Server (Strict Mode V2) Online");
});

// ------------------------------------------------------------------
// AGENTS SEARCH
// ------------------------------------------------------------------
app.get("/agents", async (req, res) => {
  try {
    const { query, category, limit = 50 } = req.query;

    let q = supabase.from("ai_models").select("*").eq("is_active", true);

    if (query) q = q.ilike("name", `%${query}%`);
    if (category) q = q.eq("category", category);

    const { data, error } = await q.limit(parseInt(limit, 10));
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("AGENTS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// STRIPE PAYMENT (UNCHANGED)
// ------------------------------------------------------------------
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
      success_url: "http://localhost:5173/success",
      cancel_url: "http://localhost:5173/cancel",
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------------
// CHAT COMPLETIONS (GEMINI + STRICT AGENTS)
// ------------------------------------------------------------------
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing API Key" });
    }

    const apiKey = authHeader.split(" ")[1];
    const { model: requestedModel, messages } = req.body;
    const userMessage = messages[messages.length - 1].content;

    // Validate API key
    const { data: keyData } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key", apiKey)
      .eq("is_active", true)
      .single();

    if (!keyData) {
      return res.status(403).json({ error: "Invalid or inactive API key" });
    }

    // Load agent
    const cleanName = requestedModel.trim();
    const { data: agent } = await supabase
      .from("ai_models")
      .select("*")
      .ilike("name", cleanName)
      .maybeSingle();

    let systemInstruction = "";

    if (!agent) {
      systemInstruction = `
You are a system controller.
The requested agent "${cleanName}" does not exist.
Respond with an error only.`;
    } else {
      const text = (agent.name + " " + agent.description).toLowerCase();

      if (text.match(/gdpr|compliance|regulation|law|audit|iso/)) {
        systemInstruction = `
You are a senior EU compliance officer.
Only answer regulatory and compliance questions.
Refuse creative or casual content.`;
      } else if (text.match(/cyber|security|soc|iso 27001|cloud/)) {
        systemInstruction = `
You are a senior cybersecurity architect.
Provide only technical and security guidance.
No general chat or creativity.`;
      } else if (text.match(/finance|bank|aml|kyc|risk|tax/)) {
        systemInstruction = `
You are a financial compliance and risk expert.
Answer only finance-related compliance questions.`;
      } else {
        systemInstruction = `
You are a professional enterprise AI.
Solve problems strictly within your domain.
No entertainment or casual responses.`;
      }
    }

    // Call Gemini
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction,
    });

    const result = await model.generateContent(userMessage);
    const aiText = result.response.text();

    // Usage tracking (non-blocking)
    try {
      if (incrementUsage) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        await incrementUsage(keyData.user_id, "chat_messages", start, end);
      }
    } catch (e) {
      console.error("USAGE ERROR:", e.message);
    }

    res.json({
      id: "chatcmpl-" + Date.now(),
      model: requestedModel,
      choices: [
        {
          message: {
            role: "assistant",
            content: aiText,
          },
        },
      ],
    });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Gemini processing failed" });
  }
});

// ------------------------------------------------------------------
// VAPI WEBHOOK
// ------------------------------------------------------------------
app.use("/webhooks", vapiWebhookRoute.default || vapiWebhookRoute);

// ------------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
