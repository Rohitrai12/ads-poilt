// lib/auth.ts
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pool from "./mysql"

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme-set-in-env"

export interface AuthUser {
  id: number
  email: string
  name?: string
}

export type UserRecord = AuthUser & {
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePriceId?: string | null
  subscriptionStatus?: string | null
  trialEndsAt?: string | null
  currentPeriodEnd?: string | null
}

// ── Schema initialiser (run once on cold start) ───────────────────────────────
let schemaInitialised = false

export async function ensureSchema() {
  if (schemaInitialised) return
  const conn = await pool.getConnection()
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email       VARCHAR(255) NOT NULL UNIQUE,
        name        VARCHAR(255),
        password    VARCHAR(255) NOT NULL,
        plan_tier   VARCHAR(20) NOT NULL DEFAULT 'free',
        stripe_customer_id VARCHAR(255) NULL,
        stripe_subscription_id VARCHAR(255) NULL,
        stripe_price_id VARCHAR(255) NULL,
        subscription_status VARCHAR(50) NULL,
        usage_month VARCHAR(7) NULL,
        monthly_message_count INT UNSIGNED NOT NULL DEFAULT 0,
        monthly_report_count INT UNSIGNED NOT NULL DEFAULT 0,
        trial_ends_at DATETIME NULL,
        current_period_end DATETIME NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)

    const addColumn = async (sql: string) => {
      try {
        await conn.execute(sql)
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code !== "ER_DUP_FIELDNAME") throw err
      }
    }

    await addColumn("ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) NULL")
    await addColumn("ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(255) NULL")
    await addColumn("ALTER TABLE users ADD COLUMN stripe_price_id VARCHAR(255) NULL")
    await addColumn("ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) NULL")
    await addColumn("ALTER TABLE users ADD COLUMN plan_tier VARCHAR(20) NOT NULL DEFAULT 'free'")
    await addColumn("ALTER TABLE users ADD COLUMN usage_month VARCHAR(7) NULL")
    await addColumn("ALTER TABLE users ADD COLUMN monthly_message_count INT UNSIGNED NOT NULL DEFAULT 0")
    await addColumn("ALTER TABLE users ADD COLUMN monthly_report_count INT UNSIGNED NOT NULL DEFAULT 0")
    await addColumn("ALTER TABLE users ADD COLUMN trial_ends_at DATETIME NULL")
    await addColumn("ALTER TABLE users ADD COLUMN current_period_end DATETIME NULL")

    try {
      await conn.execute("CREATE INDEX idx_users_stripe_customer_id ON users (stripe_customer_id)")
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== "ER_DUP_KEYNAME") throw err
    }
    schemaInitialised = true
  } finally {
    conn.release()
  }
}

// ── User creation ─────────────────────────────────────────────────────────────
export async function createUser(
  email: string,
  password: string,
  name?: string
): Promise<AuthUser> {
  await ensureSchema()

  const hashed = await bcrypt.hash(password, 12)

  try {
    const [result] = await pool.execute(
      "INSERT INTO users (email, name, password) VALUES (?, ?, ?)",
      [email, name ?? null, hashed]
    )
    const insertId = (result as { insertId: number }).insertId
    return { id: insertId, email, name }
  } catch (err: unknown) {
    // MySQL duplicate-entry error code
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      throw new Error("USER_EXISTS")
    }
    throw err
  }
}

// ── Authentication ────────────────────────────────────────────────────────────
export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthUser | null> {
  await ensureSchema()

  const [rows] = await pool.execute(
    "SELECT id, email, name, password FROM users WHERE email = ? LIMIT 1",
    [email]
  )
  const user = (rows as Array<{ id: number; email: string; name?: string; password: string }>)[0]

  if (!user) return null

  const match = await bcrypt.compare(password, user.password)
  if (!match) return null

  return { id: user.id, email: user.email, name: user.name }
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  await ensureSchema()
  const [rows] = await pool.execute(
    `SELECT id, email, name, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_status, trial_ends_at, current_period_end
     FROM users WHERE email = ? LIMIT 1`,
    [email]
  )
  const row = (
    rows as Array<{
      id: number
      email: string
      name?: string
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      stripe_price_id: string | null
      subscription_status: string | null
      trial_ends_at: Date | string | null
      current_period_end: Date | string | null
    }>
  )[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
  }
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  )
}

export function verifyAuthToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser
    return { id: payload.id, email: payload.email, name: payload.name }
  } catch {
    return null
  }
} 

export async function getUserById(userId: number): Promise<UserRecord | null> {
  await ensureSchema()
  const [rows] = await pool.execute(
    `SELECT id, email, name, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_status, trial_ends_at, current_period_end
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  )
  const row = (
    rows as Array<{
      id: number
      email: string
      name?: string
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      stripe_price_id: string | null
      subscription_status: string | null
      trial_ends_at: Date | string | null
      current_period_end: Date | string | null
    }>
  )[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
  }
}