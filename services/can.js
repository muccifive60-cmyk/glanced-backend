import { pool } from "../config/db.js";

/*
|--------------------------------------------------------------------------
| can()
|--------------------------------------------------------------------------
| Check if a business is allowed to use a feature
*/
export async function can(businessId, featureCode, usedCount) {
  // Fetch plan limits
  const planResult = await pool.query(
    `
    SELECT plan
    FROM businesses
    WHERE id = $1
    `,
    [businessId]
  );

  if (planResult.rowCount === 0) {
    return false;
  }

  const plan = planResult.rows[0].plan;

  // Simple plan limits (can be extended later)
  const limitsByPlan = {
    free: {
      api_calls: 100,
    },
    pro: {
      api_calls: 10000,
    },
  };

  const planLimits = limitsByPlan[plan];

  if (!planLimits) {
    return false;
  }

  const limit = planLimits[featureCode];

  if (limit === undefined) {
    return false;
  }

  return usedCount < limit;
}

