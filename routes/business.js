import express from "express";
import { pool } from "../config/db.js";

const router = express.Router();

/*
 CREATE BUSINESS
 Owner = logged in user
*/
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    const ownerId = req.user.userId;

    if (!name) {
      return res.status(400).json({
        error: "Business name required",
      });
    }

    const businessResult = await pool.query(
      `
      INSERT INTO businesses (name, owner_id)
      VALUES ($1, $2)
      RETURNING *
      `,
      [name, ownerId]
    );

    const business = businessResult.rows[0];

    // add owner as member
    await pool.query(
      `
      INSERT INTO business_members (business_id, user_id, role)
      VALUES ($1, $2, 'owner')
      `,
      [business.id, ownerId]
    );

    res.status(201).json(business);
  } catch (err) {
    console.error("CREATE BUSINESS ERROR:", err);
    res.status(500).json({ error: "Failed to create business" });
  }
});

/*
 LIST MY BUSINESSES
*/
router.get("/", async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT b.*
      FROM businesses b
      JOIN business_members bm ON bm.business_id = b.id
      WHERE bm.user_id = $1
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("LIST BUSINESS ERROR:", err);
    res.status(500).json({ error: "Failed to load businesses" });
  }
});

export default router;
