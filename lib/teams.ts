import crypto from "crypto"
import type { PoolConnection } from "mysql2/promise"

import pool from "./mysql"
import { ensureSchema } from "./auth"

let teamSchemaInitialised = false

export type TeamRole = "OWNER" | "ADMIN" | "MEMBER"

export type TeamSummary = {
  id: string
  name: string
  ownerId: number
  createdAt: string
  role: TeamRole
}

export async function ensureTeamSchema() {
  if (teamSchemaInitialised) return
  await ensureSchema()
  const conn = await pool.getConnection()
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS teams (
        id CHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner_id INT UNSIGNED NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_teams_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS memberships (
        id CHAR(36) PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        team_id CHAR(36) NOT NULL,
        role ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_membership (user_id, team_id),
        KEY idx_memberships_team (team_id),
        CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_memberships_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS invites (
        id CHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        team_id CHAR(36) NOT NULL,
        token CHAR(64) NOT NULL UNIQUE,
        role ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accepted_at DATETIME NULL,
        created_by INT UNSIGNED NULL,
        KEY idx_invites_email (email),
        CONSTRAINT fk_invites_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        CONSTRAINT fk_invites_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)
    teamSchemaInitialised = true
  } finally {
    conn.release()
  }
}

export function generateId() {
  return crypto.randomUUID()
}

export function generateToken() {
  return crypto.randomBytes(32).toString("hex")
}

export async function withTransaction<T>(handler: (conn: PoolConnection) => Promise<T>) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await handler(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
