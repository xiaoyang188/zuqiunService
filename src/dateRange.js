const TZ = 'Asia/Shanghai';

function shanghaiParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function shanghaiDayStart(dayOffset = 0) {
  const base = new Date(Date.now() + dayOffset * 86400000);
  const { year, month, day } = shanghaiParts(base);
  return new Date(`${year}-${month}-${day}T00:00:00+08:00`);
}

/** ESPN scoreboard dates 参数：上海时区 YYYYMMDD */
function shanghaiEspnDate(dayOffset = 0) {
  const base = new Date(Date.now() + dayOffset * 86400000);
  const { year, month, day } = shanghaiParts(base);
  return `${year}${month}${day}`;
}

function getDateRangeBounds(dateRange) {
  const todayStart = shanghaiDayStart(0);
  if (dateRange === 'today') {
    return { start: todayStart, end: shanghaiDayStart(1) };
  }
  if (dateRange === 'tomorrow') {
    return { start: shanghaiDayStart(1), end: shanghaiDayStart(2) };
  }
  if (dateRange === 'week') {
    return { start: todayStart, end: shanghaiDayStart(8) };
  }
  throw new Error('dateRange 无效');
}

/** UTC 时刻 → 上海 wall clock 各字段（固定 UTC+8，不会出现 24:00） */
function shanghaiWallClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  const shMs = d.getTime() + 8 * 3600_000;
  const sh = new Date(shMs);
  return {
    year: sh.getUTCFullYear(),
    month: sh.getUTCMonth() + 1,
    day: sh.getUTCDate(),
    hour: sh.getUTCHours(),
    minute: sh.getUTCMinutes(),
    second: sh.getUTCSeconds(),
  };
}

function toMysqlDatetime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00:00';

  const { year, month, day, hour, minute, second } = shanghaiWallClock(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

module.exports = { getDateRangeBounds, toMysqlDatetime, shanghaiDayStart, shanghaiEspnDate };
