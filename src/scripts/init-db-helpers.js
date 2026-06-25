const fs = require('fs');
const path = require('path');
const { getPool } = require('../db');

function stripLineComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function parseStatements(sql) {
  return stripLineComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runSqlFile(filename) {
  const sqlPath = path.join(__dirname, '../../sql', filename);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = parseStatements(sql);
  const pool = getPool();

  for (let i = 0; i < statements.length; i += 1) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await pool.query(stmt);
    } catch (e) {
      console.error(`❌ 第 ${i + 1}/${statements.length} 条失败: ${preview}...`);
      throw e;
    }
  }
  return statements.length;
}

module.exports = { stripLineComments, parseStatements, runSqlFile };
