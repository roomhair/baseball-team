#!/usr/bin/env node
/**
 * tools/fetch-npb.js の読み取りを、手元に立てたサーバで確かめる。
 *   node tools/test-fetch.js
 *
 * npb.jp に似せたページ（規定到達者の一覧・成績目次・球団別ページ）を返して、
 * 列の対応づけ、目次からのリンク辿り、重複の除去、成績が少ない選手のふるい、
 * 書き出しが意図どおりかを見る。実際の npb.jp への通信は確かめられない。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

/* ---------- npb.jp に似せたページ ----------
   実物に合わせてある。規定到達者の一覧には「チーム」列が無く、
   選手名のセルが「佐藤 輝明(神)」の形で球団を抱えている。          */

// 打撃：チーム列なし・選手名に球団入り（実物と同じ作り）
const BAT_HEAD = ['順位', '選手', '打率', '試合', '打席', '打数', '得点', '安打', '二塁打', '三塁打', '本塁打', '塁打', '打点', '盗塁', '盗塁刺', '犠打', '犠飛', '四球', '故意四', '死球', '三振', '併殺打', '長打率', '出塁率'];
const BAT_RANKED = [
  ['1', '甲野 一朗(巨)', '.312', '128', '540', '470', '78', '147', '25', '2', '28', '260', '92', '5', '2', '0', '4', '62', '3', '4', '88', '9', '.553', '.392'],
  ['2', '乙川 二郎(神)', '.305', '130', '551', '482', '70', '147', '30', '1', '15', '224', '71', '12', '4', '1', '3', '61', '2', '4', '75', '11', '.465', '.383'],
];

// 投手：実物の見出し（「選手」ではなく「投手」、「敗戦」ではなく「敗北」）。
// チーム列は無く、選手名に球団が入る。
const PIT_HEAD = ['順位', '投手', '防御率', '登板', '勝利', '敗北', 'セーブ', 'ホールド', 'ＨＰ', '完投', '完封勝', '無四球', '勝率', '打者', '投球回', '安打', '本塁打', '四球', '故意四', '死球', '三振', '暴投', 'ボーク', '失点', '自責点'];
const PIT_RANKED = [
  ['1', '丁田 四郎(広)', '1.98', '25', '11', '6', '0', '0', '0', '2', '1', '0', '.647', '680', '172.2', '141', '9', '48', '2', '3', '160', '2', '0', '45', '38'],
  ['2', '戊本 五郎(ヤ)', '2.34', '24', '13', '7', '1', '0', '0', '1', '0', '0', '.650', '652', '165.0', '150', '12', '40', '1', '2', '142', '1', '0', '48', '43'],
];

// 同じページに並ぶ「救援投手」の表
const PIT_RELIEF = [
  ['1', '己村 六郎(中)', '1.50', '45', '3', '3', '20', '15', '23', '0', '0', '0', '.500', '170', '42.0', '30', '2', '12', '0', '1', '48', '0', '0', '8', '7'],
  ['2', '庚原 七郎(De)', '2.31', '48', '5', '2', '2', '25', '30', '0', '0', '0', '.714', '190', '46.2', '38', '3', '15', '1', '0', '60', '1', '0', '14', '12'],
];

// パ・リーグ側は、見出しが空欄のチーム列がある作りにして別の拾い方も通す
const PIT_HEAD_P = ['順位', '投手', '', '防御率', '登板', '勝利', '敗北', 'セーブ', 'ホールド', 'ＨＰ', '完投', '完封勝', '無四球', '勝率', '打者', '投球回', '安打', '本塁打', '四球', '故意四', '死球', '三振', '暴投', 'ボーク', '失点', '自責点'];
const PIT_RANKED_P = PIT_RANKED.map((r) => [r[0], `癸${r[1].slice(1).replace(/\([^)]*\)/, '')}`.trim(), 'オ', ...r.slice(2)]);

// 球団別ページ：順位も球団も無い（球団はページの見出しから補う）
const TEAM_BAT_HEAD = BAT_HEAD.slice(1);
const TEAM_PIT_HEAD = PIT_HEAD.slice(1);

const GIANTS_BAT = [
  ['甲野 一朗', '.312', '128', '540', '470', '78', '147', '25', '2', '28', '260', '92', '5', '2', '0', '4', '62', '3', '4', '88', '9', '.553', '.392'],  // 規定到達者と重複
  ['己村 六郎', '.268', '95', '312', '280', '30', '75', '12', '0', '9', '114', '38', '1', '0', '2', '3', '25', '0', '2', '61', '5', '.407', '.328'],     // 規定未満だが打席は足りる
  ['庚原 七郎', '.220', '28', '55', '50', '4', '11', '1', '0', '1', '15', '5', '0', '0', '1', '0', '4', '0', '0', '18', '1', '.300', '.273'],            // 打席が少なすぎる → 落ちる
];
const GIANTS_PIT = [
  ['辛島 八郎', '3.12', '38', '4', '2', '0', '0', '0', '0', '0', '0', '.667', '210', '52.1', '48', '4', '18', '0', '1', '45', '1', '0', '20', '18'],     // 規定未満だが投球回は足りる
  ['壬崎 九郎', '5.40', '6', '0', '1', '0', '0', '0', '0', '0', '0', '.000', '40', '8.2', '12', '2', '5', '0', '0', '6', '0', '0', '6', '5'],            // 投球回が少なすぎる → 落ちる
];

function table(head, rows) {
  return `<table class="stntbl">
  <tr class="stfhline">${head.map((h) => `<th>${h}</th>`).join('')}</tr>
  ${rows.map((r) => `<tr>${r.map((c) => `<td class="stdivi">${c}</td>`).join('')}</tr>`).join('\n  ')}
  <tr><td colspan="${head.length}">&nbsp;</td></tr>
</table>`;
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${title} | NPB.jp 日本野球機構</title></head><body>
<table class="tablenav"><tr><td><a href="/">ホーム</a></td><td>成績</td></tr></table>
${body}
</body></html>`;
}

// 古い年度（2015年ごろ）の作り。見出しには無い球団の列が行だけにある。
const OLD_BAT_HEAD = ['順位', '選手', '打率', '試合', '打席', '打数', '得点', '安打', '二塁打', '三塁打', '本塁打', '塁打', '打点', '盗塁', '盗塁刺', '犠打', '犠飛', '四球', '故意四', '死球', '三振', '併殺打', '長打率', '出塁率'];
const OLD_BAT_ROWS = [
  ['1', '甲野 一朗', '(ヤ)', '.329', '143', '646', '557', '119', '183', '39', '2', '38', '340', '100', '34', '4', '0', '3', '81', '1', '5', '111', '11', '.610', '.416'],
  ['2', '乙川 二郎', '(デ)', '.317', '138', '568', '496', '79', '157', '28', '1', '24', '259', '93', '0', '0', '0', '2', '68', '0', '2', '98', '5', '.522', '.400'],
  ['3', '丙山 三太', '(近)', '.305', '140', '590', '520', '70', '159', '30', '1', '20', '251', '85', '5', '2', '1', '3', '60', '1', '6', '90', '9', '.483', '.383'],
  ['4', '丁田 四郎', '(横)', '.298', '139', '575', '510', '68', '152', '25', '2', '18', '235', '78', '3', '1', '0', '4', '55', '0', '6', '95', '8', '.461', '.372'],
  // 知らない略称。この行は落ちるが、他の行の読み取りまで巻き添えにしない
  ['5', '戊本 五郎', '(？)', '.290', '135', '560', '495', '60', '144', '22', '1', '15', '213', '70', '2', '1', '0', '3', '50', '0', '5', '88', '7', '.430', '.360'],
];

const INDEX = page('2026年度 成績', `
<h1>2026年度 成績</h1>
<ul>
  <li><a href="bat_c.html">セントラル・リーグ 個人打撃成績（規定打席以上）</a></li>
  <li><a href="pit_c.html">セントラル・リーグ 個人投手成績（規定投球回以上）</a></li>
  <li><a href="std_c.html">セントラル・リーグ 順位表</a></li>
  <li><a href="tmb_c.html">セントラル・リーグ チーム打撃成績</a></li>
</ul>
<h2>球団別 個人成績</h2>
<ul>
  <li><a href="idb1_g.html">読売ジャイアンツ 個人打撃成績</a></li>
  <li><a href="idp1_g.html">読売ジャイアンツ 個人投手成績</a></li>
  <li><a href="idb1_g.html">読売ジャイアンツ 個人打撃成績</a></li>
  <li><a href="/bis/teams/rst_g.html">読売ジャイアンツ 選手一覧</a></li>
</ul>`);

const swap = (rows, kanji, abbr) =>
  rows.map((r) => [r[0], r[1].replace(/^./, kanji).replace(/\([^)]*\)/, `(${abbr})`), ...r.slice(2)]);

const ROUTES = {
  '': INDEX,
  'index.html': INDEX,
  'bat_c.html': page('セ 個人打撃成績', table(BAT_HEAD, BAT_RANKED)),
  'bat_p.html': page('パ 個人打撃成績', table(BAT_HEAD, swap(BAT_RANKED, '庚', 'ソ'))),
  // 実物と同じく1ページに「規定到達」と「救援」の2つの表が並ぶ。
  // さらに集計行（チーム計）を混ぜて、選手でない行が落ちることも見る。
  'pit_c.html': page('セ 個人投手成績',
    table(PIT_HEAD, [...PIT_RANKED, ['-', 'チーム計', '3.20', '143', '70', '65', '30', '90', '120', '5', '3', '2', '.519', '5400', '1280.0', '1200', '90', '400', '20', '30', '1100', '20', '1', '520', '460']])
    + table(PIT_HEAD, PIT_RELIEF)),
  'pit_p.html': page('パ 個人投手成績', table(PIT_HEAD_P, PIT_RANKED_P)),
  'idb1_g.html': page('読売ジャイアンツ 個人打撃成績', table(TEAM_BAT_HEAD, GIANTS_BAT)),
  'idp1_g.html': page('読売ジャイアンツ 個人投手成績', table(TEAM_PIT_HEAD, GIANTS_PIT)),
};

// 2015年（古い作り）のページも用意する
for (const [name, body] of Object.entries({
  'bat_c.html': page('セ 個人打撃成績', table(OLD_BAT_HEAD, OLD_BAT_ROWS)),
  'bat_p.html': page('パ 個人打撃成績', table(OLD_BAT_HEAD, OLD_BAT_ROWS.map((r) => [r[0], `庚${r[1].slice(1)}`, '(ソ)', ...r.slice(3)]))),
  'pit_c.html': page('セ 個人投手成績', table(PIT_HEAD, PIT_RANKED)),
  'pit_p.html': page('パ 個人投手成績', table(PIT_HEAD_P, PIT_RANKED_P)),
})) ROUTES[`2015/${name}`] = body;

const server = http.createServer((req, res) => {
  const m = req.url.match(/\/(\d{4})\/stats\/?(.*)$/);
  const year = m ? m[1] : '';
  const file = m ? m[2].split('?')[0] : '';
  const body = ROUTES[`${year}/${file}`] !== undefined ? ROUTES[`${year}/${file}`] : ROUTES[file];
  if (body === undefined) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(body);
});

/* ---------- 実行して結果を見る ---------- */

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'npbfetch-'));
  fs.mkdirSync(path.join(work, 'data'));
  fs.mkdirSync(path.join(work, 'tools'));
  fs.copyFileSync(path.join(__dirname, 'fetch-npb.js'), path.join(work, 'tools', 'fetch-npb.js'));

  // サーバと同じプロセスなので、同期実行にすると応答できなくなる
  execFile(process.execPath, [path.join(work, 'tools', 'fetch-npb.js'), '2026', '2015', '--full'], {
    env: { ...process.env, NPB_BASE_URL: `http://127.0.0.1:${port}`,
           NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    encoding: 'utf8',
  }, (err, stdout, stderr) => {
    server.close();

    if (err) {
      console.error('実行に失敗:');
      console.error(stdout || '');
      console.error(stderr || err.message);
      fs.rmSync(work, { recursive: true, force: true });
      process.exit(1);
    }
    console.log(stdout.trim());
    if (stderr.trim()) console.log(stderr.trim());

    let failed = false;
    const read = (f) => fs.readFileSync(path.join(work, 'data', '2026', f), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#'));

    const expect = (label, cond, detail) => {
      if (cond) { console.log(`OK  ${label}`); return; }
      console.error(`NG  ${label}${detail ? `\n    ${detail}` : ''}`);
      failed = true;
    };

    const bat = read('batters.tsv');
    const pit = read('pitchers.tsv');
    const batBody = bat.slice(1);
    const pitBody = pit.slice(1);

    expect('選手名に入った球団「甲野 一朗(巨)」を切り分けている',
           batBody.every((l) => !l.includes('(') && /^[^\t]+\t(巨人|阪神|ソフトバンク)\t/.test(l)),
           batBody.join('\n    '));
    // パ・リーグの投手ページだけ、見出しが空欄のチーム列を持つ作りにしてある
    expect('見出しが空欄でも中身から「チーム」列を判別できている',
           pitBody.filter((l) => l.startsWith('癸')).length === 2 &&
           pitBody.filter((l) => l.startsWith('癸')).every((l) => l.includes('\tオリックス\t')),
           pitBody.join('\n    '));
    expect('打者の見出し',
           bat[0] === '選手名\tチーム\t打席\t打率\t本塁打\t打点\t出塁率\t長打率', bat[0]);
    expect('投手の見出し',
           pit[0] === '選手名\tチーム\t登板\t投球回\t勝\t敗\t防御率\t奪三振', pit[0]);

    expect('規定到達者を取れている',
           batBody.some((l) => l === '甲野 一朗\t巨人\t540\t.312\t28\t92\t.392\t.553'), batBody.join('\n    '));
    expect('「投手」「敗北」という見出しでも投球回・勝敗・奪三振を正しく拾えている',
           pitBody.some((l) => l === '丁田 四郎\t広島\t25\t172.2\t11\t6\t1.98\t160'), pitBody.join('\n    '));
    expect('略称のチーム欄を正式な表記にそろえている',
           batBody.every((l) => !/\t(巨|神|広|ヤ|ソ|オ)\t/.test(l)), batBody.join('\n    '));

    expect('目次から球団別ページを辿って規定未満を拾えている',
           batBody.some((l) => l.startsWith('己村 六郎\t巨人\t312\t')), batBody.join('\n    '));
    expect('チーム列が無いページでも球団を補えている',
           pitBody.some((l) => l === '辛島 八郎\t巨人\t38\t52.1\t4\t2\t3.12\t45'), pitBody.join('\n    '));

    expect('規定到達者と球団別ページの重複を落としている',
           batBody.filter((l) => l.startsWith('甲野 一朗')).length === 1,
           `甲野 一朗 が ${batBody.filter((l) => l.startsWith('甲野 一朗')).length} 行`);

    expect('打席が少なすぎる選手を落としている',
           !batBody.some((l) => l.startsWith('庚原 七郎')), batBody.join('\n    '));
    expect('投球回が少なすぎる投手を落としている',
           !pitBody.some((l) => l.startsWith('壬崎 九郎')), pitBody.join('\n    '));

    expect('順位表やチーム成績のリンクは辿っていない', !stdout.includes('順位表'));

    // 1ページに表が2つ並ぶ作り（規定到達＋救援）
    expect('同じページの2つめの表（救援）も読んでいる',
           pitBody.some((l) => l.startsWith('己村 六郎\t中日\t45\t42.0\t')) &&
           pitBody.some((l) => l.startsWith('庚原 七郎\tDeNA\t48\t46.2\t')),
           pitBody.join('\n    '));
    expect('「チーム計」のような集計行を落としている',
           !pitBody.some((l) => l.includes('チーム計')), pitBody.join('\n    '));

    const conf = JSON.parse(fs.readFileSync(path.join(work, 'data', 'dataset.json'), 'utf8'));
    expect('dataset.json に取得日が入っている', /^\d{4}年\d{1,2}月\d{1,2}日時点$/.test(conf.asOf), conf.asOf);
    expect('dataset.json に出典が入っている',
           conf.source && conf.source.name.includes('NPB') && conf.source.url.includes('/2026/'),
           JSON.stringify(conf.source));

    // 古い作り（見出しに無い球団の列がある年度）
    const old = fs.readFileSync(path.join(work, 'data', '2015', 'batters.tsv'), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#')).slice(1);
    expect('見出しに無い球団の列がある年度でも、値がずれずに読めている',
           old.some((l) => l === '甲野 一朗\tヤクルト\t646\t.329\t38\t100\t.416\t.610'), old.join('\n    '));
    expect('括弧つきの略称「(デ)」を球団として読めている',
           old.some((l) => l.startsWith('乙川 二郎\tDeNA\t568\t.317\t24\t93\t')), old.join('\n    '));
    expect('近鉄をオリックスと別の球団として扱っている',
           old.some((l) => l.startsWith('丙山 三太\t近鉄\t590\t')), old.join('\n    '));
    expect('横浜ベイスターズ時代の略称「(横)」を読めている',
           old.some((l) => l.startsWith('丁田 四郎\tDeNA\t575\t')), old.join('\n    '));
    expect('知らない略称が混ざっても、他の行は読めている',
           !old.some((l) => l.startsWith('戊本 五郎')) && old.length >= 8, old.join('\n    '));

    console.log(`\n2026年: 打者 ${batBody.length}人 / 投手 ${pitBody.length}人 ／ 2015年: 打者 ${old.length}人`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
});
