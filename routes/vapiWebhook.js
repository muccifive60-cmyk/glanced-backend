import express from "express";
import { incrementUsage } from "../services/usageEngine.js";

const router = express.Router();

/**
 * POST /webhooks/vapi
 * Listener for Vapi.ai call events.
 * Main purpose: Capture 'end-of-call-report' to bill the user based on duration.
 */
router.post("/vapi", async (req, res) => {
  const event = req.body;

  // 1. FILTER: We only care about the end of the call to calculate costs
  if (event.message?.type !== "end-of-call-report") {
    // Return 200 OK so Vapi knows we received it, but do nothing
    return res.status(200).send("Event ignored");
  }

  try {
    console.log("📞 Call Ended. Processing Billing...");

    const { analysis, call } = event.message;

    // 2. EXTRACT DURATION
    // Vapi sends duration in seconds. We verify it exists, default to 0.
    const durationSeconds = analysis?.duration || 0;
    
    // Business Logic: Round up to the nearest minute (e.g., 65s = 2 mins)
    const durationMinutes = Math.ceil(durationSeconds / 60);

    // 3. IDENTIFY USER
    // We look for 'userId' in the metadata attached to the call.
    // Fallback to 'anonymous_user' if not found (for testing).
    const userId = call?.metadata?.userId || "anonymous_user";

    // 4. BILLING EXECUTION
    if (durationMinutes > 0) {
        // Calculate the billing period (Current Month)
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); 
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); 

        // Call the Usage Engine to deduct credits/track usage
        await incrementUsage(
            userId,           // The Business/User ID
            'voice_minutes',  // The Feature Key defined in your DB
            periodStart, 
            periodEnd, 
            durationMinutes   // Amount to increment
        );

        console.log(`✅ BILLING SUCCESS: User '${userId}' charged for ${durationMinutes} minutes.`);
    } else {
        console.log(`⚠️ Call duration was 0 minutes. No charge applied.`);
    }

    // 5. RESPONSE
    return res.status(200).send("Billing Processed Successfully");

  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err.message);
    // Return 500 but log it. Vapi might retry if we fail.
    return res.status(500).send("Internal Server Error");
  }
});

export default router;
