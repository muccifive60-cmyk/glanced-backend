import { isBusinessOwner } from "../services/businessOwnership.js";

export async function requireBusinessOwner(req, res, next) {
  const userId = req.user.id;
  const { businessId } = req.params;

  const allowed = await isBusinessOwner(userId, businessId);

  if (!allowed) {
    return res.status(403).json({ error: "Not business owner" });
  }

  next();
}
