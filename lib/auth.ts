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
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
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