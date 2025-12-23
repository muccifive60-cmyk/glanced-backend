import { pool } from "../config/db.js";

export async function logEvent({
 businessId,
 userId,
 action,
 resource,
 metadata = {},
}) {
 await pool.query(
   `
   INSERT INTO audit_logs (
     business_id,
     user_id,
     action,
     resource,
     metadata
   )
   VALUES ($1, $2, $3, $4, $5)
   `,
   [businessId, userId, action, resource, metadata]
 );
}
