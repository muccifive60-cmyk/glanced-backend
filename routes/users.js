import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

/**
* GET /users/me
* Return authenticated user profile (basic for now)
*/
router.get("/me", authMiddleware, (req, res) => {
 res.json({
   message: "User profile endpoint",
   userId: req.userId,
 });
});

export default router;
