import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

function getUser(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

async function getRole(teamId: string, userId: number) {
  const [rows] = await pool.execute(
    "SELECT role FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, userId]
  )
  const row = (rows as Array<{ role: string }>)[0]
  return row?.role ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId } = await params

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

  const role = await getRole(teamId, user.id)
  if (!role || (role !== "OWNER" && role !== "ADMIN")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const [result] = await pool.execute(
    "UPDATE teams SET name = ? WHERE id = ?",
    [name, teamId]
  )

  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (!affected) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId } = await params

  await ensureTeamSchema()

  const role = await getRole(teamId, user.id)
  if (!role || role !== "OWNER") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const [result] = await pool.execute("DELETE FROM teams WHERE id = ?", [teamId])
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (!affected) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
