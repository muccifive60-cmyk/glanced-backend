import express from "express";
import { supabase } from "../supabaseClient.js";
import { runAgent } from "../services/aiService.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { agentId, message } = req.body;

    // 1. Fetch agent configuration
    const { data: agent } = await supabase
      .from("ai_models")
      .select("system_prompt, name")
      .eq("id", agentId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // 2. Execute agent using Gemini
    const reply = await runAgent({
      systemPrompt: agent.system_prompt,
      userMessage: message,
    });

    res.json({
      agent: agent.name,
      reply,
    });

  } catch (err) {
    console.error("AI ROUTE ERROR:", err);
    res.status(500).json({ error: "AI processing failed" });
  }
});

export default router;

