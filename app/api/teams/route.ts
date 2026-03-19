import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema, generateId, withTransaction } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

function getUser(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

export async function GET(request: NextRequest) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  await ensureTeamSchema()

  const [rows] = await pool.execute(
    `
      SELECT t.id, t.name, t.owner_id AS ownerId, t.created_at AS createdAt, m.role
      FROM teams t
      INNER JOIN memberships m ON m.team_id = t.id
      WHERE m.user_id = ?
      ORDER BY t.created_at DESC
    `,
    [user.id]
  )

  return NextResponse.json({ teams: rows }, { status: 200 })
}

export async function POST(request: NextRequest) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  let body: { name?: string }
  try {
    body = (await request.json()) as { name?: string }
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ message: "Team name is required" }, { status: 400 })
  }

  await ensureTeamSchema()

  const team = await withTransaction(async (conn) => {
    const teamId = generateId()
    await conn.execute(
      "INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)",
      [teamId, name, user.id]
    )
    await conn.execute(
      "INSERT INTO memberships (id, user_id, team_id, role) VALUES (?, ?, ?, 'OWNER')",
      [generateId(), user.id, teamId]
    )
    return { id: teamId, name, ownerId: user.id }
  })

  return NextResponse.json({ team }, { status: 201 })
}
