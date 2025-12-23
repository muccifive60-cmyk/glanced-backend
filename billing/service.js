import { pool } from "../config/db.js";

/**
* Create or update subscription state for a business
*/
export async function upsertSubscription({
 businessId,
 planId,
 status = "active",
 provider,
 providerSubscriptionId,
}) {
 const result = await pool.query(
   `
   INSERT INTO subscriptions (
     business_id,
     plan_id,
     status,
     provider,
     provider_subscription_id
   )
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (business_id)
   DO UPDATE SET
     plan_id = EXCLUDED.plan_id,
     status = EXCLUDED.status,
     provider = EXCLUDED.provider,
     provider_subscription_id = EXCLUDED.provider_subscription_id,
     updated_at = NOW()
   RETURNING *
   `,
   [
     businessId,
     planId,
     status,
     provider,
     providerSubscriptionId,
   ]
 );

 return result.rows[0];
}

/**
* Cancel subscription
*/
export async function cancelSubscription(businessId) {
 await pool.query(
   `
   UPDATE subscriptions
   SET status = 'cancelled',
       updated_at = NOW()
   WHERE business_id = $1
   `,
   [businessId]
 );
}

/**
* ================================
* 7.4 — PLAN CHANGE / UPGRADE FLOW
* ================================
*/

/**
* Request or force plan change for a business
*
* mode:
*  - "request" → pending approval / payment
*  - "force"   → immediate plan switch (admin/system)
*/
export async function changePlan({
 businessId,
 newPlanId,
 mode = "request",
}) {
 if (!businessId || !newPlanId) {
   throw new Error("businessId and newPlanId are required");
 }

 // 1️⃣ Soft request (no payment yet)
 if (mode === "request") {
   await pool.query(
     `
     UPDATE subscriptions
     SET pending_plan_id = $2,
         updated_at = NOW()
     WHERE business_id = $1
     `,
     [businessId, newPlanId]
   );

   return {
     status: "pending",
     businessId,
     newPlanId,
   };
 }

 // 2️⃣ Force change (admin / automation)
 if (mode === "force") {
   await pool.query(
     `
     UPDATE subscriptions
     SET
       plan_id = $2,
       pending_plan_id = NULL,
       status = 'active',
       updated_at = NOW()
     WHERE business_id = $1
     `,
     [businessId, newPlanId]
   );

   return {
     status: "changed",
     businessId,
     newPlanId,
   };
 }

 throw new Error("Invalid plan change mode");
}
