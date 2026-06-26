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

function toMysqlDatetime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00:00';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

module.exports = { getDateRangeBounds, toMysqlDatetime, shanghaiDayStart, shanghaiEspnDate };
