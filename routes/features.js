import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import requireFeature from "../middleware/requireFeature.js";

const router = express.Router();

/**
* Test protected feature: AI Writer
*/
router.get(
 "/ai-writer",
 authMiddleware,
 requireFeature("ai_writer"),
 async (req, res) => {
   return res.json({
     success: true,
     feature: "ai_writer",
     message: "AI Writer feature access granted",
   });
 }
);

export default router;
