import express from "express";
import { pool } from "../config/db.js";
import { enforceUsageLimit } from "../middleware/enforceUsageLimit.js"; 
import { recordUsage } from "../services/usage.js";
// IMPORT AUTH MIDDLEWARE (Crucial fix: This provides req.user)
import { authenticateToken } from "../middleware/authMiddleware.js"; 

const router = express.Router();

// POST /api/usage/:businessId/track
// CHAIN: 1. Authenticate -> 2. Check Limit -> 3. Record Usage
router.post("/:businessId/track", authenticateToken, enforceUsageLimit, async (req, res) => {
  try {
    const { businessId } = req.params;
    const action = req.body.action || "api_calls";

    // Record usage (only runs if limit is not reached)
    const result = await recordUsage({
      businessId,
      action: action, 
    });

    res.json({
      success: true,
      new_usage: result.count,
      limit: req.usage.limit,
      message: "Usage recorded successfully"
    });

  } catch (err) {
    console.error("TRACKING ERROR:", err);
    res.status(500).json({ error: "Usage tracking failed" });
  }
});

// GET /api/usage/:businessId/status
router.get("/:businessId/status", authenticateToken, async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const result = await pool.query(
      "SELECT resource, count FROM business_usage WHERE business_id = $1",
      [businessId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error("STATUS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

export default router;