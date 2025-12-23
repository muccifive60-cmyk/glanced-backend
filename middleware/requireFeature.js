import { can } from "../services/entitlements.js";
import { getUsage, recordUsage } from "../services/usage.js";

/**
* Middleware: Require feature access + enforce usage limits
*/
export default function requireFeature(featureCode, options = {}) {
 const { amount = 1 } = options;

 return async function (req, res, next) {
   try {
     const businessId = req.businessId;
     const userId = req.userId;

     if (!businessId) {
       return res.status(403).json({
         error: "No business context",
       });
     }

     // 1. Get current usage
     const currentUsage = await getUsage({
       businessId,
       featureCode,
     });

     // 2. Check entitlement
     const allowed = await can(
       businessId,
       featureCode,
       currentUsage
     );

     if (!allowed) {
       return res.status(429).json({
         error: "Usage limit exceeded",
         feature: featureCode,
         used: currentUsage,
       });
     }

     // 3. Attach usage recorder
     res.on("finish", async () => {
       try {
         if (res.statusCode < 400) {
           await recordUsage({
             businessId,
             userId,
             featureCode,
             amount,
           });
         }
       } catch (err) {
         console.error("USAGE RECORD ERROR:", err);
       }
     });

     next();
   } catch (err) {
     console.error("USAGE ENFORCEMENT ERROR:", err);
     res.status(500).json({
       error: "Usage enforcement failed",
     });
   }
 };
}
