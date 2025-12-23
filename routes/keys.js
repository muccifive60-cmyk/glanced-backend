 import express from "express";
import crypto from "crypto";
import { pool } from "../config/db.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Helper to generate a random API key
const generateApiKey = () => {
  const prefix = "gla_live_";
  const randomPart = crypto.randomBytes(16).toString("hex");
  return `${prefix}${randomPart}`;
};

// POST /api/keys/generate
router.post("/generate", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, name } = req.body;
    const userId = req.user.userId;

    // 1. Verify Ownership
    const ownershipCheck = await client.query(
      "SELECT id FROM businesses WHERE id = $1 AND user_id = $2",
      [businessId, userId]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({ error: "Access denied or Business not found" });
    }

    // 2. Generate Key
    const newKey = generateApiKey();
    
    // FIXED: Changed substring to 10 characters to match database limit
    const keyPrefix = newKey.substring(0, 10); 

    // 3. Save to Database
    await client.query(
      `INSERT INTO api_keys (business_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)`,
      [businessId, newKey, keyPrefix, name || "General Key"]
    );

    res.json({
      success: true,
      apiKey: newKey, 
      message: "API Key created. Copy it now, you won't see it again!"
    });

  } catch (err) {
    console.error("KEY GEN ERROR:", err);
    res.status(500).json({ error: "Failed to generate key" });
  } finally {
    client.release();
  }
});

// GET /api/keys/:businessId
router.get("/:businessId", authenticateToken, async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Fetch all keys for this business
    const result = await pool.query(
      `SELECT id, key_prefix, name, created_at 
       FROM api_keys WHERE business_id = $1 ORDER BY created_at DESC`,
      [businessId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error("FETCH KEYS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch keys" });
  }
});

export default router;
