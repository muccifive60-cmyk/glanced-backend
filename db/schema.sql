-- ===============================
-- GLANCEID – EU-FIRST SAAS SCHEMA
-- PostgreSQL
-- ===============================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===============================
-- USERS
-- ===============================
CREATE TABLE users (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   email TEXT UNIQUE NOT NULL,
   password_hash TEXT NOT NULL,
   created_at TIMESTAMP DEFAULT now()
);

-- ===============================
-- BUSINESSES (TENANTS)
-- ===============================
CREATE TABLE businesses (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   name TEXT NOT NULL,
   owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   created_at TIMESTAMP DEFAULT now()
);

-- ===============================
-- USER ↔ BUSINESS MEMBERSHIP
-- (supports multi-user, multi-role)
-- ===============================
CREATE TABLE business_users (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
   role TEXT NOT NULL DEFAULT 'owner',
   created_at TIMESTAMP DEFAULT now(),
   UNIQUE (user_id, business_id)
);

-- ===============================
-- PLANS
-- ===============================
CREATE TABLE plans (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   name TEXT NOT NULL,
   created_at TIMESTAMP DEFAULT now()
);

-- ===============================
-- FEATURES / CAPABILITIES
-- ===============================
CREATE TABLE features (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   code TEXT UNIQUE NOT NULL,
   description TEXT
);

-- ===============================
-- PLAN → FEATURES (ENTITLEMENTS)
-- ===============================
CREATE TABLE plan_features (
   plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
   feature_id UUID REFERENCES features(id) ON DELETE CASCADE,
   limit_value INTEGER,
   PRIMARY KEY (plan_id, feature_id)
);

-- ===============================
-- SUBSCRIPTIONS
-- ===============================
CREATE TABLE subscriptions (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
   plan_id UUID REFERENCES plans(id),
   status TEXT NOT NULL DEFAULT 'active',
   created_at TIMESTAMP DEFAULT now()
);

-- ===============================
-- AUDIT LOGS (GDPR READY)
-- ===============================
CREATE TABLE audit_logs (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   user_id UUID,
   business_id UUID,
   action TEXT NOT NULL,
   entity TEXT NOT NULL,
   entity_id UUID,
   created_at TIMESTAMP DEFAULT now()
);
