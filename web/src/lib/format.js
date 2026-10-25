const TZ = 'Africa/Lagos';

export const STREAMS = ['general', 'recyclable', 'organic'];
export const STREAM = {
  general: { label: 'General', long: 'General waste', hint: 'Nylon, food wrappers, mixed', color: '#F0B000', hero: '#FFC21A', soft: '#FFF0B8' },
  recyclable: { label: 'Recyclables', long: 'Recyclables', hint: 'PET bottles, cans, paper', color: '#2F5BFF', hero: '#7B96FF', soft: '#E0E7FF' },
  organic: { label: 'Organic', long: 'Organic', hint: 'Food scraps, peels, leaves', color: '#1F9D5A', hero: '#5CD68C', soft: '#D4F2DD' },
};

export function timeOf(d) {
  return new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function dayKey(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function isToday(d) {
  return dayKey(d) === dayKey(new Date());
}

export function dayLabel(d) {
  const key = dayKey(d);
  if (key === dayKey(new Date())) return 'Today';
  if (key === dayKey(Date.now() - 864e5)) return 'Yesterday';
  const diff = (Date.now() - new Date(d).getTime()) / 864e5;
  if (diff < 7) return new Date(d).toLocaleDateString('en-NG', { timeZone: TZ, weekday: 'long' });
  return new Date(d).toLocaleDateString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short' });
}

export function whenLabel(d) {
  return isToday(d) ? timeOf(d) : `${dayLabel(d)}, ${timeOf(d)}`;
}

export function ago(d) {
  if (!d) return 'never';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(d) {
  if (!d) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const firstName = (n = '') => n.trim().split(/\s+/)[0] || '';
export const initials = (n = '') => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
export const kg = (n) => `${Math.round((n || 0) * 10) / 10} kg`;

export function todayLong() {
  return new Date().toLocaleDateString('en-NG', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' });
}

export function compStatus(c) {
  if (c.locked) return { text: c.lockReason === 'manual' ? 'Closed' : 'Locked', tone: 'locked' };
  if (c.fillPct >= c.nearFullThreshold) return { text: 'Near full', tone: 'near' };
  if (c.fillPct >= 50) return { text: 'Filling', tone: 'filling' };
  return { text: 'Open', tone: 'open' };
}

// Headline for the resident home screen, from the live compartments
export function headline(station) {
  if (!station) return ['Welcome to BioLoop.', 'Pick your bin to get started.'];
  const locked = station.compartments.filter((c) => c.locked);
  const enRoute = station.openPickups.find((p) => p.status === 'en_route');
  if (locked.length) {
    const names = locked.map((c) => STREAM[c.stream].label).join(' and ');
    return [`${names} ${locked.length > 1 ? 'are' : 'is'} full.`, enRoute ? 'Pickup is on the way.' : station.openPickups.length ? 'Pickup is scheduled.' : 'We have flagged it for pickup.'];
  }
  const near = station.compartments.filter((c) => c.fillPct >= c.nearFullThreshold);
  if (near.length) return [`${STREAM[near[0].stream].label} is almost full.`, 'Pickup has been requested.'];
  return ['All compartments open.', 'Sort and drop as usual.'];
}
