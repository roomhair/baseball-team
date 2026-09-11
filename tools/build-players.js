#!/usr/bin/env node
/**
 * data/ の中身を読んで、ゲームが使う js/players-data.js を書き出す。
 *
 *   node tools/build-players.js
 *
 * 【入力】
 *   data/<年度>/batters.tsv   NPB公式の打者成績（tools/fetch-npb.js が取得）
 *   data/<年度>/pitchers.tsv  NPB公式の投手成績（同上）
 *   data/positions.tsv        選手名 → 主ポジション（手で育てる表）
 *   data/twoway.tsv           二刀流選手（投打の両方をここに書く）
 *   data/ages.tsv             選手名 → 生まれた年（任意）
 *   data/dataset.json         出典・年度範囲などのメタ情報
 *
 * 【出力】
 *   js/players-data.js        window.PLAYERS_DATA に入る選手データ
 *   data/players.json         同じ内容のJSON（中身を見たいとき用。ゲームは読まない）
 *
 * 【方針】
 * ・成績の数字はNPB公式の実データをそのまま使う（改変しない）
 * ・「打撃力」「走力」「守備力」「投手力」はこのゲーム独自の指標で、
 *   下の SCORE の計算式だけを直せば全体が変わる
 * ・守備位置が分からない野手は登場させない（間違ったデータを出さないため）
 *
 * 依存パッケージなし。Node 18 以降。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');

const POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];

/* 年齢が分からない選手を、データに初めて出てきた年に何歳だったとみなすか */
const ASSUMED_DEBUT_AGE = 23;


/* ============================================================
   評価の計算式（ここだけ直せば強さのバランスが変わる）
   ============================================================ */

const SCORE = {

  /* --- 打撃力: OPS（出塁率＋長打率）から --- */
  batting(obp, slg) {
    const ops = obp + slg;
    return clamp(Math.round((ops - 0.600) / 0.400 * 30 + 40), 20, 100);
  },

  /* --- 長打力: 550打席あたりの本塁打から --- */
  power(hr, pa) {
    const per550 = pa > 0 ? hr / pa * 550 : 0;
    return clamp(Math.round(20 + per550 * 2.1), 20, 100);
  },

  /* --- 走力: 公式成績に盗塁が無いため、守備位置と打球傾向からの「推定値」 --- */
  run(pos, avg, slg) {
    const base = {
      '中': 78, '遊': 72, '二': 70, '左': 58, '右': 58,
      '三': 52, '一': 40, '捕': 35, '投': 40,
    }[pos] ?? 50;
    const iso = slg - avg;
    const adj = clamp(Math.round((0.150 - iso) * 80), -12, 12);
    return clamp(base + adj, 15, 99);
  },

  /* --- 守備力: 守備位置の難しさ＋足の速さから（こちらも推定値） --- */
  fielding(pos, run) {
    const base = {
      '捕': 80, '遊': 78, '中': 74, '二': 72, '三': 68,
      '右': 64, '左': 58, '一': 50, '投': 60,
    }[pos] ?? 55;
    return clamp(Math.round(base + (run - 60) * 0.15), 30, 99);
  },

  /* --- 投手力: 防御率・奪三振率・投球回から --- */
  pitching(era, ip, k, isStarter) {
    const eraScore = clamp(120 - era * 20, 20, 100);
    const k9 = ip > 0 ? k / ip * 9 : 0;
    const kScore = clamp((k9 - 4) * 10 + 40, 20, 100);
    const ipScore = isStarter
      ? clamp(ip / 180 * 100, 20, 100)
      : clamp(ip / 70 * 100, 20, 100);
    return clamp(Math.round(eraScore * 0.5 + kScore * 0.25 + ipScore * 0.25), 20, 100);
  },

  overallBatter(bat, field, run) {
    return clamp(Math.round(bat * 0.60 + field * 0.25 + run * 0.15), 20, 100);
  },
  overallPitcher(pitch) {
    return pitch;
  },
};

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }


/* ============================================================
   ファイルの読み込み
   ============================================================ */

function readTsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(function (line) { return line.trim() !== '' && !line.startsWith('#'); });
  if (lines.length === 0) return [];

  const header = lines[0].split('\t');
  return lines.slice(1).map(function (line) {
    const cells = line.split('\t');
    const row = {};
    header.forEach(function (key, i) { row[key.trim()] = (cells[i] || '').trim(); });
    return row;
  });
}

function num(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().replace(/,/g, '');
  if (t === '' || t === '-' || t === '－') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 投球回の「158.1」は158回1/3という意味なので、正しく小数に直す。 */
function innings(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d+)\.(\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 3;
  return num(t) ?? 0;
}

function nameKey(name) {
  return String(name).replace(/[\s　]+/g, ' ').trim();
}


/* ============================================================
   選手1人ぶんのデータを作る部品
   ============================================================ */

function batterRatings(pos, row) {
  const pa  = num(row['打席']) ?? 0;
  const avg = num(row['打率']) ?? 0;
  const hr  = num(row['本塁打']) ?? 0;
  const rbi = num(row['打点']) ?? 0;
  const obp = num(row['出塁率']) ?? 0;
  const slg = num(row['長打率']) ?? 0;

  const bat   = SCORE.batting(obp, slg);
  const power = SCORE.power(hr, pa);
  const run   = SCORE.run(pos, avg, slg);
  const field = SCORE.fielding(pos, run);

  return {
    r: { bat: bat, power: power, run: run, field: field },
    ovr: SCORE.overallBatter(bat, field, run),
    pa: pa,
    // 計算に使う数値（画面表示用の s とは別に、生の数字で持っておく）
    n: { pa: pa, avg: avg, hr: hr, rbi: rbi, obp: obp, slg: slg },
    s: {
      打率: row['打率'], 本塁打: hr, 打点: rbi,
      出塁率: row['出塁率'], 長打率: row['長打率'],
      OPS: (obp + slg).toFixed(3).replace(/^0/, ''),
    },
  };
}

function pitcherRatings(row) {
  const g   = num(row['登板']) ?? 0;
  const ip  = innings(row['投球回']);
  const w   = num(row['勝']) ?? 0;
  const l   = num(row['敗']) ?? 0;
  const era = num(row['防御率']) ?? 9.99;
  const k   = num(row['奪三振']) ?? 0;

  const isStarter = g > 0 && (ip / g) >= 3;
  const pitch = SCORE.pitching(era, ip, k, isStarter);

  return {
    pitch: pitch,
    ovr: SCORE.overallPitcher(pitch),
    role: isStarter ? '先発' : '救援',
    ip: ip,
    n: { g: g, ip: ip, w: w, l: l, era: era, k: k },
    s: {
      防御率: row['防御率'], 勝敗: w + '勝' + l + '敗',
      投球回: row['投球回'], 奪三振: k, 登板: g,
    },
  };
}


/* ============================================================
   組み立て
   ============================================================ */

function build() {
  // --- 主ポジションの対応表 ---
  const posMap = new Map();
  readTsv(path.join(dataDir, 'positions.tsv')).forEach(function (row) {
    const name = nameKey(row['選手名']);
    const pos = (row['主ポジション'] || '').trim();
    if (!name || !pos) return;
    if (!POSITIONS.includes(pos)) {
      throw new Error('data/positions.tsv に知らないポジション記号: "' + pos + '" (' + name + ')');
    }
    const sub = (row['副ポジション'] || '').split(/[,、\s]+/)
      .filter(function (p) { return POSITIONS.includes(p); });
    posMap.set(name, { pos: pos, sub: sub });
  });

  // --- 生まれた年 ---
  const birthMap = new Map();
  readTsv(path.join(dataDir, 'ages.tsv')).forEach(function (row) {
    const name = nameKey(row['選手名']);
    const y = num(row['生まれた年']);
    if (name && y) birthMap.set(name, y);
  });

  // --- 二刀流 ---
  const twoWayRows = readTsv(path.join(dataDir, 'twoway.tsv'));
  const twoWayKeys = new Set(twoWayRows.map(function (r) {
    return nameKey(r['選手名']) + '@' + r['年度'];
  }));

  // --- 年度フォルダ ---
  const years = fs.readdirSync(dataDir)
    .filter(function (d) { return /^\d{4}$/.test(d); }).sort();

  // --- 先に「その選手がデータに初めて出てきた年」を数える ---
  const debut = new Map();
  const noteYear = function (name, y) {
    const cur = debut.get(name);
    if (cur === undefined || y < cur) debut.set(name, y);
  };
  years.forEach(function (year) {
    const y = Number(year);
    readTsv(path.join(dataDir, year, 'batters.tsv')).forEach(function (r) { noteYear(nameKey(r['選手名']), y); });
    readTsv(path.join(dataDir, year, 'pitchers.tsv')).forEach(function (r) { noteYear(nameKey(r['選手名']), y); });
  });
  twoWayRows.forEach(function (r) { noteYear(nameKey(r['選手名']), Number(r['年度'])); });

  /**
   * 年齢とキャリア年数を付ける。
   *
   * NPB公式の個人成績には生年月日が無いので、
   *   ・data/ages.tsv に書いてあれば、その生まれた年から正確に計算する
   *   ・書いていなければ「データに初めて出てきた年に23歳だった」とみなす（推定）
   * ただし、データのいちばん古い年（2005年）に初登場している選手は、
   * それ以前から活躍していた可能性が高く推定できない。その場合は age を null にする。
   */
  const firstYear = Number(years[0]);
  const career = function (name, year) {
    const d = debut.get(name) ?? year;
    const birth = birthMap.get(name);

    if (birth) {
      return { d: d, car: year - d + 1, age: year - birth, ageEst: 0 };
    }
    if (d <= firstYear) {
      // データの最初の年からいる＝何年目か分からない
      return { d: d, car: year - d + 1, age: null, ageEst: 2 };
    }
    return {
      d: d,
      car: year - d + 1,
      age: ASSUMED_DEBUT_AGE + (year - d),
      ageEst: 1,
    };
  };

  const players = [];
  const missing = new Map();
  let idSeq = 0;

  // --- 二刀流（通常データより先に作る） ---
  twoWayRows.forEach(function (row) {
    const name = nameKey(row['選手名']);
    const year = Number(row['年度']);
    const pos = (row['野手ポジション'] || '').trim();
    if (!name || !year || !POSITIONS.includes(pos)) return;

    const bat = batterRatings(pos, row);
    const pit = pitcherRatings(row);
    const c = career(name, year);

    players.push({
      id: 't' + (++idSeq),
      name: name, team: row['チーム'] || '', year: year,
      kind: 'twoway',
      pos: pos,
      role: pit.role,
      age: c.age, ageEst: c.ageEst, d: c.d, car: c.car,
      pa: bat.pa, ip: pit.ip,
      n: bat.n, np: pit.n,
      r: {
        bat: bat.r.bat, power: bat.r.power, run: bat.r.run,
        field: bat.r.field, pitch: pit.pitch,
      },
      ovr: Math.max(bat.ovr, pit.ovr),
      ovrBat: bat.ovr,
      ovrPit: pit.ovr,
      s: bat.s,
      sp: pit.s,
    });
  });

  // --- 通常の選手 ---
  years.forEach(function (year) {
    const y = Number(year);

    readTsv(path.join(dataDir, year, 'batters.tsv')).forEach(function (row) {
      const name = nameKey(row['選手名']);
      if (!name) return;
      if (twoWayKeys.has(name + '@' + y)) return;   // 二刀流として作成済み

      const entry = posMap.get(name);
      if (!entry) { missing.set(name, (missing.get(name) || 0) + 1); return; }

      const bat = batterRatings(entry.pos, row);
      const c = career(name, y);

      const rec = {
        id: 'b' + (++idSeq),
        name: name, team: row['チーム'] || '', year: y,
        kind: 'batter',
        pos: entry.pos,
        age: c.age, ageEst: c.ageEst, d: c.d, car: c.car,
        pa: bat.pa,
        n: bat.n,
        r: { bat: bat.r.bat, power: bat.r.power, run: bat.r.run, field: bat.r.field, pitch: 0 },
        ovr: bat.ovr,
        s: bat.s,
      };
      if (entry.sub.length > 0) rec.sub = entry.sub;
      players.push(rec);
    });

    readTsv(path.join(dataDir, year, 'pitchers.tsv')).forEach(function (row) {
      const name = nameKey(row['選手名']);
      if (!name) return;
      if (twoWayKeys.has(name + '@' + y)) return;   // 二刀流として作成済み

      const pit = pitcherRatings(row);
      const run = SCORE.run('投', 0, 0);
      const c = career(name, y);

      players.push({
        id: 'p' + (++idSeq),
        name: name, team: row['チーム'] || '', year: y,
        kind: 'pitcher',
        pos: '投',
        role: pit.role,
        age: c.age, ageEst: c.ageEst, d: c.d, car: c.car,
        ip: pit.ip,
        np: pit.n,
        r: { bat: 12, power: 20, run: run, field: SCORE.fielding('投', run), pitch: pit.pitch },
        ovr: pit.ovr,
        sp: pit.s,
        s: pit.s,
      });
    });
  });

  return { players: players, years: years, missing: missing };
}


/* ============================================================
   書き出し
   ============================================================ */

function main() {
  const result = build();
  const players = result.players;

  if (players.length === 0) {
    console.error('選手が1人も作れませんでした。data/ の中身を確認してください。');
    process.exit(1);
  }

  let meta = {};
  const metaFile = path.join(dataDir, 'dataset.json');
  if (fs.existsSync(metaFile)) meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

  const payload = {
    builtAt: new Date().toISOString().slice(0, 10),
    source: meta.source || null,
    asOf: meta.asOf || null,
    years: result.years.map(Number),
    positions: POSITIONS,
    players: players,
  };

  const jsDir = path.join(root, 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(jsDir, 'players-data.js'),
    '/* 自動生成ファイル。直接編集しないこと。\n' +
    '   作り直すには:  node tools/build-players.js  */\n' +
    "'use strict';\n" +
    'window.PLAYERS_DATA = ' + JSON.stringify(payload) + ';\n');

  fs.writeFileSync(path.join(dataDir, 'players.json'), JSON.stringify(payload, null, 1));

  const byKind = { batter: 0, pitcher: 0, twoway: 0 };
  const byPos = {};
  POSITIONS.forEach(function (p) { byPos[p] = 0; });
  players.forEach(function (p) { byKind[p.kind]++; byPos[p.pos]++; });

  console.log('選手データを作りました: ' + players.length + '人ぶん');
  console.log('  年度: ' + result.years[0] + '〜' + result.years[result.years.length - 1]);
  console.log('  種別: 野手 ' + byKind.batter + ' / 投手 ' + byKind.pitcher + ' / 二刀流 ' + byKind.twoway);
  console.log('  守備: ' + POSITIONS.map(function (p) { return p + ' ' + byPos[p]; }).join(' / '));
  console.log('  → js/players-data.js');
  console.log('  → data/players.json');

  if (result.missing.size > 0) {
    console.log('');
    console.log('※ 守備位置が分からないので登場しない野手が ' + result.missing.size + '人 います。');
    console.log('  data/positions.tsv に追記すると登場するようになります:');
    Array.from(result.missing.keys()).sort().forEach(function (n) { console.log('    ' + n); });
  }
}

main();
