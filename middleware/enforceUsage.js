import { can } from "../services/entitlements.js";
import { getUsage, recordUsage } from "../services/usage.js";

/**
* HARD usage enforcement middleware
* Blocks request if limit exceeded
*/
export function enforceUsage(featureCode, amount = 1) {
 return async function (req, res, next) {
   try {
     const businessId = req.businessId;
     const userId = req.user?.id;

     if (!businessId) {
       return res.status(400).json({ error: "Business context missing" });
     }

     // 1️⃣ Get current usage
     const currentUsage = await getUsage({
       businessId,
       featureCode,
     });

     // 2️⃣ Check entitlement + limits
     const allowed = await can(
       businessId,
       featureCode,
       currentUsage + amount
     );

     if (!allowed) {
       return res.status(403).json({
         error: "Usage limit exceeded",
         feature: featureCode,
       });
     }

     // 3️⃣ Proceed
     res.on("finish", async () => {
       if (res.statusCode < 400) {
         await recordUsage({
           businessId,
           userId,
           featureCode,
           amount,
         });
       }
     });

     next();
   } catch (err) {
     console.error("Usage enforcement error:", err);
     res.status(500).json({ error: "Usage enforcement failed" });
   }
 };
}
