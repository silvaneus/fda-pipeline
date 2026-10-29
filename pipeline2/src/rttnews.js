// RTTNews FDA calendar, reusing the current tracker's parser so the two never drift apart.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'state', 'rttnews.json');
const require = createRequire(import.meta.url);
const { fetchPage, parseRows } = require(path.join(ROOT, '..', 'scrape-rttnews.js'));

export async function scrapeRTTNews() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const rows = parseRows(await fetchPage(page));
    if (!rows.length) break;
    all.push(...rows);
    await new Promise(r => setTimeout(r, 400));
  }
  const seen = new Set();
  const entries = all.filter(e => {
    const k = `${e.pdufaDate}|${e.drug}|${e.company}`;
    return !seen.has(k) && seen.add(k);
  });
  // A sharply smaller scrape is a broken page, not an emptied calendar: keep the last good one.
  if (prev && entries.length < prev.entries.length * 0.6) {
    console.warn(`RTTNews returned ${entries.length} entries (was ${prev.entries.length}); keeping previous data`);
    return prev.entries;
  }
  fs.writeFileSync(OUT, JSON.stringify({ scrapedAt: new Date().toISOString(), entries }, null, 1));
  return entries;
}

export function loadRTTNews() {
  return fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).entries : [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const e = await scrapeRTTNews();
  console.log(`${e.length} entries, ${e.filter(x => x.status === 'Pending').length} pending`);
}
