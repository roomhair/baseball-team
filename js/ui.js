/* ==================================================
   最強チームメーカー  ui.js
   選手カードなど、見た目を作る部分。
   ================================================== */
'use strict';

const UI = {

  /* 守備位置ごとの色。アバターの色分けにも使う。 */
  POS_COLOR: {
    '投': ['#ff7a59', '#c0392b'],
    '捕': ['#ffd23f', '#c08a00'],
    '一': ['#7ee787', '#2e8b3d'],
    '二': ['#35e0d0', '#0f8f86'],
    '三': ['#69b6ff', '#1f5fa8'],
    '遊': ['#a78bfa', '#5b3fc0'],
    '左': ['#ff9de2', '#b03d8f'],
    '中': ['#ffb86b', '#b96a12'],
    '右': ['#8fd3ff', '#2a7fb8'],
  },

  /**
   * 選手の「顔写真」の代わりになる絵を作る。
   *
   * 実在選手の写真は著作権・肖像権があって使えないので、
   * 選手ごとに色が決まるシルエット画像をその場で描いている。
   * 画像ファイルは1つも使わない。
   */
  avatar: function (player) {
    const colors = this.POS_COLOR[player.pos] || ['#8899bb', '#445577'];
    // 名前から数字を作って、同じ選手なら毎回同じ絵になるようにする
    let h = 0;
    for (let i = 0; i < player.name.length; i++) {
      h = (h * 31 + player.name.charCodeAt(i)) >>> 0;
    }
    const tilt = (h % 7) - 3;             // 帽子の傾き
    const num = (h % 99) + 1;             // 背番号っぽい数字

    return '' +
      '<svg class="avatar" viewBox="0 0 120 120" role="img" aria-label="' + esc(player.name) + '">' +
      '<defs>' +
        '<linearGradient id="g' + h + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + colors[0] + '"/>' +
          '<stop offset="100%" stop-color="' + colors[1] + '"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<circle cx="60" cy="60" r="58" fill="url(#g' + h + ')"/>' +
      '<g fill="rgba(0,0,0,.34)">' +
        // 肩
        '<path d="M20 120c0-22 18-34 40-34s40 12 40 34z"/>' +
        // 頭
        '<circle cx="60" cy="58" r="22"/>' +
        // 帽子（かぶっているように、頭に重ねて描く）
        '<g transform="rotate(' + tilt + ' 60 46)">' +
          '<path d="M37 47a23 23 0 0 1 46 0z"/>' +
          '<path d="M83 41h15a6 6 0 0 1 0 12H83z"/>' +
        '</g>' +
      '</g>' +
      '<text x="60" y="112" text-anchor="middle" font-size="13" font-weight="800" ' +
        'fill="rgba(255,255,255,.55)">' + num + '</text>' +
      '</svg>';
  },

  /** ★★★☆☆ の文字列を作る */
  stars: function (n) {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  },

  /** 能力を棒グラフで表示する */
  bar: function (label, value) {
    return '' +
      '<div class="stat">' +
        '<span class="stat__label">' + esc(label) + '</span>' +
        '<span class="stat__bar"><i style="width:' + Math.max(3, value) + '%"></i></span>' +
        '<span class="stat__val">' + value + '</span>' +
      '</div>';
  },

  /**
   * ガチャ画面に出す選手カード。
   * 「今この選手を取るべきか」を一目で決められる情報だけを載せる。
   */
  playerCard: function (player) {
    const isP = player.kind === 'pitcher';
    const isTW = player.kind === 'twoway';

    // 主な成績（二刀流は打撃と投球の両方を出す）
    const batLine = [['打率', player.s.打率], ['本塁打', player.s.本塁打 + '本'], ['OPS', player.s.OPS]];
    const pitLine = player.sp
      ? [['防御率', player.sp.防御率], ['奪三振', player.sp.奪三振], ['勝敗', player.sp.勝敗]]
      : [];

    const statBlock = function (rows) {
      return '<div class="card__stats">' + rows.map(function (row) {
        return '<div class="kv"><span>' + esc(row[0]) + '</span><b>' +
          esc(String(row[1])) + '</b></div>';
      }).join('') + '</div>';
    };

    let stats, bars;
    if (isTW) {
      stats = '<p class="card__split">打者として</p>' + statBlock(batLine) +
              '<p class="card__split">投手として</p>' + statBlock(pitLine);
      bars = this.bar('打撃', player.r.bat) + this.bar('長打', player.r.power) +
             this.bar('走力', player.r.run) + this.bar('投手力', player.r.pitch);
    } else if (isP) {
      stats = statBlock(pitLine);
      bars = this.bar('投手力', player.r.pitch) + this.bar('守備', player.r.field);
    } else {
      stats = statBlock(batLine);
      bars = this.bar('打撃', player.r.bat) + this.bar('長打', player.r.power) +
             this.bar('走力', player.r.run) + this.bar('守備', player.r.field);
    }

    // 守れる場所（A と B だけ出す。多すぎると読めなくなるため）
    const fitTags = fitListOf(player)
      .filter(function (f) { return f.grade === 'A' || f.grade === 'B'; })
      .map(function (f) {
        return '<span class="fit fit--' + f.grade + '">' + f.name + ' ' + f.grade + '</span>';
      }).join('');

    const posLabel = isTW
      ? '二刀流<small>投／' + esc(posName(player.pos)) + '</small>'
      : esc(posName(player.pos)) + (player.role ? '<small>' + esc(player.role) + '</small>' : '');

    return '' +
      '<article class="card' + (isTW ? ' card--twoway' : '') + '">' +
        '<div class="card__top">' +
          '<div class="card__avatar">' + this.avatar(player) + '</div>' +
          '<div class="card__id">' +
            '<div class="card__pos" data-pos="' + (isTW ? '投' : player.pos) + '">' + posLabel + '</div>' +
            '<h2 class="card__name">' + esc(player.name) + '</h2>' +
            '<p class="card__team">' + esc(player.team) + '　' + player.year + '年　' +
              this.ageText(player) + '</p>' +
          '</div>' +
          '<div class="card__ovr"><span>総合</span><b>' + player.ovr + '</b></div>' +
        '</div>' +

        stats +
        '<div class="card__bars">' + bars + '</div>' +

        '<div class="card__fits">' +
          '<span class="card__fits-label">守れる所</span>' +
          (fitTags || '<span class="fit fit--none">投手のみ</span>') +
        '</div>' +
      '</article>';
  },

  /** 「28歳」または「28歳ごろ」（推定のとき）。分からないときは空 */
  ageText: function (player) {
    if (!player.age) return '';
    return player.age + '歳' + (player.ageEst === 1 ? 'ごろ' : '');
  },

  /** 獲得済みメンバーの小さな一覧。entries は { player, role } の配列 */
  rosterChips: function (entries) {
    if (!entries || entries.length === 0) {
      return '<p class="roster__empty">まだ0人。ここに獲得した選手が並びます。</p>';
    }
    return entries.map(function (e) {
      const p = e.player;
      // 投手として取った二刀流は「投」と表示する
      const mark = e.role === 'pitcher' ? '投' : p.pos;
      return '<span class="chip" data-pos="' + mark + '">' +
        '<b>' + esc(mark) + '</b>' + esc(p.name) + '</span>';
    }).join('');
  },

  /** メンバー確認画面などで使う、少し大きめの一覧 */
  rosterRows: function (entries, options) {
    const opt = options || {};
    return '<ol class="rows' + (opt.number ? '' : ' rows--plain') + '">' + entries.map(function (e, i) {
      const p = e.player;
      const mark = e.role === 'pitcher' ? '投' : p.pos;
      const sub = e.role === 'pitcher'
        ? (p.sp ? '防御率 ' + p.sp.防御率 + '・' + p.sp.奪三振 + '奪三振' : '')
        : (p.s ? '打率 ' + p.s.打率 + '・' + p.s.本塁打 + '本' : '');
      return '' +
        '<li class="row">' +
          (opt.number ? '<span class="row__order">' + (i + 1) + '</span>' : '') +
          '<span class="row__pos" data-pos="' + mark + '">' + esc(mark) + '</span>' +
          '<span class="row__name">' + esc(p.name) +
            (p.kind === 'twoway' ? '<i class="tag-tw">二刀流</i>' : '') +
            '<small>' + esc(p.team) + ' ' + p.year + '・' + esc(sub) + '</small>' +
          '</span>' +
          '<span class="row__ovr">' + p.ovr + '</span>' +
        '</li>';
    }).join('') + '</ol>';
  },
};


/** HTMLに文字を埋め込むときの安全処理（記号が壊れないようにする） */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
