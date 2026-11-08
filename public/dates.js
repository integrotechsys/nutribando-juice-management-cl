// Date helpers — everything is in East Africa Time (Tanzania, GMT+3)
export const TZ = 'Africa/Dar_es_Salaam';

/** Today's date (YYYY-MM-DD) in Tanzania, whatever the device's own timezone is. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) =>
  Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

export const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

export const monthStart = (d) => d.slice(0, 8) + '01';

export const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
