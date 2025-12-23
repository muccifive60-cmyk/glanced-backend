import express from "express";
import { enforceUsage } from "../middleware/enforceUsage.js";

const router = express.Router();

router.post(
 "/do-something",
 enforceUsage("api_call", 1),
 async (req, res) => {
   // Logic yako halisi hapa
   res.json({ success: true });
 }
);

export default router;
