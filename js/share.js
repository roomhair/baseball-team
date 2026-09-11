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

  VERSION: 2,

  /** 打順に使える場所の一覧（守備9つ＋DH）。番号で保存するために使う。 */
  KEYS: function () {
    return POS_KEYS.concat([DH_KEY]);
  },

  /** 編成 → 文字列 */
  encode: function (team) {
    const keys = this.KEYS();
    const body =
      team.pitcherId + '|' + (team.useDH ? 1 : 0) + '|' +
      team.slots.map(function (s) {
        return s.playerId + '-' + keys.indexOf(s.pos);
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

      const chunks = body.split('|');
      const pitcher = PlayerPool.get(chunks[0]);
      const useDH = chunks[1] === '1';
      if (!pitcher) return null;

      const keys = this.KEYS();
      const slots = chunks[2].split('.').map(function (chunk) {
        const m = chunk.match(/^([bpt]\d+)-(\d+)$/);
        if (!m) return null;
        const player = PlayerPool.get(m[1]);
        const pos = keys[Number(m[2])];
        if (!player || !pos) return null;
        return { playerId: player.id, pos: pos };
      });

      if (slots.length !== 9) return null;
      if (slots.some(function (s) { return s === null; })) return null;

      // 守備位置がダブっていたら無効
      const used = {};
      for (let i = 0; i < slots.length; i++) {
        if (used[slots[i].pos]) return null;
        used[slots[i].pos] = true;
      }
      return { slots: slots, pitcherId: pitcher.id, useDH: useDH };
    } catch (e) {
      return null;
    }
  },

  /** 共有用のURLを作る */
  url: function (team) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + 'result.html?d=' + this.encode(team);
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

  draw: function (team, ev) {
    const lineup = team.order;
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

    // --- 投手＋打順9人の表 ---
    const top = 186;
    const rowH = 68;

    const rows = [];
    if (team.useDH && team.pitcher) {
      rows.push({ label: '投手', pos: '投', player: team.pitcher });
    }
    lineup.forEach(function (slot, i) {
      rows.push({ label: (i + 1) + '番', pos: slot.pos, player: slot.player });
    });

    rows.forEach(function (slot, i) {
      const y = top + i * rowH;
      const p = slot.player;
      const grade = fitOf(p, slot.pos);

      // 行の背景
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)';
      roundRect(g, 60, y, 960, rowH - 9, 12);
      g.fill();

      // 打順（投手の行は「投手」と出す）
      g.textAlign = 'center';
      g.fillStyle = '#96a6c8';
      g.font = '800 26px ' + JP;
      g.fillText(slot.label, 118, y + 40);

      // 守備位置の丸
      const col = UI.POS_COLOR[slot.pos] || ['#8899bb', '#445577'];
      g.beginPath();
      g.arc(200, y + 30, 23, 0, Math.PI * 2);
      g.fillStyle = col[0];
      g.fill();
      g.fillStyle = '#0b1226';
      g.font = '900 26px ' + JP;
      g.fillText(slot.pos, 200, y + 39);

      // 選手名
      g.textAlign = 'left';
      g.fillStyle = '#eaf0ff';
      g.font = '800 32px ' + JP;
      g.fillText(fitText(g, p.name, 330), 244, y + 30);

      // 球団・年度
      g.fillStyle = '#8496ba';
      g.font = '500 21px ' + JP;
      g.fillText(p.team + '  ' + p.year, 246, y + 55);

      // 本職と適性（右端をそろえる）
      g.textAlign = 'right';
      g.fillStyle = '#7f8fb3';
      g.font = '600 21px ' + JP;
      g.fillText('本職 ' + posName(p.pos), 992, y + 28);

      const fitColor = { 'A': '#3ddc84', 'B': '#ffd23f', 'C': '#ff9d2f', '-': '#ff5c72' }[grade];
      g.fillStyle = fitColor;
      g.font = '800 23px ' + JP;
      g.fillText(FIT_LABEL[grade], 992, y + 54);
    });

    // --- 評価 ---
    const evTop = top + rows.length * rowH + 20;

    g.fillStyle = 'rgba(255,255,255,.05)';
    roundRect(g, 60, evTop, 960, 262, 18);
    g.fill();

    const scoreRows = [
      ['打撃力', ev.batting.stars],
      ['投手力', ev.pitching.stars],
      ['守備力', ev.fielding.stars],
    ];
    scoreRows.forEach(function (r, i) {
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


/* ==================================================
   4. シーズンの最終結果画像
   こちらも外部ライブラリを使わず canvas に直接描いている。
   ================================================== */
const SeasonImage = {

  W: 1080,
  H: 1350,

  draw: function (r, outcome) {
    const c = document.createElement('canvas');
    c.width = this.W;
    c.height = this.H;
    const g = c.getContext('2d');

    const JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif';
    const gold = outcome.key === 'nippon' || outcome.key === 'csWin';

    // --- 背景 ---
    const bg = g.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#070d1c');
    bg.addColorStop(1, gold ? '#3a2a06' : '#12224a');
    g.fillStyle = bg;
    g.fillRect(0, 0, this.W, this.H);

    const glow = g.createRadialGradient(540, 60, 10, 540, 60, 760);
    glow.addColorStop(0, gold ? 'rgba(255,210,63,.28)' : 'rgba(53,224,208,.20)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, this.W, 700);

    // --- タイトル ---
    g.textAlign = 'center';
    g.fillStyle = '#35e0d0';
    g.font = '700 24px ' + JP;
    g.fillText('BASEBALL  TEAM  BUILDER', 540, 62);
    g.fillStyle = '#ffd23f';
    g.font = '900 54px ' + JP;
    g.fillText('最強チームメーカー', 540, 126);

    // --- チーム名 ---
    g.fillStyle = '#eaf0ff';
    g.font = '800 42px ' + JP;
    g.fillText(fitText(g, r.teamName, 800), 540, 196);
    g.fillStyle = '#8496ba';
    g.font = '600 24px ' + JP;
    g.fillText(r.league.name + '　' + CONFIG.SEASON_GAMES + '試合', 540, 234);

    // --- 結末の帯 ---
    g.fillStyle = gold ? 'rgba(255,210,63,.16)' : 'rgba(255,255,255,.06)';
    roundRect(g, 60, 262, 960, 210, 20);
    g.fill();
    if (gold) {
      g.strokeStyle = 'rgba(255,210,63,.6)';
      g.lineWidth = 3;
      roundRect(g, 60, 262, 960, 210, 20);
      g.stroke();
    }

    g.font = '900 74px ' + JP;
    g.fillStyle = gold ? '#ffd23f' : '#eaf0ff';
    g.fillText(outcome.icon + ' ' + outcome.label, 540, 352);

    const mine = r.mine;
    g.font = '800 40px ' + JP;
    g.fillStyle = '#eaf0ff';
    g.fillText(CONFIG.LEAGUE_TEAMS + 'チーム中 ' + mine.rank + '位', 540, 412);
    g.font = '600 30px ' + JP;
    g.fillStyle = '#9fb0d2';
    g.fillText(mine.w + '勝 ' + mine.l + '敗 ' + mine.d + '分　勝率 ' +
      mine.pct.toFixed(3).replace(/^0/, ''), 540, 452);

    // --- 打線 ---
    let y = 522;
    g.textAlign = 'left';
    g.fillStyle = '#35e0d0';
    g.font = '800 24px ' + JP;
    g.fillText('打撃成績', 70, y);
    y += 18;

    r.batters.forEach(function (b, i) {
      const ry = y + i * 56;
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)';
      roundRect(g, 60, ry, 960, 50, 10);
      g.fill();

      g.textAlign = 'center';
      g.fillStyle = '#8496ba';
      g.font = '800 22px ' + JP;
      g.fillText((i + 1) + '番', 108, ry + 32);
      g.fillStyle = '#cfe0ff';
      g.font = '700 22px ' + JP;
      g.fillText(b.pos, 168, ry + 32);

      g.textAlign = 'left';
      g.fillStyle = '#eaf0ff';
      g.font = '800 28px ' + JP;
      g.fillText(fitText(g, b.player.name, 300), 200, ry + 33);

      g.textAlign = 'right';
      g.fillStyle = '#eaf0ff';
      g.font = '700 26px ' + JP;
      g.fillText(b.avg.toFixed(3).replace(/^0/, ''), 690, ry + 33);
      g.fillText(b.hr + '本', 800, ry + 33);
      g.fillText(b.rbi + '点', 900, ry + 33);
      g.fillStyle = '#8496ba';
      g.font = '600 22px ' + JP;
      g.fillText('OPS ' + (b.obp + b.slg).toFixed(3).replace(/^0/, ''), 1010, ry + 33);
    });

    // --- 主な投手（投球回の多い順に3人） ---
    y = y + 9 * 56 + 26;
    g.textAlign = 'left';
    g.fillStyle = '#35e0d0';
    g.font = '800 24px ' + JP;
    g.fillText('投手成績', 70, y);
    y += 18;

    const top3 = r.pitchers.slice().sort(function (a, b) { return b.ip - a.ip; }).slice(0, 3);
    top3.forEach(function (p, i) {
      const ry = y + i * 56;
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)';
      roundRect(g, 60, ry, 960, 50, 10);
      g.fill();

      g.textAlign = 'left';
      g.fillStyle = '#eaf0ff';
      g.font = '800 28px ' + JP;
      g.fillText(fitText(g, p.player.name, 330), 96, ry + 33);
      g.fillStyle = '#8496ba';
      g.font = '600 22px ' + JP;
      g.fillText(p.role, 450, ry + 33);

      g.textAlign = 'right';
      g.fillStyle = '#eaf0ff';
      g.font = '700 26px ' + JP;
      g.fillText(p.w + '勝' + p.l + '敗', 800, ry + 33);
      g.fillText('防 ' + p.era.toFixed(2), 940, ry + 33);
      g.fillStyle = '#8496ba';
      g.font = '600 22px ' + JP;
      g.fillText(p.so + 'K', 1010, ry + 33);
    });

    // --- 下 ---
    g.textAlign = 'center';
    g.fillStyle = '#6f80a4';
    g.font = '600 22px ' + JP;
    g.fillText('最強チームメーカー', 540, this.H - 52);
    g.font = '400 18px ' + JP;
    g.fillText('成績データ出典：NPB.jp（日本野球機構）／シーズン結果は架空のシミュレーションです',
      540, this.H - 24);

    return c;
  },
};
