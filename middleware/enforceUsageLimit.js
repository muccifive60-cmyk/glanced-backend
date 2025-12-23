import { pool } from "../config/db.js";
import { PLANS } from "../config/plans.js"; 

export const enforceUsageLimit = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.body.businessId;
    
    // Ensure user is authenticated before checking limits
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "Unauthorized access" });
    }

    const userId = req.user.userId;

    if (!businessId) {
      return res.status(400).json({ error: "Business ID is required" });
    }

    // 1. Get Business Plan (FIXED: Using 'user_id' instead of 'owner_id')
    const planResult = await pool.query(
      `SELECT plan FROM businesses WHERE id = $1 AND user_id = $2`,
      [businessId, userId]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: "Business not found or access denied" });
    }

    const userPlan = planResult.rows[0].plan; 
    const planConfig = PLANS[userPlan];
    
    // Default to 0 limit if plan is unknown
    const limit = planConfig ? planConfig.limits.api_calls : 0;

    // 2. Get Current Usage
    const usageResult = await pool.query(
      `SELECT count FROM business_usage WHERE business_id = $1 AND resource = 'api_calls'`,
      [businessId]
    );

    const currentUsage = usageResult.rows.length > 0 ? usageResult.rows[0].count : 0;

    // 3. Enforce Limit
    if (currentUsage >= limit) {
      return res.status(403).json({
        error: "LIMIT_REACHED",
        message: `Limit reached (${currentUsage}/${limit}). Please upgrade.`,
        current_usage: currentUsage,
        limit: limit,
        upgrade_url: "/billing/upgrade" 
      });
    }

    // Attach usage info for the next step
    req.usage = { currentUsage, limit };
    next();

  } catch (err) {
    console.error("USAGE LIMIT ERROR:", err);
    res.status(500).json({ error: "Usage limit check failed" });
  }
};