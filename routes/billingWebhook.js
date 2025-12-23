import express from "express";
import { pool } from "../config/db.js";

const router = express.Router();

/**
* Billing Webhook (Stripe / Paddle)
* NOTE: signature verification itaongezwa production
*/
router.post("/billing", async (req, res) => {
 const event = req.body;

 try {
   // Example normalized payload
   const {
     businessId,
     planId,
     status, // active | canceled | past_due
   } = event;

   if (!businessId || !status) {
     return res.status(400).json({ error: "Invalid webhook payload" });
   }

   // Update subscription state
   await pool.query(
     `
     UPDATE subscriptions
     SET status = $1
     WHERE business_id = $2
     `,
     [status, businessId]
   );

   return res.json({ received: true });
 } catch (err) {
   console.error("Billing webhook error:", err);
   return res.status(500).json({ error: "Webhook processing failed" });
 }
});

export default router;
