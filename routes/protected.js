import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import requireFeature from "../middleware/requireFeature.js";
import { pool } from "../config/db.js";

const router = express.Router();

/**
* Middleware: Load business context for logged-in user
* (Temporary simple version – later will support multiple businesses)
*/
async function businessContext(req, res, next) {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `
      SELECT b.id
      FROM businesses b
      JOIN business_users bu ON bu.business_id = b.id
      WHERE bu.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "User has no business",
      });
    }

    req.businessId = result.rows[0].id;
    next();
  } catch (err) {
    console.error("BUSINESS CONTEXT ERROR:", err);
    res.status(500).json({ error: "Business context failed" });
  }
}

/**
* TEST ENDPOINT – Feature gated
*/
router.get(
  "/me",
  authMiddleware,
  businessContext,
  requireFeature("core_access"),
  (req, res) => {
    res.json({
      success: true,
      userId: req.userId,
      businessId: req.businessId,
      message: "Protected endpoint with entitlements working",
    });
  }
);

export default router;
