/* ==================================================
   最強チームメーカー  lineup.js
   集めた9人の「打順」と「守備位置」を決める画面。
   ================================================== */
'use strict';

const Lineup = {

  /* slots[0] が1番打者。各要素は { playerId, pos } */
  slots: [],

  el: {},

  init: function () {
    this.el = {
      list:    document.getElementById('l-list'),
      warn:    document.getElementById('l-warn'),
      done:    document.getElementById('btn-lineup-done'),
      auto:    document.getElementById('btn-lineup-auto'),
    };

    const self = this;
    this.el.done.addEventListener('click', function () { self.complete(); });
    this.el.auto.addEventListener('click', function () { self.autoAssign(); });

    // 行の中のボタンはあとから作られるので、親でまとめて受け取る
    this.el.list.addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const i = Number(btn.closest('.slot').dataset.index);
      if (btn.dataset.act === 'up')   self.move(i, -1);
      if (btn.dataset.act === 'down') self.move(i, 1);
    });

    this.el.list.addEventListener('change', function (ev) {
      const sel = ev.target.closest('select[data-pos-select]');
      if (!sel) return;
      const i = Number(sel.closest('.slot').dataset.index);
      self.slots[i].pos = sel.value;
      self.save();
      self.render();
    });
  },

  /** 9人を受け取って画面を作る */
  start: function (players) {
    this.slots = players.map(function (p) {
      return { playerId: p.id, pos: '' };
    });
    this.autoAssign();
  },

  /** 保存された編成から再開 */
  resume: function (slots) {
    this.slots = slots;
    this.render();
  },

  playerAt: function (i) {
    return PlayerPool.get(this.slots[i].playerId);
  },

  /** 打順を1つ入れ替える */
  move: function (i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.slots.length) return;
    const tmp = this.slots[i];
    this.slots[i] = this.slots[j];
    this.slots[j] = tmp;
    this.save();
    this.render();
  },

  /**
   * おまかせ配置。
   * 守るのが難しい位置から順に、いちばん適性の高い人を当てはめる。
   * （最適解を探すわけではないので、手で直したほうが良くなることもある）
   */
  autoAssign: function () {
    const priority = ['投', '捕', '遊', '中', '二', '三', '右', '左', '一'];
    const rank = { 'A': 3, 'B': 2, 'C': 1, '-': 0 };

    const rest = this.slots.map(function (s, i) { return i; });
    const self = this;

    this.slots.forEach(function (s) { s.pos = ''; });

    priority.forEach(function (pos) {
      let best = -1, bestScore = -1;
      rest.forEach(function (i) {
        const p = self.playerAt(i);
        const score = rank[fitOf(p, pos)] * 1000 + p.r.field;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) {
        self.slots[best].pos = pos;
        rest.splice(rest.indexOf(best), 1);
      }
    });

    // 打順も軽く整える：足の速い人を上位、長打のある人を3〜5番に
    this.autoOrder();
    this.save();
    this.render();
  },

  autoOrder: function () {
    const self = this;
    const withScore = this.slots.map(function (s) {
      const p = PlayerPool.get(s.playerId);
      return { slot: s, p: p };
    });

    // 打撃が良い順に並べたうえで、1・2番は足、3〜5番は長打を優先する
    withScore.sort(function (a, b) { return b.p.r.bat - a.p.r.bat; });

    const top = withScore.slice(0, 5);
    const rest = withScore.slice(5);

    top.sort(function (a, b) { return b.p.r.run - a.p.r.run; });
    const lead = top.slice(0, 2);                      // 1・2番
    const mid = top.slice(2);
    mid.sort(function (a, b) { return b.p.r.power - a.p.r.power; });  // 3〜5番

    rest.sort(function (a, b) { return b.p.r.bat - a.p.r.bat; });

    this.slots = lead.concat(mid, rest).map(function (x) { return x.slot; });
  },

  /** 守備位置がダブっていないか・全部埋まっているか */
  check: function () {
    const used = {};
    const dup = {};
    let empty = 0;

    this.slots.forEach(function (s) {
      if (!s.pos) { empty++; return; }
      if (used[s.pos]) dup[s.pos] = true;
      used[s.pos] = true;
    });

    const missing = POS_KEYS.filter(function (k) { return !used[k]; });
    return {
      ok: empty === 0 && Object.keys(dup).length === 0,
      empty: empty,
      dup: dup,
      missing: missing,
    };
  },

  render: function () {
    const self = this;
    const state = this.check();

    this.el.list.innerHTML = this.slots.map(function (s, i) {
      const p = self.playerAt(i);
      const grade = s.pos ? fitOf(p, s.pos) : '-';
      const isDup = s.pos && state.dup[s.pos];

      const options = POS_KEYS.map(function (key) {
        const g = fitOf(p, key);
        const taken = self.slots.some(function (o, j) { return j !== i && o.pos === key; });
        return '<option value="' + key + '"' + (s.pos === key ? ' selected' : '') + '>' +
          posName(key) + '（' + FIT_LABEL[g] + '）' + (taken ? ' ※重複' : '') +
          '</option>';
      }).join('');

      return '' +
        '<li class="slot' + (isDup ? ' slot--dup' : '') + '" data-index="' + i + '">' +
          '<div class="slot__order">' + (i + 1) + '<small>番</small></div>' +
          '<div class="slot__body">' +
            '<div class="slot__name">' + esc(p.name) +
              '<span class="slot__meta">' + esc(p.team) + ' ' + p.year + '　本職:' + esc(posName(p.pos)) + '</span>' +
            '</div>' +
            '<div class="slot__pick">' +
              '<select data-pos-select aria-label="' + esc(p.name) + 'の守備位置">' + options + '</select>' +
              '<span class="fit fit--' + grade + '">' + FIT_LABEL[grade] + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="slot__move">' +
            '<button type="button" data-act="up" aria-label="打順を上げる"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
            '<button type="button" data-act="down" aria-label="打順を下げる"' + (i === 8 ? ' disabled' : '') + '>▼</button>' +
          '</div>' +
        '</li>';
    }).join('');

    // 注意書き
    if (state.ok) {
      this.el.warn.className = 'warn warn--ok';
      this.el.warn.textContent = '9つの守備位置がすべて埋まりました。';
      this.el.done.disabled = false;
    } else {
      this.el.warn.className = 'warn';
      const parts = [];
      if (Object.keys(state.dup).length) {
        parts.push('同じ守備位置が重なっています（' +
          Object.keys(state.dup).map(posName).join('・') + '）');
      }
      if (state.missing.length) {
        parts.push('空いている守備位置：' + state.missing.map(posName).join('・'));
      }
      this.el.warn.textContent = parts.join(' / ');
      this.el.done.disabled = true;
    }
  },

  /** 「完成！」 */
  complete: function () {
    if (!this.check().ok) return;

    const lineup = this.slots.map(function (s) {
      return { player: PlayerPool.get(s.playerId), pos: s.pos };
    });

    Game.state.phase = 'result';
    Game.state.lineup = this.slots;
    this.save();

    Result.show(lineup);
    showScreen(SCREENS.RESULT);
  },

  save: function () {
    Game.state.lineup = this.slots;
    Storage.save(Game.state);
  },
};
