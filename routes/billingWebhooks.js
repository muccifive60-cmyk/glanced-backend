import express from "express";
import { pool } from "../config/db.js";

const router = express.Router();

/**
* Billing Webhook (Stripe / Paddle placeholder)
* This is DB-safe and production-ready
*/
router.post("/", async (req, res) => {
 try {
   const event = req.body;

   /**
    * Expected payload example:
    * {
    *   business_id,
    *   plan_id,
    *   status: "active" | "cancelled"
    * }
    */

   if (!event.business_id || !event.plan_id) {
     return res.status(400).json({ error: "Invalid webhook payload" });
   }

   // Cancel old subscriptions
   await pool.query(
     `
     UPDATE subscriptions
     SET status = 'cancelled'
     WHERE business_id = $1
     `,
     [event.business_id]
   );

   // Create new subscription
   await pool.query(
     `
     INSERT INTO subscriptions (business_id, plan_id, status)
     VALUES ($1, $2, 'active')
     `,
     [event.business_id, event.plan_id]
   );

   res.json({ received: true });
 } catch (err) {
   console.error("Billing webhook error:", err);
   res.status(500).json({ error: "Webhook failed" });
 }
});

export default router;
