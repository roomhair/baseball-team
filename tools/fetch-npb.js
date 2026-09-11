#!/usr/bin/env node
/**
 * NPB公式（npb.jp）から年度別の個人成績を取ってきて data/<年度>/*.tsv を書き出す。
 *
 *   node tools/fetch-npb.js 2026                規定到達者だけ
 *   node tools/fetch-npb.js 2026 --full         球団別ページも辿って規定未満も拾う
 *   node tools/fetch-npb.js 2020-2026 --full    範囲でまとめて
 *   node tools/fetch-npb.js 1994 2005 2026      とびとびに
 *   node tools/fetch-npb.js 2026 --dry-run      ファイルを書かずに中身だけ見る
 *
 *   --full 時のふるい（少なすぎる成績はクイズにならないので既定で切る）
 *     --min-pa=100   打者の最低打席数（既定 100）
 *     --min-ip=20    投手の最低投球回（既定 20）
 *     --min-pa=0 --min-ip=0 と書けば全員入る
 *
 * そのあと
 *   node tools/build-players.js
 * を実行すると js/players-data.js に反映される。
 *
 * 【どこを見るか】
 * まず規定到達者の4ページを取る。
 *   <base>/<年度>/stats/bat_c.html  bat_p.html  pit_c.html  pit_p.html
 * --full を付けると、さらに年度の成績目次
 *   <base>/<年度>/stats/
 * を読み、そこに並んでいる球団別の個人成績ページへのリンクを辿る。
 * URLを決め打ちにすると公式の構成が変わったとき全滅するので、
 * 目次のリンクをたどる形にしてある。
 *
 * 【列の拾い方】
 * 見出しの文字（打率・本塁打・…）を見て拾うので、多少表の作りが変わっても動く。
 * 逆に見出しが変わると落ちる。そのときはエラーに実際の見出しを出すので、
 * COLUMNS の別名にその文字を足せばよい。
 * 球団別ページには「チーム」列が無いことがあるが、その場合はページの
 * 見出しやリンクの文字から球団を判別して補う。
 *
 * 依存パッケージなし。Node 18 以降（fetch を使う）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');

// テスト時にだけ差し替える（tools/test-fetch.js が使う）
const BASE_URL = process.env.NPB_BASE_URL || 'https://npb.jp/bis';

const DEBUG = process.argv.includes('--debug') || process.env.NPB_DEBUG === '1';

const WAIT_MS = 1200;   // 1ページごとの間隔。公式サーバに負担をかけないため
const MAX_PAGES = 60;   // 目次から辿るページ数の上限（暴走よけ）

const RANKED_PAGES = [
  { kind: 'batter',  file: 'bat_c.html', league: 'セ' },
  { kind: 'batter',  file: 'bat_p.html', league: 'パ' },
  { kind: 'pitcher', file: 'pit_c.html', league: 'セ' },
  { kind: 'pitcher', file: 'pit_p.html', league: 'パ' },
];

// 見出しの文字 → 出力する列。左から順に探して最初に見つかったものを使う。
const COLUMNS = {
  batter: [
    { out: '選手名', find: ['選手', '選手名'] },
    { out: 'チーム', find: ['チーム', '球団'], optional: true },
    { out: '打席',   find: ['打席'] },
    { out: '打率',   find: ['打率'] },
    { out: '本塁打', find: ['本塁打'] },
    { out: '打点',   find: ['打点'] },
    { out: '出塁率', find: ['出塁率'] },
    { out: '長打率', find: ['長打率'] },
  ],
  pitcher: [
    { out: '選手名', find: ['投手', '選手', '選手名'] },
    { out: 'チーム', find: ['チーム', '球団'], optional: true },
    { out: '登板',   find: ['試合', '登板'] },
    { out: '投球回', find: ['投球回'] },
    { out: '勝',     find: ['勝利', '勝'] },
    { out: '敗',     find: ['敗北', '敗戦', '敗'] },
    { out: '防御率', find: ['防御率'] },
    { out: '奪三振', find: ['奪三振', '三振'] },
  ],
};

// 球団の見分け方。
//   words … ページの見出しやリンクの文章から拾うときに使う（部分一致）
//   abbrs … 表の「チーム」欄の略称（完全一致）。1文字なので文章の走査には使わない
// 実際に id へ変換するのは tools/build-players.js。ここでは表記を canon にそろえる。
const TEAMS_META = [
  { canon: '巨人',         abbrs: ['巨'],             words: ['読売', 'ジャイアンツ', '巨人'] },
  { canon: '阪神',         abbrs: ['神'],             words: ['阪神', 'タイガース'] },
  { canon: '中日',         abbrs: ['中'],             words: ['中日', 'ドラゴンズ'] },
  { canon: 'DeNA',         abbrs: ['De', 'デ', 'ディ', '横', '洋'], words: ['ＤｅＮＡ', 'DeNA', 'ベイスターズ', '横浜', '大洋'] },
  { canon: 'ヤクルト',     abbrs: ['ヤ', '国'],       words: ['ヤクルト', 'スワローズ', '国鉄', 'サンケイ', 'アトムズ'] },
  { canon: '広島',         abbrs: ['広'],             words: ['広島', 'カープ'] },
  { canon: '日本ハム',     abbrs: ['日', '急'],       words: ['日本ハム', 'ファイターズ', '東映', '日拓'] },
  { canon: 'ロッテ',       abbrs: ['ロ', '毎'],       words: ['ロッテ', 'マリーンズ', 'オリオンズ', '毎日', '大毎'] },
  { canon: 'ソフトバンク', abbrs: ['ソ', 'ダ', '南'], words: ['ソフトバンク', 'ホークス', 'ダイエー', '南海'] },
  { canon: 'オリックス',   abbrs: ['オ', '急'],       words: ['オリックス', 'ブルーウェーブ', '阪急', 'ブレーブス'] },
  { canon: '近鉄',         abbrs: ['近'],             words: ['近鉄', 'バファロー'] },
  { canon: '楽天',         abbrs: ['楽'],             words: ['楽天', 'イーグルス'] },
  { canon: '西武',         abbrs: ['西', '鉄'],       words: ['西武', 'ライオンズ', '西鉄', 'クラウン', '太平洋'] },
];

const norm = (v) => String(v).normalize('NFKC').replace(/\s+/g, '');

// 「(ヤ)」のように括弧でくくられた略称も球団として引けるようにする
const teamKey = (v) => norm(v).replace(/^[（(]|[)）]$/g, '').toLowerCase();
const isTeam = (v) => !!v && teamAlias.has(teamKey(v));

// 「チーム」欄の文字を canon にそろえる。分からなければそのまま返す。
const teamAlias = new Map();
for (const t of TEAMS_META) {
  for (const k of [t.canon, ...t.abbrs, ...t.words]) teamAlias.set(norm(k).toLowerCase(), t.canon);
}
function canonicalTeam(raw) {
  return teamAlias.get(teamKey(raw)) || String(raw).trim();
}

// 「佐藤 輝明(神)」のように選手名の後ろに球団が付いている表があるので、切り分ける。
// 括弧の中が球団として読めるときだけ切る（登録名に括弧を含む選手を壊さないため）。
function splitNameTeam(raw) {
  const m = String(raw).trim().match(/^(.*\S)\s*[（(]([^（()）]+)[)）]$/);
  if (!m) return null;
  const team = teamAlias.get(norm(m[2]).toLowerCase());
  return team ? { name: m[1].trim(), team } : null;
}

// 見出しやリンクの文章から球団を推し量る（部分一致なので略称は使わない）
function detectTeam(...texts) {
  const hay = norm(texts.filter(Boolean).join(' '));
  for (const t of TEAMS_META) {
    if (t.words.some((w) => hay.includes(norm(w)))) return t.canon;
  }
  return null;
}

/* ---------- HTML の表を読む ---------- */

const stripTags = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/[　\s]+/g, ' ')
  .trim();

function tables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const rows = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = rowRe.exec(m[0]))) {
      const cells = [];
      const cellRe = /<(t[dh])\b[\s\S]*?<\/\1>/gi;
      let c;
      while ((c = cellRe.exec(r[0]))) cells.push(stripTags(c[0]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

// 見出し行らしき行を探して、必要な列の位置を割り出す。
// 見出しは「投 球 回」のように字間が空いていたり全角だったりするので、
// 空白と記号を落としてから比べ、完全一致 → 前方一致 の順に探す。
const headKey = (h) => String(h).normalize('NFKC').replace(/[\s.·・()（）]/g, '');

function locate(rows, spec) {
  const required = spec.filter((c) => !c.optional);
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const header = rows[i].map(headKey);
    const at = {};
    const taken = new Set();
    const claim = (col, idx) => { at[col.out] = idx; taken.add(idx); };

    for (const pass of ['exact', 'prefix']) {
      for (const col of spec) {
        if (at[col.out] !== undefined) continue;
        const idx = header.findIndex((h, n) => !taken.has(n) && h && col.find.some((f) => {
          const k = headKey(f);
          return pass === 'exact' ? h === k : h.startsWith(k);
        }));
        if (idx >= 0) claim(col, idx);
      }
    }
    const haveAll = required.every((c) => at[c.out] !== undefined);
    if (haveAll) return { headerRow: i, at, header: rows[i] };
  }
  return null;
}

// 古い年度は、見出しには無い球団の列がデータ行だけに入っている
//   見出し(24列): 順位 | 選手 | 打率 | 試合 | …
//   行  (25列): 2 | 山田 哲人 | (ヤ) | .329 | 143 | …
// 行のほうが1列多く、以降の値がすべて1つずれる。その列の位置を突き止めて、
// 読むときに抜き取ることで見出しと合わせる。
function findExtraTeamColumn(rows, headerRow, headerWidth) {
  const wide = rows.slice(headerRow + 1).filter((r) => r.length === headerWidth + 1);
  if (wide.length < 3) return undefined;

  let best = { idx: undefined, hits: 0 };
  for (let c = 0; c < headerWidth + 1; c++) {
    const hits = wide.filter((r) => isTeam(r[c])).length;
    if (hits > best.hits) best = { idx: c, hits };
  }
  // 過半数が球団として読めればその列。知らない略称が1球団あるだけで
  // 検出ごと失敗しないように、閾値は高くしすぎない。
  return best.hits > wide.length / 2 ? best.idx : undefined;
}

// 見出しで「チーム」列が見つからないとき、中身が球団名の列を探す。
// 見出しの文字が何であれ、値が球団名なら it はチーム列。
function findTeamColumn(rows, headerRow, at) {
  const taken = new Set(Object.values(at));
  const sample = rows.slice(headerRow + 1).filter((r) => r.length > 1).slice(0, 8);
  if (!sample.length) return undefined;

  let best = { idx: undefined, hits: 0 };
  const width = Math.max(...sample.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    if (taken.has(c)) continue;
    const hits = sample.filter((r) => isTeam(r[c])).length;
    if (hits > best.hits) best = { idx: c, hits };
  }
  return best.hits >= Math.ceil(sample.length * 0.8) ? best.idx : undefined;
}

// 1ページに表が複数あることがある（投手なら規定到達と救援など）。
// 条件に合う表はすべて読んで、まとめて返す。
function extract(html, kind, where, defaultTeam) {
  const spec = COLUMNS[kind];
  const candidates = tables(html);
  if (!candidates.length) throw new Error(`${where}: <table> がありません（ページの作りが変わった可能性）`);

  const matched = [];
  for (const rows of candidates) {
    const found = locate(rows, spec);
    if (found) matched.push({ rows, ...found });
  }
  if (!matched.length) {
    const seen = candidates.slice(0, 3).map((r) => r[0].join('|')).join(' / ');
    throw new Error(`${where}: 成績表を判別できません。` +
                    `見出しに「${spec.filter((c) => !c.optional).map((c) => c.find[0]).join('・')}」が必要です。` +
                    `実際の見出し: ${seen}`);
  }

  const out = [];
  const seenPlayers = new Set();
  const unknownTeams = new Set();
  let skewed = 0;

  for (const t of matched) {
    if (t.at['チーム'] === undefined) {
      const found = findTeamColumn(t.rows, t.headerRow, t.at);
      if (found !== undefined) t.at['チーム'] = found;
    }
    if (DEBUG) {
      const data = t.rows.slice(t.headerRow + 1);
      console.log(`\n    [debug] ${where} / 表${matched.indexOf(t) + 1}（${data.length}行）`);
      console.log(`    [debug] 見出し(${t.header.length}列): ${t.header.map((h, i) => `${i}:${h}`).join(' | ')}`);
      console.log(`    [debug] 対応: ${Object.entries(t.at).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      for (const r of data.slice(0, 3)) {
        console.log(`    [debug] 行(${r.length}列): ${r.map((v, i) => `${i}:${v}`).join(' | ')}`);
      }
    }

    const width = t.header.length;
    const extraTeamAt = findExtraTeamColumn(t.rows, t.headerRow, width);
    if (DEBUG) {
      const data = t.rows.slice(t.headerRow + 1);
      const hist = new Map();
      for (const r of data) hist.set(r.length, (hist.get(r.length) || 0) + 1);
      console.log(`    [debug] 見出しは${width}列。行の列数の内訳: ` +
                  [...hist].map(([n, c]) => `${n}列が${c}行`).join(' / '));
      const maxW = Math.max(...data.map((r) => r.length), 0);
      const hits = [];
      for (let c = 0; c < maxW; c++) {
        const n = data.filter((r) => isTeam(r[c])).length;
        if (n) hits.push(`${c}列目:${n}行`);
      }
      console.log(`    [debug] 球団として読めた列: ${hits.join(' / ') || 'なし'}`);
      console.log(`    [debug] 抜き取る列: ${extraTeamAt === undefined ? '検出できず' : extraTeamAt}`);
    }

    for (const raw of t.rows.slice(t.headerRow + 1)) {
      // 見出しに無い球団の列があれば抜き取って、見出しと同じ並びに戻す
      let cells = raw;
      let teamFromExtra = null;
      if (extraTeamAt !== undefined && raw.length === width + 1) {
        teamFromExtra = raw[extraTeamAt];
        cells = raw.slice(0, extraTeamAt).concat(raw.slice(extraTeamAt + 1));
      }

      // 列数が見出しと違う行は、値が1つずれて別の指標を拾ってしまうので使わない
      if (cells.length !== width) { skewed++; continue; }

      const rawName = cells[t.at['選手名']];
      if (!rawName || /^[\d\s.]*$/.test(rawName)) continue;   // 順位だけの行・空行

      // 選手名に球団が付いていれば切り離す。名前の見た目もそのぶん整う。
      const split = splitNameTeam(rawName);
      const name = split ? split.name : rawName.trim();
      const rawTeam = teamFromExtra
                    || (t.at['チーム'] !== undefined ? cells[t.at['チーム']] : null)
                    || (split ? split.team : defaultTeam);

      // 球団として読めない行は「チーム計」などの集計行。選手ではないので捨てる。
      if (!isTeam(rawTeam)) {
        if (rawTeam) unknownTeams.add(String(rawTeam).trim());
        continue;
      }
      const team = canonicalTeam(rawTeam);

      const key = `${norm(name)}/${team}`;
      if (seenPlayers.has(key)) continue;   // 同じページの別の表に重ねて載っている
      seenPlayers.add(key);

      const row = spec.map((c) => {
        if (c.out === '選手名') return name;
        if (c.out === 'チーム') return team;
        return (cells[t.at[c.out]] || '').trim();
      });
      if (row.some((v) => !v)) continue;   // 欠けている行は捨てる
      out.push(row);
    }
  }

  if (!out.length) {
    throw new Error(`${where}: 選手の行が1つも取れませんでした` +
                    (skewed ? `（列数が見出しと違う行が ${skewed} 行）` : '') +
                    (unknownTeams.size ? `（球団として読めない値: ${[...unknownTeams].join('、')}）` : ''));
  }
  if (unknownTeams.size) {
    console.warn(`    ${where}: 球団として読めず飛ばした値 → ${[...unknownTeams].slice(0, 8).join('、')}`);
  }
  if (skewed > out.length) {
    console.warn(`    ${where}: 列数の合わない行が ${skewed} 行あります。表の作りが変わったかもしれません`);
  }
  return out;
}

/* ---------- 取得 ---------- */

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'npb-statsquiz/1.0 (personal quiz site; data import)',
      'Accept': 'text/html',
    },
  });
  if (res.status === 404) throw new Error(`ページがありません (404): ${url}`);
  if (!res.ok) throw new Error(`取得できません (HTTP ${res.status}): ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  // 古い年度のページは Shift_JIS のことがあるので meta を見て切り替える
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = head.match(/charset\s*=\s*["']?\s*([\w-]+)/i);
  const charset = (m ? m[1] : 'utf-8').toLowerCase();
  const enc = /shift.?jis|sjis|windows-31j|ms932/.test(charset) ? 'shift_jis'
            : /euc/.test(charset) ? 'euc-jp'
            : 'utf-8';
  try {
    return new TextDecoder(enc).decode(buf);
  } catch (_) {
    return buf.toString('utf8');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 球団別ページを目次から見つける ---------- */

function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
            html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : '';
}

// 目次に並んでいる「球団別 個人打撃／個人投手成績」へのリンクを拾う
function findTeamPages(html, indexUrl) {
  const found = [];
  const seen = new Set();
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (!href || href.startsWith('#') || /^(mailto|javascript):/i.test(href)) continue;

    const hay = `${href} ${text}`.normalize('NFKC');
    const team = detectTeam(text) || detectTeam(href);
    if (!team) continue;

    let kind = null;
    if (/idb|打撃|打者/.test(hay)) kind = 'batter';
    else if (/idp|投手/.test(hay)) kind = 'pitcher';
    if (!kind) continue;

    let url;
    try { url = new URL(href, indexUrl).toString(); } catch (_) { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ url, kind, team, text });
  }
  return found.slice(0, MAX_PAGES);
}

/* ---------- 少なすぎる成績を落とす ---------- */

function passesFloor(kind, row, spec, opts) {
  const value = (name) => row[spec.findIndex((c) => c.out === name)];
  if (kind === 'batter') return Number(value('打席')) >= opts.minPa;
  const ip = String(value('投球回'));
  const m = ip.match(/^(\d+)(?:[.\s](\d))?/);   // 「150.1」「150 1/3」どちらでも概数でよい
  return (m ? Number(m[1]) : 0) >= opts.minIp;
}

/* ---------- 1年ぶん ---------- */

async function fetchYear(year, opts) {
  const collected = { batter: [], pitcher: [] };
  const keys = { batter: new Set(), pitcher: new Set() };
  const spec = COLUMNS;

  const add = (kind, rows, { floor }) => {
    let added = 0, dup = 0, thin = 0;
    for (const row of rows) {
      const key = `${norm(row[0])}/${canonicalTeam(row[1])}`;   // 選手名＋チーム
      if (keys[kind].has(key)) { dup++; continue; }
      if (floor && !passesFloor(kind, row, spec[kind], opts)) { thin++; continue; }
      keys[kind].add(key);
      collected[kind].push(row);
      added++;
    }
    return { added, dup, thin };
  };

  // 1. 規定到達者
  for (const page of RANKED_PAGES) {
    const url = `${BASE_URL}/${year}/stats/${page.file}`;
    const where = `${year}年 ${page.league}リーグ ${page.kind === 'batter' ? '打撃' : '投手'}`;
    process.stdout.write(`  ${where} ... `);
    const rows = extract(await fetchPage(url), page.kind, where);
    const { added } = add(page.kind, rows, { floor: false });
    console.log(`${added}人`);
    await sleep(WAIT_MS);
  }

  // 2. 球団別ページ（規定未満を含む）
  if (opts.full) {
    const indexUrl = `${BASE_URL}/${year}/stats/`;
    process.stdout.write(`  成績目次を確認 ... `);
    let pages = [];
    try {
      pages = findTeamPages(await fetchPage(indexUrl), indexUrl);
      console.log(`球団別ページ ${pages.length}件`);
    } catch (e) {
      console.log('取得できず');
      console.warn(`  目次を読めませんでした: ${e.message}`);
    }
    if (!pages.length) {
      console.warn('  球団別ページが見つからないため、規定到達者だけになります');
    }
    await sleep(WAIT_MS);

    for (const p of pages) {
      const where = `${year}年 ${p.team} ${p.kind === 'batter' ? '打撃' : '投手'}`;
      process.stdout.write(`  ${where} ... `);
      try {
        const html = await fetchPage(p.url);
        const team = detectTeam(p.text, pageTitle(html)) || p.team;
        const rows = extract(html, p.kind, where, team);
        const { added, dup, thin } = add(p.kind, rows, { floor: true });
        console.log(`+${added}人（規定到達と重複 ${dup} / 成績が少なく除外 ${thin}）`);
      } catch (e) {
        console.log('読めず');
        console.warn(`    ${e.message}`);
      }
      await sleep(WAIT_MS);
    }
  }

  // 3. 書き出し
  const dir = path.join(dataDir, String(year));
  for (const kind of ['batter', 'pitcher']) {
    const head = spec[kind].map((c) => c.out).join('\t');
    const body = collected[kind].map((r) => r.join('\t')).join('\n');
    const scope = opts.full
      ? `規定到達者＋球団別ページ（打席${opts.minPa}以上 / 投球回${opts.minIp}以上）`
      : '規定到達者';
    const text =
`# ${year}年 ${kind === 'batter' ? '打者' : '投手'}成績（${scope}）
# 出典: NPB.jp ${BASE_URL}/${year}/stats/
# tools/fetch-npb.js が取得: ${new Date().toISOString().slice(0, 10)}
# 手で直してもよいが、再取得すると上書きされる。
${head}
${body}
`;
    const file = path.join(dir, kind === 'batter' ? 'batters.tsv' : 'pitchers.tsv');
    if (opts.dryRun) {
      console.log(`  [dry-run] ${path.relative(root, file)} に ${collected[kind].length}行`);
      console.log(text.split('\n').slice(0, 9).map((l) => `    ${l}`).join('\n'));
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`  → ${path.relative(root, file)} (${collected[kind].length}人 / ${Math.floor(collected[kind].length / 10)}セット分)`);
    }
  }
}

/* ---------- 別ソースの下調べ ----------
   NPB公式の個人成績は2005年からで、2004年以前は404になる。
   代わりに使えるページを探すため、候補のURLを順に叩いて
   「成績表として読めるか」を報告する。書き込みはしない。   */

function probeCandidates(year) {
  return [
    // baseball-data.com は2桁年の年度別アーカイブを持つ（例 2009年 → /09/）。
    // どこまで遡れるか、OPS（出塁率・長打率）が取れるかを確かめる。
    `https://baseball-data.com/09/stats/hitter-ce/`,
    `https://baseball-data.com/04/stats/hitter-ce/`,
    `https://baseball-data.com/00/stats/hitter-ce/`,
    `https://baseball-data.com/04/stats/pitcher-ce/`,
    `https://baseball-data.com/04/`,
  ];
}

async function probe(year) {
  console.log(`\n===== ${year}年 使えるページを探す =====`);
  for (const url of probeCandidates(year)) {
    process.stdout.write(`\n[${url}]\n`);
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.log(`  ✗ ${e.message.replace(url, '').trim()}`);
      await sleep(WAIT_MS);
      continue;
    }
    console.log(`  ○ ${html.length}文字 / タイトル: ${pageTitle(html).slice(0, 60)}`);

    for (const kind of ['batter', 'pitcher']) {
      const found = tables(html)
        .map((rows) => ({ rows, at: locate(rows, COLUMNS[kind]) }))
        .filter((t) => t.at);
      if (found.length) {
        const t = found[0];
        console.log(`  → ${kind === 'batter' ? '打撃' : '投手'}として読める表 ${found.length}個 ` +
                    `(最大${Math.max(...found.map((f) => f.rows.length))}行)`);
        console.log(`     見出し: ${t.rows[t.at.headerRow].join(' | ')}`);
        const first = t.rows[t.at.headerRow + 1];
        if (first) console.log(`     1行目 : ${first.join(' | ')}`);
      }
    }

    // 年度らしき数字を含むリンクを拾って、過去年のURLの形を探す
    const links = [...html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ href: m[1], text: stripTags(m[2]) }))
      .filter((l) => /(19[3-9]\d|20[0-2]\d)/.test(l.href + l.text))
      .filter((l) => !/^(\/w\/|https?:\/\/[a-z-]+\.wikipedia)/.test(l.href));
    const seenHref = new Set();
    const uniq = links.filter((l) => !seenHref.has(l.href) && seenHref.add(l.href));
    if (uniq.length) {
      console.log(`  → 年度を含むリンク ${uniq.length}件（先頭12件）:`);
      for (const l of uniq.slice(0, 20)) {
        console.log(`     ${l.text.slice(0, 24).padEnd(24)} → ${l.href.slice(0, 70)}`);
      }
    }
    await sleep(WAIT_MS);
  }
  console.log(`\n===== 探索おわり =====`);
}

/* ---------- dataset.json の更新 ---------- */

// 日本時間の「2026年8月29日」
function todayJst() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function updateDataset(year) {
  const file = path.join(dataDir, 'dataset.json');
  let conf = {};
  try { conf = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* 無ければ作る */ }

  const next = {
    ...conf,
    asOf: `${todayJst()}時点`,
    source: { name: 'NPB.jp（日本野球機構）', url: `https://npb.jp/bis/${year}/stats/` },
  };
  if (next.yearRange === undefined) next.yearRange = [1936, year];
  else if (Array.isArray(next.yearRange) && next.yearRange[1] < year) next.yearRange = [next.yearRange[0], year];

  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`  → data/dataset.json を更新（${next.asOf} / 出典 ${next.source.name}）`);
}

/* ---------- 引数 ---------- */

function parseArgs(argv) {
  const opts = { full: false, dryRun: false, probe: false, minPa: 100, minIp: 20 };
  const years = [];

  for (const a of argv) {
    if (a === '--full' || a === '--all') { opts.full = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--debug') continue;   // DEBUG で直接見ている
    if (a === '--probe') { opts.probe = true; continue; }
    let m = a.match(/^--min-pa=(\d+)$/);
    if (m) { opts.minPa = Number(m[1]); continue; }
    m = a.match(/^--min-ip=(\d+)$/);
    if (m) { opts.minIp = Number(m[1]); continue; }
    if (a.startsWith('--')) throw new Error(`知らないオプションです: ${a}`);

    m = a.match(/^(\d{4})-(\d{4})$/);
    if (m) {
      const [lo, hi] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
      for (let y = lo; y <= hi; y++) years.push(y);
      continue;
    }
    if (/^\d{4}$/.test(a)) { years.push(Number(a)); continue; }
    throw new Error(`年度として読めません: "${a}"`);
  }
  opts.years = [...new Set(years)].sort((a, b) => a - b);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.years.length) {
    console.error('使い方: node tools/fetch-npb.js <年度> [年度...] [--full] [--dry-run]');
    console.error('  例: node tools/fetch-npb.js 2026 --full');
    console.error('      node tools/fetch-npb.js 2015-2026 --full --min-pa=150');
    process.exit(1);
  }

  if (opts.probe) {
    for (const year of opts.years) await probe(year);
    process.exit(0);
  }

  const failed = [];
  const got = [];
  for (const year of opts.years) {
    console.log(`${year}年:`);
    try {
      await fetchYear(year, opts);
      got.push(year);
    } catch (e) {
      console.error(`  取得に失敗: ${e.message}`);
      failed.push(year);
    }
  }

  // 取得できたので、日付と出典を書き換える
  if (got.length && !opts.dryRun) updateDataset(Math.max(...got));

  if (failed.length) {
    console.error(`\n失敗した年度: ${failed.join(', ')}`);
    console.error('古い年度は公式サイトにページが無いことがあります。' +
                  'その場合は成績表を手で data/<年度>/*.tsv に貼ってください。');
  }
  if (failed.length < opts.years.length && !opts.dryRun) {
    console.log('\n続けて次を実行してください: node tools/build-players.js');
  }
  process.exit(failed.length === opts.years.length ? 1 : 0);
}

main().catch((e) => { console.error(`エラー: ${e.message}`); process.exit(1); });
