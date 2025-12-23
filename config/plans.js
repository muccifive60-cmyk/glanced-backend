export const PLANS = {
  free: {
    id: "free",
    name: "Free Plan",
    price: 0,
    limits: {
      members: 2,
      api_calls: 100,
      features: [] 
    }
  },
  pro: {
    id: "pro",
    name: "Pro Plan",
    price: 29,
    limits: {
      members: 10,
      api_calls: 10000,
      features: ["analytics", "priority_support"]
    }
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 99,
    limits: {
      members: 100,
      api_calls: 100000,
      features: ["analytics", "sso", "audit_logs"]
    }
  }
};

export const DEFAULT_PLAN = "free";
