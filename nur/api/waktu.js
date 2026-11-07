// Prayer times for Malaysia (JAKIM zones). Proxies api.waktusolat.app, falls back to JAKIM e-Solat.
const UP = "https://api.waktusolat.app";
const isZone = (z) => typeof z === "string" && /^[A-Z]{3}\d{2}$/.test(z);
const pad = (n) => String(n).padStart(2, "0");
const mytParts = (ms) => { const d = new Date(ms + 8 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() }; };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toHM(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{9,}$/.test(String(v))) { const p = mytParts(Number(v) * (Number(v) < 1e11 ? 1000 : 1)); return `${pad(p.hh)}:${pad(p.mm)}`; }
  const m = String(v).match(/(\d{1,2}):(\d{2})/); return m ? `${pad(+m[1])}:${m[2]}` : null;
}
function toDate(entry, year, month, idx) {
  const v = entry.date ?? entry.day;
  if (typeof entry.fajr === "number" || /^\d{9,}$/.test(String(entry.fajr))) { const p = mytParts(Number(entry.fajr) * (Number(entry.fajr) < 1e11 ? 1000 : 1)); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  if (typeof v === "string") {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/); if (m) return `${m[3]}-${pad(MON[m[2].toLowerCase()])}-${pad(+m[1])}`;
  }
  if (year && month) return `${year}-${pad(month)}-${pad(typeof v === "number" ? v : idx + 1)}`;
  return null;
}
function normalize(j, zone) {
  const list = j.prayers || j.prayerTime || j.prayer_times || [];
  if (!Array.isArray(list) || !list.length) return null;
  const days = list.map((e, i) => ({
    date: toDate(e, j.year, j.month, i), hijri: e.hijri || null,
    imsak: toHM(e.imsak), fajr: toHM(e.fajr), syuruk: toHM(e.syuruk), dhuhr: toHM(e.dhuhr), asr: toHM(e.asr), maghrib: toHM(e.maghrib), isha: toHM(e.isha)
  })).filter((d) => d.date && d.fajr && d.isha);
  return days.length ? { zone: j.zone || zone, days } : null;
}
async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "NurKids/1.0", Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const q = req.query || {};
  try {
    if (q.zones !== undefined) {
      const z = await getJson(`${UP}/zones`);
      res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
      return res.status(200).json({ zones: (Array.isArray(z) ? z : []).map((x) => ({ code: x.jakimCode || x.code, state: x.negeri || x.state, area: x.daerah || x.area })).filter((x) => isZone(x.code)) });
    }
    if (q.lat !== undefined && q.lng !== undefined) {
      const lat = Number(q.lat), lng = Number(q.lng);
      if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: "bad_location" });
      let found = null;
      for (const u of [`${UP}/zones/${lat}/${lng}`, `${UP}/zones/gps?lat=${lat}&long=${lng}`]) {
        try { const j = await getJson(u); const code = j.zone || j.jakimCode || (j.data && (j.data.zone || j.data.jakimCode)); if (isZone(code)) { found = { code, state: j.state || j.negeri || null, area: j.district || j.daerah || null }; break; } } catch (e) {}
      }
      if (!found) return res.status(404).json({ error: "zone_not_found" });
      return res.status(200).json(found);
    }
    const zone = String(q.zone || "").toUpperCase();
    if (!isZone(zone)) return res.status(400).json({ error: "bad_zone" });
    let out = null, source = "waktusolat";
    try { out = normalize(await getJson(`${UP}/v2/solat/${zone}`), zone); } catch (e) {}
    if (!out) {
      source = "jakim";
      try { out = normalize(await getJson(`https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=month&zone=${zone}`), zone); } catch (e) {}
    }
    if (!out) return res.status(502).json({ error: "times_unavailable" });
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ ...out, source });
  } catch (e) {
    return res.status(500).json({ error: "times_unavailable" });
  }
}
