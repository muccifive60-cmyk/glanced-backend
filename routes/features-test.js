import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import requireFeature from "../middleware/requireFeature.js";

const router = express.Router();

router.post(
 "/ai-test",
 authMiddleware,
 requireFeature("ai_writer", { amount: 1 }),
 async (req, res) => {
   res.json({
     success: true,
     feature: "ai_writer",
     businessId: req.businessId,
     userId: req.userId,
   });
 }
);

export default router;
