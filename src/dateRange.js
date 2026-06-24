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
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = { getDateRangeBounds, toMysqlDatetime, shanghaiDayStart };
