/* ==================================================
   最強チームメーカー  lineup.js
   集めた10人の「打順」と「守備位置」を決める画面。

   ・DH制あり（パ・リーグ）… 打順は野手9人。投手は投げるだけで打席に立たない。
                             野手9人のうち8人が守備、1人がDH（指名打者）。
   ・DH制なし（セ・リーグ）… 打順は投手＋野手8人。野手1人はスタメンから外れる。
   ================================================== */
'use strict';

const Lineup = {

  slots: [],        // 打順。slots[0] が1番打者。{ playerId, pos }
  pitcherId: null,  // 投手（DH制ありのときは打順に入らない）
  benchId: null,    // DH制なしのとき、スタメンから外れる野手
  useDH: true,
  onDone: null,     // 「完成！」を押したときに呼ぶ処理（差し替え可能）

  el: {},

  init: function () {
    this.el = {
      list: document.getElementById('l-list'),
      warn: document.getElementById('l-warn'),
      head: document.getElementById('l-head'),
      done: document.getElementById('btn-lineup-done'),
      auto: document.getElementById('btn-lineup-auto'),
    };

    const self = this;
    this.el.done.addEventListener('click', function () { self.complete(); });
    this.el.auto.addEventListener('click', function () { self.autoAssign(); });

    this.el.list.addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const i = Number(btn.closest('.slot').dataset.index);
      if (btn.dataset.act === 'up')   self.move(i, -1);
      if (btn.dataset.act === 'down') self.move(i, 1);
    });

    this.el.list.addEventListener('change', function (ev) {
      const sel = ev.target.closest('select[data-pos-select]');
      if (sel) {
        const i = Number(sel.closest('.slot').dataset.index);
        self.slots[i].pos = sel.value;
        self.save();
        self.render();
        return;
      }
      const bench = ev.target.closest('select[data-bench-select]');
      if (bench) {
        self.setBench(bench.value);
      }
    });
  },

  /** 選べる守備位置の一覧 */
  keys: function () {
    return this.useDH ? DH_LINEUP_KEYS : NODH_LINEUP_KEYS;
  },

  /**
   * 10人を受け取って画面を作る。
   * @param {Array}  entries [{ player, role }] の10人
   * @param {Object} options { useDH: true/false, onDone: 関数 }
   */
  start: function (entries, options) {
    const opt = options || {};
    this.useDH = opt.useDH !== false;
    this.onDone = opt.onDone || null;

    const pitcher = entries.find(function (e) { return e.role === 'pitcher'; });
    this.pitcherId = pitcher ? pitcher.player.id : null;

    this.fielderIds = entries
      .filter(function (e) { return e.role === 'fielder'; })
      .map(function (e) { return e.player.id; });

    this.benchId = null;
    this.autoAssign();
  },

  /** 保存された編成から再開 */
  resume: function (saved) {
    this.useDH = saved.useDH !== false;
    this.slots = saved.slots;
    this.pitcherId = saved.pitcherId;
    this.benchId = saved.benchId || null;
    this.fielderIds = saved.fielderIds || [];
    this.render();
  },

  playerAt: function (i) {
    return PlayerPool.get(this.slots[i].playerId);
  },

  move: function (i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.slots.length) return;
    const tmp = this.slots[i];
    this.slots[i] = this.slots[j];
    this.slots[j] = tmp;
    this.save();
    this.render();
  },

  /** DH制なしのとき、スタメンから外す野手を変える */
  setBench: function (id) {
    this.benchId = id;
    this.autoAssign();
  },

  /**
   * おまかせ配置。
   * 守るのが難しい位置から順に、いちばん適性の高い人を当てはめる。
   */
  autoAssign: function () {
    const self = this;
    const rank = { 'A': 3, 'B': 2, 'C': 1, '-': 0 };

    // --- 打順に入る選手を決める ---
    let members;   // [{ playerId, pos }]
    if (this.useDH) {
      members = this.fielderIds.map(function (id) { return { playerId: id, pos: '' }; });
    } else {
      // 打撃がいちばん弱い野手をスタメンから外す（変更もできる）
      if (!this.benchId || this.fielderIds.indexOf(this.benchId) === -1) {
        const worst = this.fielderIds.slice().sort(function (a, b) {
          return PlayerPool.get(a).r.bat - PlayerPool.get(b).r.bat;
        })[0];
        this.benchId = worst;
      }
      members = this.fielderIds
        .filter(function (id) { return id !== self.benchId; })
        .map(function (id) { return { playerId: id, pos: '' }; });
      members.push({ playerId: this.pitcherId, pos: '投' });
    }

    this.slots = members;

    // --- 守備位置を決める（DH制なしのときは投手の枠は固定） ---
    const priority = this.useDH
      ? ['捕', '遊', '中', '二', '三', '右', '左', '一', DH_KEY]
      : ['捕', '遊', '中', '二', '三', '右', '左', '一'];

    const rest = [];
    this.slots.forEach(function (s, i) { if (s.pos !== '投') rest.push(i); });

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

    this.autoOrder();
    this.save();
    this.render();
  },

  /** 打順を整える：足の速い人を上位、長打のある人を3〜5番に */
  autoOrder: function () {
    const withP = this.slots.map(function (s) {
      return { slot: s, p: PlayerPool.get(s.playerId) };
    });

    withP.sort(function (a, b) { return b.p.r.bat - a.p.r.bat; });

    const top = withP.slice(0, 5);
    const rest = withP.slice(5);

    top.sort(function (a, b) { return b.p.r.run - a.p.r.run; });
    const lead = top.slice(0, 2);
    const mid = top.slice(2);
    mid.sort(function (a, b) { return b.p.r.power - a.p.r.power; });

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

    const missing = this.keys().filter(function (k) { return !used[k]; });
    return {
      ok: empty === 0 && Object.keys(dup).length === 0 && missing.length === 0,
      empty: empty, dup: dup, missing: missing,
    };
  },

  render: function () {
    const self = this;
    const state = this.check();
    const keys = this.keys();

    // --- 投手の表示（DH制ありのときは打順の外） ---
    const pitcher = PlayerPool.get(this.pitcherId);
    if (this.useDH && pitcher) {
      this.el.head.innerHTML = '' +
        '<div class="fixed-slot">' +
          '<span class="row__pos" data-pos="投">投</span>' +
          '<span class="row__name">' + esc(pitcher.name) +
            '<small>' + esc(pitcher.team) + ' ' + pitcher.year + '・先発投手（DH制なので打席に立ちません）</small>' +
          '</span>' +
        '</div>';
    } else if (!this.useDH) {
      const bench = PlayerPool.get(this.benchId);
      this.el.head.innerHTML = '' +
        '<div class="fixed-slot fixed-slot--bench">' +
          '<span class="fixed-slot__label">スタメン外</span>' +
          '<select data-bench-select aria-label="スタメンから外す野手">' +
            this.fielderIds.map(function (id) {
              const p = PlayerPool.get(id);
              return '<option value="' + id + '"' + (id === self.benchId ? ' selected' : '') + '>' +
                esc(p.name) + '（' + esc(posName(p.pos)) + '）</option>';
            }).join('') +
          '</select>' +
          '<span class="fixed-slot__note">DH制がないので、野手1人はベンチです</span>' +
        '</div>';
      if (bench) { /* 表示済み */ }
    } else {
      this.el.head.innerHTML = '';
    }

    // --- 打順 ---
    this.el.list.innerHTML = this.slots.map(function (s, i) {
      const p = self.playerAt(i);
      const grade = s.pos ? fitOf(p, s.pos) : '-';
      const isDup = s.pos && state.dup[s.pos];
      const fixed = !self.useDH && s.playerId === self.pitcherId;   // 投手の枠は動かさない

      const options = keys.map(function (key) {
        const g = fitOf(p, key);
        const taken = self.slots.some(function (o, j) { return j !== i && o.pos === key; });
        return '<option value="' + key + '"' + (s.pos === key ? ' selected' : '') + '>' +
          posName(key) + '（' + FIT_LABEL[g] + '）' + (taken ? ' ※重複' : '') + '</option>';
      }).join('');

      const picker = fixed
        ? '<span class="slot__fixed">投手</span>'
        : '<select data-pos-select aria-label="' + esc(p.name) + 'の守備位置">' + options + '</select>';

      return '' +
        '<li class="slot' + (isDup ? ' slot--dup' : '') + '" data-index="' + i + '">' +
          '<div class="slot__order">' + (i + 1) + '<small>番</small></div>' +
          '<div class="slot__body">' +
            '<div class="slot__name">' + esc(p.name) +
              (p.kind === 'twoway' ? '<i class="tag-tw">二刀流</i>' : '') +
              '<span class="slot__meta">' + esc(p.team) + ' ' + p.year +
                '　本職:' + esc(posName(p.pos)) + '</span>' +
            '</div>' +
            '<div class="slot__pick">' + picker +
              '<span class="fit fit--' + grade + '">' + FIT_LABEL[grade] + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="slot__move">' +
            '<button type="button" data-act="up" aria-label="打順を上げる"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
            '<button type="button" data-act="down" aria-label="打順を下げる"' + (i === 8 ? ' disabled' : '') + '>▼</button>' +
          '</div>' +
        '</li>';
    }).join('');

    // --- 注意書き ---
    if (state.ok) {
      this.el.warn.className = 'warn warn--ok';
      this.el.warn.textContent = this.useDH
        ? '守備8か所とDHがすべて埋まりました。'
        : '9つの守備位置がすべて埋まりました。';
      this.el.done.disabled = false;
    } else {
      this.el.warn.className = 'warn';
      const parts = [];
      if (Object.keys(state.dup).length) {
        parts.push('同じ場所が重なっています（' +
          Object.keys(state.dup).map(posName).join('・') + '）');
      }
      if (state.missing.length) {
        parts.push('空いている場所：' + state.missing.map(posName).join('・'));
      }
      this.el.warn.textContent = parts.join(' / ');
      this.el.done.disabled = true;
    }
  },

  /** 評価やシミュレーションに渡す形にまとめる */
  build: function () {
    const self = this;
    const order = this.slots.map(function (s) {
      return { player: PlayerPool.get(s.playerId), pos: s.pos };
    });

    // 守備についている9人（投手＋守備位置に就いた8人）
    const defense = order
      .filter(function (o) { return o.pos !== DH_KEY; })
      .map(function (o) { return o; });

    if (this.useDH) {
      defense.unshift({ player: PlayerPool.get(this.pitcherId), pos: '投' });
    }

    return {
      order: order,
      defense: defense,
      pitcher: PlayerPool.get(this.pitcherId),
      bench: this.benchId ? PlayerPool.get(this.benchId) : null,
      useDH: this.useDH,
    };
  },

  /** 「完成！」 */
  complete: function () {
    if (!this.check().ok) return;
    this.save();

    if (this.onDone) { this.onDone(this.build()); return; }

    Game.state.phase = 'result';
    Storage.save(Game.state);
    Result.show(this.build());
    showScreen(SCREENS.RESULT);
  },

  save: function () {
    Game.state.lineup = {
      slots: this.slots,
      pitcherId: this.pitcherId,
      benchId: this.benchId,
      fielderIds: this.fielderIds,
      useDH: this.useDH,
    };
    Storage.save(Game.state);
  },
};
