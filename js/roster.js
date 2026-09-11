/* ==================================================
   最強チームメーカー  roster.js
   10人そろったあとの「メンバー確認画面」。

   ここから2つの道に分かれる。
     ・スタメンを組む            → 打順と守備位置を決めてチーム評価
     ・投手を補充してシーズン開始 → 投手を足して143試合を戦う
   ================================================== */
'use strict';

const Roster = {

  el: {},

  init: function () {
    this.el = {
      list: document.getElementById('ro-list'),
      rest: document.getElementById('ro-rest'),
    };

    document.getElementById('btn-go-lineup').addEventListener('click', function () {
      Game.state.phase = 'lineup';
      Lineup.start(Game.pickedEntries(), { useDH: true });
      Storage.save(Game.state);
      showScreen(SCREENS.LINEUP);
    });

    document.getElementById('btn-go-season').addEventListener('click', function () {
      Game.state.phase = 'season-setup';
      SeasonSetup.start();
      Storage.save(Game.state);
      showScreen(SCREENS.SEASON_SETUP);
    });
  },

  show: function () {
    const entries = Game.pickedEntries();

    // 投手を先頭にして並べる
    const sorted = entries.slice().sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'pitcher' ? -1 : 1;
      return POS_KEYS.indexOf(a.player.pos) - POS_KEYS.indexOf(b.player.pos);
    });

    this.el.list.innerHTML = UI.rosterRows(sorted, { number: false });

    // --- おまけ：本来この先に出る予定だった選手 ---
    const rest = (Game.state.rest || [])
      .map(function (id) { return PlayerPool.get(id); })
      .filter(Boolean);

    if (rest.length === 0) {
      this.el.rest.innerHTML = '';
      return;
    }

    const start = CONFIG.TEAM_SIZE + 1;
    this.el.rest.innerHTML = '' +
      '<h2 class="section__title">残りの候補選手</h2>' +
      '<p class="section__lead">' +
        '見送りを使い切る前に10人そろったので、この先に出る予定だった選手です。<br>' +
        'もう獲得はできません（おまけの表示です）。' +
      '</p>' +
      '<ol class="rest-list">' + rest.map(function (p, i) {
        const mark = p.kind === 'twoway' ? '刀' : p.pos;
        return '' +
          '<li class="rest-item">' +
            '<span class="rest-item__no">' + (start + i) + '人目</span>' +
            '<span class="row__pos" data-pos="' + (p.kind === 'twoway' ? '投' : p.pos) + '">' +
              esc(mark) + '</span>' +
            '<span class="row__name">' + esc(p.name) +
              '<small>' + esc(p.team) + ' ' + p.year + '・' + esc(posName(p.pos)) + '</small>' +
            '</span>' +
            '<span class="row__ovr">' + p.ovr + '</span>' +
          '</li>';
      }).join('') + '</ol>';
  },
};
