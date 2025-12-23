import express from "express";
import { pool } from "../config/db.js"; // <--- Sasa tunaita 'pool' moja kwa moja
import { PLANS, DEFAULT_PLAN } from "../config/plans.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| POST /businesses
|--------------------------------------------------------------------------
*/
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const { name } = req.body;
    const userId = req.user.userId;

    if (!name) {
      return res.status(400).json({ error: "Business name is required" });
    }

    await client.query('BEGIN');

    const businessResult = await client.query(
      `INSERT INTO businesses (name, user_id, plan)
       VALUES ($1, $2, $3)
       RETURNING id, name, user_id, plan, created_at`,
      [name, userId, DEFAULT_PLAN]
    );

    const newBusiness = businessResult.rows[0];

    await client.query(
      `INSERT INTO business_members (business_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [newBusiness.id, userId, 'owner']
    );

    await client.query('COMMIT');

    const planConfig = PLANS[newBusiness.plan] || PLANS[DEFAULT_PLAN];

    res.status(201).json({
      id: newBusiness.id,
      name: newBusiness.name,
      ownerUserId: newBusiness.user_id,
      role: 'owner',
      plan: newBusiness.plan,
      limits: planConfig.limits,
      createdAt: newBusiness.created_at,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("CREATE BUSINESS ERROR:", err);
    res.status(500).json({ error: "Failed to create business" });
  } finally {
    client.release();
  }
});

/*
|--------------------------------------------------------------------------
| GET /businesses
|--------------------------------------------------------------------------
*/
router.get("/", async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT b.id, b.name, b.user_id, b.plan, b.created_at, m.role
       FROM businesses b
       JOIN business_members m ON b.id = m.business_id
       WHERE m.user_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );

    res.json(
      result.rows.map((b) => {
        const planKey = b.plan || DEFAULT_PLAN;
        const planDetails = PLANS[planKey];

        return {
          id: b.id,
          name: b.name,
          ownerUserId: b.user_id,
          role: b.role,
          plan: planKey,
          limits: planDetails.limits,
          createdAt: b.created_at,
        };
      })
    );
  } catch (err) {
    console.error("LIST BUSINESSES ERROR:", err);
    res.status(500).json({ error: "Failed to load businesses" });
  }
});

// Routes nyingine (me, plan, features, usage) zinabaki vilevile...
router.get("/me", async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      `SELECT id, name FROM businesses WHERE user_id = $1`,
      [userId]
    );
    res.json({ success: true, ownerUserId: userId, businesses: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch ownership data" });
  }
});

router.get("/:businessId/plan", async (req, res) => {
  try {
    const { businessId } = req.params;
    const result = await pool.query(`SELECT plan FROM businesses WHERE id = $1`, [businessId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Business not found" });
    const planKey = result.rows[0].plan || DEFAULT_PLAN;
    res.json(PLANS[planKey]);
  } catch (err) {
    res.status(500).json({ error: "Failed to load plan" });
  }
});

router.get("/:businessId/features", async (req, res) => { res.json(["api_calls"]); });
router.get("/:businessId/usage", async (req, res) => { res.json({ api_calls: 0 }); });

export default router;