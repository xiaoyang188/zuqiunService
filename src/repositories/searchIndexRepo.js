const { getPool } = require('../db');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function rowToHit(row) {
  if (!row) return null;
  const payload =
    typeof row.payload === 'string'
      ? JSON.parse(row.payload || 'null')
      : row.payload;
  return {
    type: row.entity_type,
    id: String(row.external_id),
    name: row.name || '',
    subtitle: row.subtitle || '',
    logo: row.logo || '',
    leagueSlug: payload?.leagueSlug || '',
    leagueKey: row.league_key || payload?.leagueKey || null,
    leagueLabel: row.league_label || payload?.leagueLabel || '',
    source: row.source || 'dongqiu',
    enName: row.name_en || '',
    ...(payload && typeof payload === 'object' ? payload : {}),
  };
}

async function upsertHit(hit) {
  const pool = getPool();
  if (!pool || !hit?.id || !hit?.name) return;
  const entityType = hit.type === 'team' ? 'team' : 'player';
  const source = hit.source || 'dongqiu';
  const externalId = String(hit.id).replace(/^(dq_player_|dq_team_|espn_player_|espn_team_)/, '');
  const nameEn = hit.enName || hit.name_en || hit.shortName || '';
  const payload = {
    leagueSlug: hit.leagueSlug || '',
    leagueKey: hit.leagueKey || null,
    leagueLabel: hit.leagueLabel || '',
    team: hit.team || '',
    nationality: hit.nationality || '',
  };
  await pool.execute(
    `INSERT INTO search_index
      (entity_type, external_id, source, name, name_en, name_norm, subtitle, logo, league_key, league_label, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      name_en = VALUES(name_en),
      name_norm = VALUES(name_norm),
      subtitle = VALUES(subtitle),
      logo = VALUES(logo),
      league_key = VALUES(league_key),
      league_label = VALUES(league_label),
      payload = VALUES(payload),
      synced_at = NOW()`,
    [
      entityType,
      externalId,
      source,
      hit.name,
      nameEn,
      normalizeName(hit.name) || normalizeName(nameEn),
      hit.subtitle || hit.leagueLabel || '',
      hit.logo || '',
      hit.leagueKey || '',
      hit.leagueLabel || '',
      JSON.stringify(payload),
    ]
  );
}

async function upsertHits(hits) {
  for (const hit of hits || []) {
    try {
      await upsertHit(hit);
    } catch {
      /* skip bad row */
    }
  }
}

/**
 * 本地模糊检索：精确前缀优先，再包含匹配
 */
async function searchLocal(keyword, limit = 20) {
  try {
    const pool = getPool();
    if (!pool) return { players: [], teams: [] };
    const q = String(keyword || '').trim();
    if (!q) return { players: [], teams: [] };
    const norm = normalizeName(q);
    const like = `%${q}%`;
    const likeNorm = `%${norm}%`;
    const [rows] = await pool.execute(
      `SELECT entity_type, external_id, source, name, name_en, subtitle, logo, league_key, league_label, payload
       FROM search_index
       WHERE name = ? OR name_en = ?
          OR name LIKE ? OR name_en LIKE ? OR name_norm LIKE ?
       ORDER BY
         CASE
           WHEN name = ? OR name_en = ? THEN 0
           WHEN name LIKE CONCAT(?, '%') OR name_en LIKE CONCAT(?, '%') THEN 1
           ELSE 2
         END,
         synced_at DESC
       LIMIT ?`,
      [q, q, like, like, likeNorm, q, q, q, q, Math.min(Math.max(limit * 2, 10), 60)]
    );

    const players = [];
    const teams = [];
    const seenP = new Set();
    const seenT = new Set();
    for (const row of rows) {
      const hit = rowToHit(row);
      if (!hit) continue;
      if (hit.type === 'team') {
        if (seenT.has(hit.id)) continue;
        seenT.add(hit.id);
        teams.push(hit);
      } else {
        if (seenP.has(hit.id)) continue;
        seenP.add(hit.id);
        players.push(hit);
      }
    }
    return {
      players: players.slice(0, limit),
      teams: teams.slice(0, limit),
    };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { players: [], teams: [] };
    throw e;
  }
}

async function countIndex() {
  try {
    const pool = getPool();
    if (!pool) return 0;
    const [[row]] = await pool.query(`SELECT COUNT(*) AS cnt FROM search_index`);
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  upsertHit,
  upsertHits,
  searchLocal,
  countIndex,
  normalizeName,
};
