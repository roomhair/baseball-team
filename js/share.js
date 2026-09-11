/* ==================================================
   最強チームメーカー  share.js
   結果の共有まわり。
     ・結果を短い文字列にして URL に入れる
     ・結果画像を作る
     ・Xの投稿画面を開く
   ================================================== */
'use strict';

/* ==================================================
   1. 結果を URL 用の文字列にする

   サーバーを使わずに結果を共有できるようにするため、
   「9人のIDと守備位置」をそのまま文字列に詰めて URL に入れている。
   （データベースを用意すれば /result/abc123 のような短いURLにもできる）
   ================================================== */
const ShareCode = {

  VERSION: 1,

  /** 編成 → 文字列 */
  encode: function (slots) {
    const body = slots.map(function (s) {
      return s.playerId + '-' + POS_KEYS.indexOf(s.pos);
    }).join('.');

    const text = this.VERSION + ':' + body + ':' + Storage.sign(body);
    return b64urlEncode(text);
  },

  /** 文字列 → 編成（おかしなデータなら null） */
  decode: function (code) {
    try {
      const text = b64urlDecode(code);
      const parts = text.split(':');
      if (Number(parts[0]) !== this.VERSION) return null;

      const body = parts[1];
      const sign = parts[2];
      if (Storage.sign(body) !== sign) return null;   // 書き換えられている

      const slots = body.split('.').map(function (chunk) {
        const m = chunk.match(/^([bp]\d+)-(\d)$/);
        if (!m) return null;
        const player = PlayerPool.get(m[1]);
        const pos = POS_KEYS[Number(m[2])];
        if (!player || !pos) return null;
        return { playerId: player.id, pos: pos };
      });

      if (slots.length !== CONFIG.TEAM_SIZE) return null;
      if (slots.some(function (s) { return s === null; })) return null;

      // 守備位置がダブっていたら無効
      const used = {};
      for (let i = 0; i < slots.length; i++) {
        if (used[slots[i].pos]) return null;
        used[slots[i].pos] = true;
      }
      return slots;
    } catch (e) {
      return null;
    }
  },

  /** 共有用のURLを作る */
  url: function (slots) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + 'result.html?d=' + this.encode(slots);
  },
};


/* 日本語が入っても壊れない Base64（URLに入れられる形） */
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(function (b) { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}


/* ==================================================
   2. Xに投稿する文章を作る
   ================================================== */
const ShareText = {

  build: function (ev, url) {
    const lines = [
      CONFIG.SHARE_TEXT,
      '',
      '【総合評価】',
      UI.stars(ev.stars) + '　' + ev.total + '点',
      '「' + ev.title + '」',
      '',
      '【守備】',
      ev.defenseComment,
      '',
      'あなたならどう編成する？',
    ];
    return { text: lines.join('\n'), url: url };
  },

  open: function (ev, url) {
    const s = this.build(ev, url);
    const href = 'https://twitter.com/intent/tweet' +
      '?text=' + encodeURIComponent(s.text) +
      '&url=' + encodeURIComponent(s.url);
    // X APIは使わない。投稿画面を開くだけで、実際に投稿するかは本人が決める。
    window.open(href, '_blank', 'noopener');
  },
};


/* ==================================================
   3. 結果画像を作る

   外部ライブラリは使わず、canvas に直接描いている。
   SNSに載せやすい縦長（1080 × 1350）。
   ================================================== */
const ResultImage = {

  W: 1080,
  H: 1350,

  draw: function (lineup, ev) {
    const c = document.createElement('canvas');
    c.width = this.W;
    c.height = this.H;
    const g = c.getContext('2d');

    const JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif';

    // --- 背景 ---
    const bg = g.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#070d1c');
    bg.addColorStop(1, '#12224a');
    g.fillStyle = bg;
    g.fillRect(0, 0, this.W, this.H);

    // 上のぼんやりした光
    const glow = g.createRadialGradient(540, 40, 10, 540, 40, 700);
    glow.addColorStop(0, 'rgba(53,224,208,.22)');
    glow.addColorStop(1, 'rgba(53,224,208,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, this.W, 600);

    // --- タイトル ---
    g.textAlign = 'center';
    g.fillStyle = '#35e0d0';
    g.font = '700 26px ' + JP;
    g.fillText('BASEBALL  TEAM  BUILDER', 540, 72);

    g.font = '900 62px ' + JP;
    g.fillStyle = '#ffd23f';
    g.fillText('最強チームメーカー', 540, 146);

    // --- 9人の表 ---
    const top = 200;
    const rowH = 76;

    lineup.forEach(function (slot, i) {
      const y = top + i * rowH;
      const p = slot.player;
      const grade = fitOf(p, slot.pos);

      // 行の背景
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)';
      roundRect(g, 60, y, 960, rowH - 10, 12);
      g.fill();

      // 打順
      g.textAlign = 'center';
      g.fillStyle = '#96a6c8';
      g.font = '800 30px ' + JP;
      g.fillText((i + 1) + '番', 118, y + 44);

      // 守備位置の丸
      const col = UI.POS_COLOR[slot.pos] || ['#8899bb', '#445577'];
      g.beginPath();
      g.arc(200, y + 33, 25, 0, Math.PI * 2);
      g.fillStyle = col[0];
      g.fill();
      g.fillStyle = '#0b1226';
      g.font = '900 28px ' + JP;
      g.fillText(slot.pos, 200, y + 43);

      // 選手名
      g.textAlign = 'left';
      g.fillStyle = '#eaf0ff';
      g.font = '800 34px ' + JP;
      g.fillText(fitText(g, p.name, 330), 246, y + 33);

      // 球団・年度
      g.fillStyle = '#8496ba';
      g.font = '500 22px ' + JP;
      g.fillText(p.team + '  ' + p.year, 248, y + 60);

      // 本職と適性（右端をそろえる）
      g.textAlign = 'right';
      g.fillStyle = '#7f8fb3';
      g.font = '600 22px ' + JP;
      g.fillText('本職 ' + posName(p.pos), 992, y + 30);

      const fitColor = { 'A': '#3ddc84', 'B': '#ffd23f', 'C': '#ff9d2f', '-': '#ff5c72' }[grade];
      g.fillStyle = fitColor;
      g.font = '800 24px ' + JP;
      g.fillText(FIT_LABEL[grade], 992, y + 58);
    });

    // --- 評価 ---
    const evTop = top + 9 * rowH + 26;

    g.fillStyle = 'rgba(255,255,255,.05)';
    roundRect(g, 60, evTop, 960, 262, 18);
    g.fill();

    const rows = [
      ['打撃力', ev.batting.stars],
      ['投手力', ev.pitching.stars],
      ['守備力', ev.fielding.stars],
    ];
    rows.forEach(function (r, i) {
      const y = evTop + 54 + i * 48;
      g.textAlign = 'left';
      g.fillStyle = '#96a6c8';
      g.font = '700 28px ' + JP;
      g.fillText(r[0], 96, y);
      g.fillStyle = '#ffd23f';
      g.font = '700 32px ' + JP;
      g.fillText(UI.stars(r[1]), 220, y);
    });

    // 総合点
    g.textAlign = 'right';
    g.fillStyle = '#96a6c8';
    g.font = '700 26px ' + JP;
    g.fillText('総合評価', 984, evTop + 54);
    g.fillStyle = '#ffd23f';
    g.font = '900 96px ' + JP;
    g.fillText(String(ev.total), 930, evTop + 142);
    g.fillStyle = '#96a6c8';
    g.font = '700 32px ' + JP;
    g.fillText('点', 984, evTop + 142);

    // 見出しコメント
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = '900 38px ' + JP;
    g.fillText('「' + ev.title + '」', 96, evTop + 206);
    g.fillStyle = '#9fb0d2';
    g.font = '500 26px ' + JP;
    g.fillText(fitText(g, ev.defenseComment, 880), 96, evTop + 246);

    // --- 下 ---
    g.textAlign = 'center';
    g.fillStyle = '#6f80a4';
    g.font = '600 24px ' + JP;
    g.fillText('最強チームメーカー', 540, this.H - 54);
    g.font = '400 19px ' + JP;
    g.fillText('成績データ出典：NPB.jp（日本野球機構）', 540, this.H - 24);

    return c;
  },
};


/* 角の丸い四角を描く小道具 */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* 文字が枠からはみ出るときは「…」で切る */
function fitText(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}
