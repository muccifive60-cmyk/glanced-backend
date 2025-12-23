import { pool } from "../config/db.js";

/**
* Atomically increment usage for a feature
*/
export async function incrementUsage(
 businessId,
 featureKey,
 periodStart,
 periodEnd
) {
 const client = await pool.connect();

 try {
   await client.query("BEGIN");

   const selectRes = await client.query(
     `
     SELECT id, used_count
     FROM usage_counters
     WHERE business_id = $1
       AND feature_key = $2
       AND period_start = $3
       AND period_end = $4
     FOR UPDATE
     `,
     [businessId, featureKey, periodStart, periodEnd]
   );

   if (selectRes.rowCount === 0) {
     await client.query(
       `
       INSERT INTO usage_counters
       (business_id, feature_key, period_start, period_end, used_count)
       VALUES ($1, $2, $3, $4, 1)
       `,
       [businessId, featureKey, periodStart, periodEnd]
     );
   } else {
     await client.query(
       `
       UPDATE usage_counters
       SET used_count = used_count + 1,
           updated_at = NOW()
       WHERE id = $1
       `,
       [selectRes.rows[0].id]
     );
   }

   await client.query("COMMIT");
 } catch (err) {
   await client.query("ROLLBACK");
   throw err;
 } finally {
   client.release();
 }
}
