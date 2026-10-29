// One command: sync MJH articles from Sanity, rebuild the pipeline, measure coverage, render the report.
//   node run.js            full run
//   node run.js --no-sync  rebuild from cached articles only
import { syncAll } from './src/sanity.js';
import { buildPipeline } from './src/build.js';
import { measure } from './src/coverage.js';
import { renderReport } from './src/report.js';
import { scrapeRTTNews } from './src/rttnews.js';
import { mergeSources } from './src/merge.js';

const t0 = Date.now();
if (!process.argv.includes('--no-sync')) {
  for (const r of await syncAll()) console.log(`sync ${r.brand}: +${r.added} new, ${r.changed} edited, ${r.total} total`);
}
if (!process.argv.includes('--no-sync')) {
  try { console.log(`RTTNews: ${(await scrapeRTTNews()).length} entries`); } catch (e) { console.warn(`RTTNews scrape failed, using last good copy: ${e.message}`); }
}
const pipe = await buildPipeline();
const st = {};
for (const a of pipe.applications) st[a.status] = (st[a.status] || 0) + 1;
console.log('applications:', st);
try {
  const cov = await measure();
  console.log('coverage vs current tracker:', cov.tracker['all listed']);
} catch (e) {
  console.warn(`coverage skipped: ${e.message}`);
}
const merged = await mergeSources();
const by = {};
for (const x of merged.rows) by[x.origin] = (by[x.origin] || 0) + 1;
console.log('combined list:', by, `| ${merged.removed.length} RTTNews entries removed as already decided, ${merged.excluded.length} generics excluded`);
console.log(`report: ${renderReport()}  (${Math.round((Date.now() - t0) / 1000)}s)`);
