import express from "express";
import { mapPaddleEvent } from "../providers/paddle.js";
import { upsertSubscription, cancelSubscription } from "../service.js";
import { pool } from "../../config/db.js";

const router = express.Router();

/**
* Paddle Webhook Endpoint
*/
router.post("/paddle", async (req, res) => {
 try {
   const event = mapPaddleEvent(req.body);

   if (!event.businessId) {
     return res.status(400).json({ error: "Missing businessId" });
   }

   // Resolve plan by code (provider product_id)
   let planId = null;
   if (event.planCode) {
     const planRes = await pool.query(
       "SELECT id FROM plans WHERE provider_code = $1 LIMIT 1",
       [event.planCode]
     );
     planId = planRes.rows[0]?.id || null;
   }

   // Handle subscription lifecycle
   if (
     event.eventType === "subscription_created" ||
     event.eventType === "subscription_updated"
   ) {
     await upsertSubscription({
       businessId: event.businessId,
       planId,
       status: "active",
       provider: "paddle",
       providerSubscriptionId: event.subscriptionId,
     });
   }

   if (event.eventType === "subscription_cancelled") {
     await cancelSubscription(event.businessId);
   }

   res.json({ ok: true });
 } catch (err) {
   console.error("PADDLE WEBHOOK ERROR:", err);
   res.status(500).json({ error: "Webhook failed" });
 }
});

export default router;
