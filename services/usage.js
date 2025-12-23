import { pool } from "../config/db.js";

// 1. Record Usage
export const recordUsage = async ({ businessId, action }) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Insert or Increment usage count
    const updateResult = await client.query(
      `INSERT INTO business_usage (business_id, resource, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (business_id, resource)
       DO UPDATE SET count = business_usage.count + 1
       RETURNING count`,
      [businessId, action]
    );

    await client.query('COMMIT');
    
    return { count: updateResult.rows[0].count };
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 2. Get Usage (Fixes the missing export error)
export const getUsage = async (businessId) => {
  try {
    const result = await pool.query(
      "SELECT resource, count FROM business_usage WHERE business_id = $1",
      [businessId]
    );
    return result.rows;
  } catch (error) {
    throw error;
  }
};
