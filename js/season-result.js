/* ==================================================
   最強チームメーカー  season-result.js
   シーズンの結果画面（打撃成績／投球成績／順位表）と、
   クライマックスシリーズ・日本シリーズ・最終結果。
   ================================================== */
'use strict';

/* --- 数字の見せ方をそろえる小道具 --- */
function fmtAvg(n) { return n.toFixed(3).replace(/^0/, ''); }
function fmtEra(n) { return n.toFixed(2); }

/** 投球回を野球の書き方にする（143.67 → 143.2 ＝ 143回2/3） */
function fmtIp(ip) {
  const whole = Math.floor(ip);
  let third = Math.round((ip - whole) * 3);
  if (third >= 3) return (whole + 1) + '';
  return third === 0 ? String(whole) : whole + '.' + third;
}

/** +5 / -3 のように符号を付ける */
function fmtSigned(n) { return (n > 0 ? '+' : '') + n; }


const SeasonResult = {

  result: null,
  tab: 'bat',

  init: function () {
    const self = this;

    document.getElementById('sr-tabs').addEventListener('click', function (ev) {
      const b = ev.target.closest('button[data-tab]');
      if (!b) return;
      self.tab = b.dataset.tab;
      self.renderTab();
    });

    document.getElementById('btn-cs').addEventListener('click', function () { self.runCS(); });
    document.getElementById('btn-ns').addEventListener('click', function () { self.runNS(); });
    document.getElementById('btn-season-image').addEventListener('click', function () { self.makeImage(); });
    document.getElementById('btn-season-x').addEventListener('click', function () { self.shareX(); });
    document.getElementById('btn-season-again').addEventListener('click', function () { startNewGame(); });
  },

  show: function (result) {
    this.result = result;
    this.tab = 'bat';   // 最初は必ず打撃成績。順位表はユーザーが押すまで見せない
    this.renderHead();
    this.renderTab();
    this.renderNext();
  },

  /* ==================================================
     見出し
     ================================================== */
  renderHead: function () {
    const r = this.result;
    document.getElementById('sr-head').innerHTML = '' +
      '<p class="pagehead__eyebrow">' + esc(r.league.name) + '　' + CONFIG.SEASON_GAMES + '試合</p>' +
      '<h1 class="pagehead__title">' + esc(r.teamName) + ' の1年</h1>' +
      '<p class="pagehead__lead">シーズンが終わりました。成績を見てみましょう。</p>';
  },

  /* ==================================================
     タブの中身
     ================================================== */
  renderTab: function () {
    const self = this;
    document.querySelectorAll('#sr-tabs button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.tab === self.tab);
    });

    const host = document.getElementById('sr-body');
    if (this.tab === 'bat') host.innerHTML = this.batTable();
    else if (this.tab === 'pit') host.innerHTML = this.pitTable();
    else host.innerHTML = this.standingsTable();
  },

  /** 打撃成績（打順の順に並べる） */
  batTable: function () {
    const rows = this.result.batters.map(function (b) {
      const p = b.player;
      return '' +
        '<tr>' +
          '<td class="num">' + b.order + '</td>' +
          '<td class="nm">' + esc(p.name) + '<small>' + esc(posName(b.pos)) + '</small></td>' +
          '<td class="num">' + b.pa + '</td>' +
          '<td class="num">' + b.ab + '</td>' +
          '<td class="num strong">' + fmtAvg(b.avg) + '</td>' +
          '<td class="num">' + b.hr + '</td>' +
          '<td class="num">' + b.rbi + '</td>' +
          '<td class="num">' + fmtAvg(b.ops) + '</td>' +
          '<td class="num">' + b.wrc + '</td>' +
          '<td class="num">' + (b.uzr === null ? '－' : fmtSigned(b.uzr)) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="tablewrap"><table class="stat-table">' +
        '<thead><tr>' +
          '<th>打順</th><th>選手</th><th>打席</th><th>打数</th><th>打率</th>' +
          '<th>本塁打</th><th>打点</th><th>OPS</th><th>wRC+</th><th>UZR</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="table-note">' +
        '← → 表は横にスクロールできます。<br>' +
        'wRC+ … 打撃をリーグ平均と比べた数字。100が平均で、大きいほど良い。<br>' +
        'UZR … 守備で防いだ失点。0が平均。DHの選手は守備に就かないので「－」。' +
      '</p>';
  },

  /** 投球成績 */
  pitTable: function () {
    const order = { '先発': 0, '抑え': 1, 'セットアッパー': 2, '中継ぎ': 3 };
    const list = this.result.pitchers.slice().sort(function (a, b) {
      if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
      return b.ip - a.ip;
    });

    const rows = list.map(function (p) {
      return '' +
        '<tr>' +
          '<td class="nm">' + esc(p.player.name) + '<small>' + esc(p.role) + '</small></td>' +
          '<td class="num">' + fmtIp(p.ip) + '</td>' +
          '<td class="num">' + p.w + '勝' + p.l + '敗</td>' +
          '<td class="num strong">' + fmtEra(p.era) + '</td>' +
          '<td class="num">' + p.so + '</td>' +
          '<td class="num">' + p.bb + '</td>' +
          '<td class="num">' + p.hbp + '</td>' +
          '<td class="num">' + (p.sv !== null && p.sv !== undefined ? p.sv + 'S'
              : (p.hld !== null && p.hld !== undefined ? p.hld + 'H' : '－')) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="tablewrap"><table class="stat-table">' +
        '<thead><tr>' +
          '<th>投手</th><th>投球回</th><th>勝敗</th><th>防御率</th>' +
          '<th>奪三振</th><th>与四球</th><th>与死球</th><th>S/H</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="table-note">← → 表は横にスクロールできます。<br>S＝セーブ、H＝ホールド。投球回の「.1」「.2」は1/3回・2/3回のことです。</p>';
  },

  /** 順位表 */
  standingsTable: function () {
    const rows = this.result.standings.map(function (r) {
      return '' +
        '<tr class="' + (r.team.isUser ? 'is-me' : '') + '">' +
          '<td class="num">' + r.rank + '</td>' +
          '<td class="nm">' + esc(r.team.name) + (r.team.isUser ? '<i class="tag-own">自分</i>' : '') + '</td>' +
          '<td class="num">' + (r.w + r.l + r.d) + '</td>' +
          '<td class="num">' + r.w + '</td>' +
          '<td class="num">' + r.l + '</td>' +
          '<td class="num">' + r.d + '</td>' +
          '<td class="num strong">' + fmtAvg(r.pct) + '</td>' +
          '<td class="num">' + (r.gb === 0 ? '－' : r.gb.toFixed(1)) + '</td>' +
        '</tr>';
    }).join('');

    const mine = this.result.mine;
    return '' +
      '<p class="rank-lead">' + CONFIG.LEAGUE_TEAMS + 'チーム中 <b>' + mine.rank + '位</b></p>' +
      '<div class="tablewrap"><table class="stat-table">' +
        '<thead><tr><th>順位</th><th>チーム</th><th>試合</th><th>勝</th><th>敗</th>' +
        '<th>分</th><th>勝率</th><th>差</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="table-note">' +
        '勝率は引き分けを除いて計算しています（勝÷（勝＋敗））。<br>' +
        '※ 自分以外の6球団の成績は、このゲームによる架空のシミュレーションです。' +
      '</p>';
  },

  /* ==================================================
     次に進むボタン
     ================================================== */
  renderNext: function () {
    const r = this.result;
    const rank = r.mine.rank;

    const csBtn = document.getElementById('btn-cs');
    const nsBtn = document.getElementById('btn-ns');
    const note = document.getElementById('sr-next-note');
    const final = document.getElementById('sr-final');

    csBtn.hidden = true;
    nsBtn.hidden = true;
    final.innerHTML = '';

    if (!r.cs) {
      if (rank <= 3) {
        csBtn.hidden = false;
        note.textContent = CONFIG.LEAGUE_TEAMS + 'チーム中' + rank + '位。クライマックスシリーズに進めます。';
      } else {
        note.textContent = CONFIG.LEAGUE_TEAMS + 'チーム中' + rank + '位。CS進出はなりませんでした。';
        this.renderFinal();
      }
      return;
    }

    // CSは終わっている
    this.renderSeries();
    if (r.cs.won && !r.ns) {
      nsBtn.hidden = false;
      note.textContent = 'クライマックスシリーズを突破しました！';
      return;
    }
    note.textContent = '';
    this.renderFinal();
  },

  /* ==================================================
     クライマックスシリーズ
     ================================================== */
  runCS: function () {
    const r = this.result;
    const cs = Season.playCS(r.standings);
    const iWon = cs.winner.isUser;

    r.cs = {
      first: { a: cs.first.a, b: cs.first.b,
               names: [r.standings[1].team.name, r.standings[2].team.name],
               winner: cs.first.winner.name },
      final: { a: cs.final.a, b: cs.final.b,
               names: [r.standings[0].team.name, cs.first.winner.name],
               winner: cs.final.winner.name },
      won: iWon,
      champion: cs.winner.name,
    };
    r.save.cs = r.cs;
    Storage.save(Game.state);

    this.renderNext();
    document.getElementById('sr-series').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ==================================================
     日本シリーズ
     ================================================== */
  runNS: function () {
    const r = this.result;
    const other = r.league.key === 'central' ? 'パ・リーグ代表' : 'セ・リーグ代表';
    const me = { name: r.teamName, isUser: true, pyth: r.mine.team.pyth };
    const ns = Season.playNipponSeries(me, other);

    r.ns = {
      rival: ns.rival.name,
      a: ns.series.a, b: ns.series.b,
      won: ns.winner.isUser === true,
    };
    r.save.ns = r.ns;
    Storage.save(Game.state);

    this.renderNext();

    if (r.ns.won) {
      const ov = document.getElementById('complete-overlay');
      ov.querySelector('.complete__big').textContent = '日本一！';
      ov.querySelector('.complete__sub').textContent = r.teamName + ' が日本の頂点に立ちました';
      ov.classList.add('is-on');
      setTimeout(function () { ov.classList.remove('is-on'); }, 2600);
    }
    document.getElementById('sr-series').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /** CS・日本シリーズの結果を表示する */
  renderSeries: function () {
    const r = this.result;
    const host = document.getElementById('sr-series');
    if (!r.cs) { host.innerHTML = ''; return; }

    let html = '<h2 class="section__title">ポストシーズン</h2><ul class="series">';
    html += '<li><span class="series__label">CS 1st</span>' +
      esc(r.cs.first.names[0]) + ' ' + r.cs.first.a + ' － ' + r.cs.first.b + ' ' +
      esc(r.cs.first.names[1]) + '<b>' + esc(r.cs.first.winner) + ' 突破</b></li>';
    html += '<li><span class="series__label">CS Final</span>' +
      esc(r.cs.final.names[0]) + ' ' + r.cs.final.a + ' － ' + r.cs.final.b + ' ' +
      esc(r.cs.final.names[1]) + '<b>' + esc(r.cs.final.winner) + ' 優勝</b></li>';

    if (r.ns) {
      html += '<li><span class="series__label">日本シリーズ</span>' +
        esc(r.teamName) + ' ' + r.ns.a + ' － ' + r.ns.b + ' ' + esc(r.ns.rival) +
        '<b>' + (r.ns.won ? '日本一！' : esc(r.ns.rival) + ' が日本一') + '</b></li>';
    }
    html += '</ul>';
    host.innerHTML = html;
  },

  /* ==================================================
     最終結果
     ================================================== */

  /** 今シーズンの結末をひとことで表す */
  outcome: function () {
    const r = this.result;
    if (r.ns && r.ns.won) return { key: 'nippon', label: '日本一', icon: '🏆' };
    if (r.ns) return { key: 'ns', label: '日本シリーズ進出', icon: '🎌' };
    if (r.cs && r.cs.won) return { key: 'csWin', label: 'リーグ優勝（CS制覇）', icon: '🎉' };
    if (r.cs) return { key: 'cs', label: 'CS敗退', icon: '🔥' };
    if (r.mine.rank <= 3) return { key: 'csReady', label: 'CS進出', icon: '🔥' };
    return { key: 'out', label: 'シーズン終了', icon: '⚾' };
  },

  renderFinal: function () {
    const r = this.result;
    const o = this.outcome();
    const mine = r.mine;

    document.getElementById('sr-final').innerHTML = '' +
      '<div class="final' + (o.key === 'nippon' ? ' final--gold' : '') + '">' +
        '<p class="final__icon">' + o.icon + '</p>' +
        '<h2 class="final__label">' + esc(o.label) + '</h2>' +
        '<p class="final__record">' +
          CONFIG.LEAGUE_TEAMS + 'チーム中 <b>' + mine.rank + '位</b>　' +
          mine.w + '勝 ' + mine.l + '敗 ' + mine.d + '分　勝率 ' + fmtAvg(mine.pct) +
        '</p>' +
      '</div>';

    document.getElementById('sr-actions').hidden = false;
  },

  /* ==================================================
     画像とシェア
     ================================================== */
  makeImage: function () {
    const canvas = SeasonImage.draw(this.result, this.outcome());
    const overlay = document.getElementById('image-overlay');
    const box = document.getElementById('image-box');

    box.innerHTML = '';
    const img = new Image();
    img.alt = '最強チームメーカーのシーズン結果画像';
    img.src = canvas.toDataURL('image/png');
    box.appendChild(img);

    const link = document.getElementById('image-download');
    link.href = img.src;
    link.download = 'saikyo-team-season.png';

    overlay.classList.add('is-on');
  },

  shareX: function () {
    const r = this.result;
    const o = this.outcome();
    const mine = r.mine;

    const lines = [
      '最強チームメーカーで' + CONFIG.SEASON_GAMES + '試合を戦った結果……',
      '',
      '【' + r.league.name + '】' + r.teamName,
      CONFIG.LEAGUE_TEAMS + 'チーム中' + mine.rank + '位　' +
        mine.w + '勝' + mine.l + '敗' + mine.d + '分（勝率' + fmtAvg(mine.pct) + '）',
    ];

    if (o.key === 'nippon')      lines.push('', 'CSも突破して日本一になりました！🏆');
    else if (o.key === 'ns')     lines.push('', '日本シリーズまで行きました！');
    else if (o.key === 'csWin')  lines.push('', 'CSを勝ち抜いてリーグ優勝！');
    else if (o.key === 'cs')     lines.push('', 'CSで敗退…来年こそ。');
    else if (mine.rank <= 3)     lines.push('', 'CS進出を決めました！');
    else                         lines.push('', 'CSには届きませんでした…');

    lines.push('', 'あなたならこのチームで勝てますか？');

    const href = 'https://twitter.com/intent/tweet' +
      '?text=' + encodeURIComponent(lines.join('\n')) +
      '&url=' + encodeURIComponent(location.origin + location.pathname);
    window.open(href, '_blank', 'noopener');
  },
};
