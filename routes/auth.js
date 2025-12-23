import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

const router = express.Router();

/**
* POST /auth/login
* Login user and return JWT
*/
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    /* 1. Validate input */
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password required",
      });
    }

    /* 2. Get user from DB */
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const user = result.rows[0];

    /* 3. Compare password */
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    /* 4. Ensure JWT secret exists */
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing in environment variables");
      return res.status(500).json({
        error: "Server configuration error",
      });
    }

    /* 5. Generate JWT */
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    /* 6. Respond */
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({
      error: "Server error",
    });
  }
});

export default router;
