import { pool } from "../config/db.js";

/**
* Check if a business can use a feature
*/
export async function can(
  businessId,
  featureCode,
  currentUsage = 0
) {
  const res = await pool.query(
    `
    SELECT
      f.code,
      pf.limit_value
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN plan_features pf ON pf.plan_id = p.id
    JOIN features f ON f.id = pf.feature_id
    WHERE s.business_id = $1
      AND f.code = $2
      AND s.status = 'active'
    LIMIT 1
    `,
    [businessId, featureCode]
  );

  if (res.rowCount === 0) return false;

  const limit = res.rows[0].limit_value;

  if (limit === null) return true; // unlimited
  return currentUsage < limit;
}
