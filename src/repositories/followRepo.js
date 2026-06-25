const { getPool } = require('../db');

function parseTeamExternalId(teamId) {
  return String(teamId).replace(/^espn_team_/, '');
}

function toTeamInfo(row) {
  return {
    _id: `espn_team_${row.team_external_id}`,
    name: row.team_name,
    logo: row.team_logo,
    league: row.team_league,
  };
}

async function listByUserId(userId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT team_external_id, team_name, team_logo, team_league
     FROM follow_teams WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(toTeamInfo);
}

async function follow(userId, team) {
  const pool = getPool();
  const externalId = parseTeamExternalId(team._id || team.teamId);
  await pool.execute(
    `INSERT INTO follow_teams (user_id, team_external_id, team_name, team_logo, team_league)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       team_name = VALUES(team_name),
       team_logo = VALUES(team_logo),
       team_league = VALUES(team_league)`,
    [
      userId,
      externalId,
      team.name || '',
      team.logo || '',
      team.league || '',
    ]
  );
}

async function unfollow(userId, teamId) {
  const pool = getPool();
  const externalId = parseTeamExternalId(teamId);
  await pool.execute(`DELETE FROM follow_teams WHERE user_id = ? AND team_external_id = ?`, [
    userId,
    externalId,
  ]);
}

async function isFollowing(userId, teamId) {
  const pool = getPool();
  const externalId = parseTeamExternalId(teamId);
  const [rows] = await pool.execute(
    `SELECT 1 FROM follow_teams WHERE user_id = ? AND team_external_id = ? LIMIT 1`,
    [userId, externalId]
  );
  return rows.length > 0;
}

module.exports = {
  parseTeamExternalId,
  listByUserId,
  follow,
  unfollow,
  isFollowing,
  toTeamInfo,
};
