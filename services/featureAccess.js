import { pool } from "../config/db.js";

/**
* Check if a business can access a given feature
*/
export async function canUseFeature({ businessId, featureKey }) {
  const result = await pool.query(
    `
    SELECT f.key
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN plan_features pf ON pf.plan_id = p.id
    JOIN features f ON f.id = pf.feature_id
    WHERE s.business_id = $1
      AND s.status = 'active'
      AND f.key = $2
    LIMIT 1
    `,
    [businessId, featureKey]
  );

  return result.rowCount > 0;
}
