/* ==================================================
   最強チームメーカー  positions.js
   守備位置の定義と「守備適性」の計算。
   ================================================== */
'use strict';

/* --- 守備位置の一覧（打順とは別。守る場所の定義） --- */
const POS_LIST = [
  { key: '投', name: '投手',   short: 'P'  },
  { key: '捕', name: '捕手',   short: 'C'  },
  { key: '一', name: '一塁手', short: '1B' },
  { key: '二', name: '二塁手', short: '2B' },
  { key: '三', name: '三塁手', short: '3B' },
  { key: '遊', name: '遊撃手', short: 'SS' },
  { key: '左', name: '左翼手', short: 'LF' },
  { key: '中', name: '中堅手', short: 'CF' },
  { key: '右', name: '右翼手', short: 'RF' },
];

const POS_KEYS = POS_LIST.map(function (p) { return p.key; });

/* --- 指名打者（DH） ---
   守備には就かないので POS_LIST とは分けてある。
   DH制を使うリーグでは、野手9人のうち1人がここに入る。 */
const DH_KEY = 'Ｄ';
const DH_NAME = '指名打者';

/** 打順を組むときに選べる場所（守備8つ＋DH）。DH制ありのとき使う。 */
const DH_LINEUP_KEYS = ['捕', '一', '二', '三', '遊', '左', '中', '右', DH_KEY];

/** 打順を組むときに選べる場所（守備9つ）。DH制なし（セ・リーグ）のとき使う。 */
const NODH_LINEUP_KEYS = POS_KEYS.slice();

/** '遊' → '遊撃手' */
function posName(key) {
  if (key === DH_KEY) return DH_NAME;
  const found = POS_LIST.find(function (p) { return p.key === key; });
  return found ? found.name : key;
}


/* ==================================================
   守備適性の表

   「本職がどこか」から、「他のどこなら守れるか」を決める。
     A … 本職。問題なく守れる
     B … 守れる。少し苦しい
     C … かなり無理がある
     （表に無い＝適性外。守らせると評価が大きく下がる）

   例：本職が遊撃手の選手は、二塁もA、三塁はB、外野はC。
       投手は投手以外どこも守れない（適性外）。
   ここを書き換えれば、ゲームの難しさが変わる。
   ================================================== */
const FIT_TABLE = {
  '投': { '投': 'A' },
  '捕': { '捕': 'A', '一': 'B', '三': 'C', '左': 'C' },
  '一': { '一': 'A', '三': 'C', '左': 'C', '右': 'C' },
  '二': { '二': 'A', '遊': 'B', '三': 'B', '一': 'B', '中': 'C', '左': 'C', '右': 'C' },
  '三': { '三': 'A', '一': 'B', '遊': 'C', '二': 'C', '左': 'C', '右': 'C' },
  '遊': { '遊': 'A', '二': 'A', '三': 'B', '一': 'C', '中': 'C', '左': 'C', '右': 'C' },
  '左': { '左': 'A', '右': 'B', '中': 'B', '一': 'C' },
  '中': { '中': 'A', '左': 'A', '右': 'A', '二': 'C', '遊': 'C', '一': 'C' },
  '右': { '右': 'A', '左': 'A', '中': 'B', '一': 'C' },
};

/* 適性ごとの守備力のかかり具合。1.0 が満点。 */
const FIT_FACTOR = { 'A': 1.00, 'B': 0.85, 'C': 0.62, '-': 0.28 };

/* 画面に出すときの呼び方 */
const FIT_LABEL = { 'A': '適性A', 'B': '適性B', 'C': '適性C', '-': '適性外' };


/**
 * その選手が、その守備位置をどれくらい守れるかを返す。
 * 戻り値は 'A' / 'B' / 'C' / '-'（'-' は適性外）
 */
function fitOf(player, posKey) {
  if (!player) return '-';

  // DHは守備に就かないので、野手なら誰でもA。投手だけは適性外。
  if (posKey === DH_KEY) return player.pos === '投' ? '-' : 'A';

  // 二刀流選手は、投手としても本職として扱う
  if (player.kind === 'twoway' && posKey === '投') return 'A';

  // data/positions.tsv に副ポジションが書かれていれば、そこはBとして扱う
  if (player.sub && player.sub.indexOf(posKey) !== -1) {
    const baseGrade = (FIT_TABLE[player.pos] || {})[posKey];
    if (baseGrade === 'A') return 'A';
    return 'B';
  }

  const grade = (FIT_TABLE[player.pos] || {})[posKey];
  return grade || '-';
}

/** その選手が、すべての守備位置をどれくらい守れるかの一覧を返す（カード表示用） */
function fitListOf(player) {
  return POS_KEYS.map(function (key) {
    return { key: key, name: posName(key), grade: fitOf(player, key) };
  });
}
