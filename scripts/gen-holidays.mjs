// 生成对对节日用的日期表（1.9 · M9）：2026–2036 年里每年日期不固定的节日。
// 农历、希伯来历、伊斯兰历用 Node 的 ICU 日历换算；印度历的洒红节、排灯节和卫塞节按新月 / 满月的天文时刻推算
// （Meeus《天文算法》第 49 章，误差几分钟），复活节用格里历计算法。节日对对本来就前后各留一天，差一天也不要紧。
// 用法：node scripts/gen-holidays.mjs > renderer/src/lib/mascot/holidays.data.ts
const Y0 = 2026, Y1 = 2036;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// ---- 历法换算：找某历法下某月某日对应的公历日期 ----
function findDay(year, cal, test, from = `${year}-01-01`, to = `${year}-12-31`) {
  const f = new Intl.DateTimeFormat('en-u-ca-' + cal, { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const out = [];
  for (let d = new Date(from + 'T12:00:00Z'); ymd(d) <= to; d = new Date(d.getTime() + 86400000)) {
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    if (test(p, d)) out.push(ymd(d));
  }
  return out;
}
// 农历：month 是 “1” .. “12”，闰月是 “4bis” 之类
// ICU 的农历在新月刚好落在北京时间午夜前后时会差一天（如 2027、2030 年春节），所以月初再用天文新月（北京时间）校正
const icuLunar = (y, m, day) => findDay(y, 'chinese', (p) => p.month === String(m) && +p.day === day)[0];
function lunar(y, m, day) {
  const first = icuLunar(y, m, 1);
  const nms = [y - 1, y, y + 1].flatMap((yy) => phasesTZ(yy, false, 8));
  const near = nms.find((d) => Math.abs(Date.parse(d) - Date.parse(first)) <= 2 * 86400000) || first;
  return ymd(new Date(Date.parse(near + 'T12:00:00Z') + (day - 1) * 86400000));
}
const hebrew = (y, mName, day) => findDay(y, 'hebrew', (p) => p.month === mName && +p.day === day)[0];
const islamic = (y, m, day) => findDay(y, 'islamic-umalqura', (p) => +p.month === m && +p.day === day)[0];

// ---- 复活节（格里历）----
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}

// ---- 月相（Meeus 49）：返回 JDE ----
const rad = Math.PI / 180;
function phaseJDE(k) {
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
  const full = Math.abs(k % 1) > 0.25;
  const c = full
    ? -0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F) + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M) + 0.00209 * E * E * Math.sin(2 * M) - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M) - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F) - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(Om)
    : -0.40720 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp) + 0.01039 * Math.sin(2 * F) + 0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M) + 0.00208 * E * E * Math.sin(2 * M) - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M) - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F) - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(Om);
  return jde + c;
}
// 按某个时区（小时）的日期；JDE 和 UT 差约 70 秒，忽略
function phasesTZ(y, full, tz) {
  const out = [];
  const k0 = Math.floor((y - 2000) * 12.3685) - 2;
  for (let k = k0; k < k0 + 16; k++) { const d = new Date((phaseJDE(k + (full ? 0.5 : 0)) - 2440587.5) * 86400000 + tz * 3600000); if (d.getUTCFullYear() === y) out.push(ymd(d)); }
  return out;
}
// 印度历的节日以印度标准时间（UTC+5:30）的日期为准
const phases = (y, full) => phasesTZ(y, full, 5.5);
const within = (ds, a, b) => ds.filter((d) => d >= a && d <= b);
const prevOf = (ds, d) => ds.filter((x) => x < d).pop();
const nextOf = (ds, d) => ds.find((x) => x > d);

const T = {};
for (let y = Y0; y <= Y1; y++) {
  const nm = phases(y, false), fm = phases(y, true);
  // 洒红节：太阳在双鱼宫（约 3/14–4/13）时的新月开始制呾罗月，它前面的那个满月就是颇勒窭拏月的满月
  const chaitra = within(nm, `${y}-03-14`, `${y}-04-13`)[0];
  const holi = prevOf(fm, chaitra);
  // 排灯节：太阳在天秤宫（约 10/17–11/16）时的新月
  const diwali = within(nm, `${y}-10-17`, `${y}-11-15`)[0];
  // 卫塞节：太阳在白羊宫（约 4/14–5/14）时的新月之后的那个满月
  const vesak = nextOf(fm, within(nm, `${y}-04-14`, `${y}-05-14`)[0]);
  T[y] = {
    springFestival: lunar(y, 1, 1), lantern: lunar(y, 1, 15), dragonBoat: lunar(y, 5, 5), qixi: lunar(y, 7, 7), midAutumn: lunar(y, 8, 15),
    easter: easter(y), holi, eid: islamic(y, 10, 1), vesak, diwali, hanukkah: hebrew(y, 'Kislev', 25),
  };
}
const lines = Object.entries(T).map(([y, v]) => `  ${y}: ${JSON.stringify(v)},`).join('\n');
console.log(`// 由 scripts/gen-holidays.mjs 生成，不要手改。每年日期不固定的节日（公历 YYYY-MM-DD）。\nexport const MOVABLE: Record<number, Record<string, string>> = {\n${lines}\n};`);
