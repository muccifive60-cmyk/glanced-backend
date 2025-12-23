import { pool } from "../config/db.js";

/**
* Get billing state for a business
*/
export async function getBillingState(businessId) {
  const res = await pool.query(
    `
    SELECT
      s.id AS subscription_id,
      s.status,
      s.created_at,
      p.id AS plan_id,
      p.name AS plan_name
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.business_id = $1
    ORDER BY s.created_at DESC
    LIMIT 1
    `,
    [businessId]
  );

  if (res.rowCount === 0) {
    return {
      hasSubscription: false,
      status: "none",
      plan: null,
    };
  }

  const row = res.rows[0];

  return {
    hasSubscription: true,
    status: row.status,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
    },
    startedAt: row.created_at,
  };
}
