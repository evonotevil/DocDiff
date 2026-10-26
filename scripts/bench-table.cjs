// 把 bench-174 的 JSON 汇总成表：node scripts/bench-table.cjs <目录>...
const fs = require('fs'), path = require('path');
for (const dir of process.argv.slice(2)) {
  console.log(`\n## ${dir}`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
    if (!d.summary) continue;
    console.log(`\n${f}  v${d.version}  runs=${d.runs.length}  ${d.runs[0].pos}  map ticks=${d.runs[0].map.ticks}${d.runs[0].map.dense ? ' dense' : ''}`);
    const fm = (s) => (s ? `${s.median}${s.min !== s.max ? ` (${s.min}–${s.max})` : ''}` : '-');
    console.log('phase | elapsed | settle | longest | p95gap | maxgap | dom | queries | queryMs');
    for (const [k, s] of Object.entries(d.summary)) if (s.elapsedMs) console.log(`${k} | ${fm(s.elapsedMs)} | ${fm(s.settleMs)} | ${fm(s.longestMs)} | ${fm(s.p95GapMs)} | ${fm(s.maxGapMs)} | ${fm(s.domNodes)} | ${fm(s.queries)} | ${fm(s.queryMs)}`);
    console.log(`scroll p95 ${d.summary.scroll.p95GapMs} max ${d.summary.scroll.maxGapMs}; renderer ${d.summary.mem.rendererMB} MB; heap after GC ${d.summary.mem.heapAfterGcMB} MB; errors ${d.runs.flatMap((r) => r.errors).length}`);
  }
}
