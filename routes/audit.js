import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { recordAudit, listAudit } from "../services/audit.js";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
 try {
   const businessId = req.businessId;
   const { limit = 50, offset = 0 } = req.query;

   const logs = await listAudit({
     businessId,
     limit: Number(limit),
     offset: Number(offset),
   });

   res.json({
     success: true,
     logs,
   });
 } catch (err) {
   res.status(500).json({ error: "Audit fetch failed" });
 }
});

router.post("/", authMiddleware, async (req, res) => {
 try {
   const businessId = req.businessId;
   const userId = req.userId;
   const { action, resource, metadata } = req.body;

   const log = await recordAudit({
     businessId,
     userId,
     action,
     resource,
     metadata,
   });

   res.status(201).json({
     success: true,
     log,
   });
 } catch (err) {
   res.status(500).json({ error: "Audit record failed" });
 }
});

export default router;
