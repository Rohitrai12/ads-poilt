-- teams.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TYPE role AS ENUM ('OWNER','ADMIN','MEMBER');

CREATE TABLE memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role role NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, team_id)
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role role NOT NULL DEFAULT 'MEMBER',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_memberships_team ON memberships(team_id);