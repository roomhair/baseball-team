/* ==================================================
   最強チームメーカー  game.js
   選手を集めるところ（獲得フェーズ）の進行。

   【ルール】
   ・集めるのは10人。内訳は「投手1人＋野手9人」で固定
   ・投手を1人取ったら、それ以降は通常の投手が出てこない
   ・残り枠が野手だけになったら、野手しか出てこない
   ・二刀流選手は「投手として取る／野手として取る」を選べる
   ・見送りは5回まで。ただし残り枠が少なくなったら見送れない
   ================================================== */
'use strict';

const Game = {

  /* --- 今の状況 --- */
  state: {
    picked: [],      // [{ id: 選手ID, role: 'pitcher' | 'fielder' }]
    passLeft: 0,     // 見送りの残り回数
    currentId: null, // いま画面に出ている選手のID
    seen: 0,         // 何人目の登場か
    phase: 'draft',
    lineup: null,
    rest: null,      // 10人そろったあとに出る予定だった選手のID
  },

  el: {},

  init: function () {
    this.el = {
      count:    document.getElementById('g-count'),
      passLeft: document.getElementById('g-pass-left'),
      progress: document.getElementById('g-progress'),
      need:     document.getElementById('g-need'),
      card:     document.getElementById('g-card'),
      roster:   document.getElementById('g-roster'),
      choice:   document.getElementById('g-choice'),
      take:     document.getElementById('btn-take'),
      takeP:    document.getElementById('btn-take-p'),
      takeF:    document.getElementById('btn-take-f'),
      pass:     document.getElementById('btn-pass'),
      flash:    document.getElementById('g-flash'),
    };

    const self = this;
    this.el.take.addEventListener('click',  function () { self.take(); });
    this.el.takeP.addEventListener('click', function () { self.take('pitcher'); });
    this.el.takeF.addEventListener('click', function () { self.take('fielder'); });
    this.el.pass.addEventListener('click',  function () { self.pass(); });
  },

  /* ==================================================
     状況を調べる
     ================================================== */

  /** あと何人必要か */
  need: function () {
    const p = this.state.picked.filter(function (x) { return x.role === 'pitcher'; }).length;
    const f = this.state.picked.filter(function (x) { return x.role === 'fielder'; }).length;
    return {
      pitcher: Math.max(0, CONFIG.PITCHER_SLOTS - p),
      fielder: Math.max(0, CONFIG.FIELDER_SLOTS - f),
      pitcherHave: p,
      fielderHave: f,
    };
  },

  /** 残りの枠 */
  remaining: function () {
    return CONFIG.TEAM_SIZE - this.state.picked.length;
  },

  /** いま「見送る」を押せるか */
  canPass: function () {
    if (this.state.passLeft <= 0) return false;
    // 10人そろえるほうを優先する。残り枠が少ないときは見送れない。
    if (this.remaining() <= CONFIG.FORCE_PICK_WHEN_REMAINING) return false;
    return true;
  },

  /** 獲得済み選手（オブジェクト＋役割） */
  pickedEntries: function () {
    return this.state.picked.map(function (x) {
      return { player: PlayerPool.get(x.id), role: x.role };
    }).filter(function (x) { return !!x.player; });
  },

  pickedPlayers: function () {
    return this.pickedEntries().map(function (x) { return x.player; });
  },

  /* ==================================================
     進行
     ================================================== */

  start: function () {
    this.state = {
      picked: [], passLeft: CONFIG.PASS_LIMIT, currentId: null,
      seen: 0, phase: 'draft', lineup: null, rest: null,
    };
    this.next();
  },

  resume: function (saved) {
    this.state = saved;
    if (!this.state.currentId) this.next();
    else this.render();
  },

  next: function () {
    const usedNames = this.pickedPlayers().map(function (p) { return p.name; });
    const p = PlayerPool.draw(usedNames, this.need());
    if (!p) {
      this.el.card.innerHTML = '<p class="placeholder">出せる選手がいなくなりました。</p>';
      return;
    }
    this.state.currentId = p.id;
    this.state.seen++;
    this.save();
    this.render();
  },

  /**
   * 「取る」
   * @param {string} role 'pitcher' か 'fielder'。省略すると選手の種類から決める
   */
  take: function (role) {
    const p = PlayerPool.get(this.state.currentId);
    if (!p) return;

    const as = role || (p.pos === '投' ? 'pitcher' : 'fielder');
    const need = this.need();

    // 押せないはずのボタンが押された場合の保険
    if (as === 'pitcher' && need.pitcher <= 0) return;
    if (as === 'fielder' && need.fielder <= 0) return;

    this.state.picked.push({ id: p.id, role: as });
    this.flash(as === 'pitcher' ? '投手として獲得！' : '獲得！', 'ok');

    if (this.state.picked.length >= CONFIG.TEAM_SIZE) {
      this.state.currentId = null;
      this.state.phase = 'roster';
      this.buildRest();
      this.save();
      this.renderHeader();
      this.el.roster.innerHTML = UI.rosterChips(this.pickedEntries());
      const self = this;
      setTimeout(function () { self.finish(); }, 450);
      return;
    }

    this.next();
  },

  /** 「見送る」 */
  pass: function () {
    if (!this.canPass()) return;
    this.state.passLeft--;
    this.flash('見送り　残り ' + this.state.passLeft + ' 回', 'pass');
    this.next();
  },

  /**
   * 10人そろったあと、「本来この先に出る予定だった選手」を作る。
   *
   * 登場のチャンスは全部で「10人＋見送り5回＝15回」ある。
   * 見送りをあまり使わずに10人そろえると、その回数ぶんが余る。
   * 余った回数のぶんだけ選手を作って、おまけとして見せる。
   */
  buildRest: function () {
    const totalChances = CONFIG.TEAM_SIZE + CONFIG.PASS_LIMIT;
    const usedChances = this.state.seen;
    const left = Math.max(0, totalChances - usedChances);

    const names = this.pickedPlayers().map(function (p) { return p.name; });
    const rest = [];
    for (let i = 0; i < left; i++) {
      // おまけ表示なので、枠の制限は考えずに引く
      const p = PlayerPool.draw(names, { pitcher: 1, fielder: 1 });
      if (!p) break;
      rest.push(p.id);
      names.push(p.name);
    }
    this.state.rest = rest;
  },

  /** 10人そろったときの演出 → メンバー確認画面へ */
  finish: function () {
    const overlay = document.getElementById('complete-overlay');
    overlay.querySelector('.complete__big').textContent = 'メンバーが揃いました！';
    overlay.querySelector('.complete__sub').textContent =
      '投手1人・野手9人の10人が集まりました';
    overlay.classList.add('is-on');

    setTimeout(function () {
      overlay.classList.remove('is-on');
      Roster.show();
      showScreen(SCREENS.ROSTER);
    }, 1700);
  },

  /* ==================================================
     画面を描き直す
     ================================================== */
  render: function () {
    this.renderHeader();

    const p = PlayerPool.get(this.state.currentId);
    if (p) this.el.card.innerHTML = UI.playerCard(p);

    this.el.roster.innerHTML = UI.rosterChips(this.pickedEntries());
    this.renderChoice(p);
  },

  /** 「取る／見送る」ボタンの出し分け */
  renderChoice: function (p) {
    if (!p) return;
    const need = this.need();
    const isTwoWay = p.kind === 'twoway';

    // --- 二刀流は3択、それ以外は2択 ---
    this.el.choice.classList.toggle('choice--twoway', isTwoWay);
    this.el.take.hidden  = isTwoWay;
    this.el.takeP.hidden = !isTwoWay;
    this.el.takeF.hidden = !isTwoWay;

    if (isTwoWay) {
      this.el.takeP.disabled = need.pitcher <= 0;
      this.el.takeF.disabled = need.fielder <= 0;
      this.el.takeP.querySelector('.btn__sub').textContent =
        need.pitcher <= 0 ? '投手はもういる' : '投手枠に入れる';
      this.el.takeF.querySelector('.btn__sub').textContent =
        need.fielder <= 0 ? '野手はもう満員' : posName(p.pos) + 'として';
    } else {
      this.el.take.querySelector('.btn__sub').textContent =
        p.pos === '投' ? '投手枠に入れる' : 'チームに加える';
    }

    // --- 見送る ---
    const can = this.canPass();
    this.el.pass.disabled = !can;
    this.el.pass.querySelector('.btn__sub').textContent =
      this.state.passLeft <= 0 ? 'もう見送れない'
        : !can ? 'あと' + this.remaining() + '人。必ず取る'
        : '残り ' + this.state.passLeft + ' 回';
  },

  renderHeader: function () {
    const n = this.state.picked.length;
    const need = this.need();
    this.el.count.textContent = n + ' / ' + CONFIG.TEAM_SIZE;
    this.el.passLeft.textContent = '見送り残り：' + this.state.passLeft + '回';
    this.el.progress.style.width = (n / CONFIG.TEAM_SIZE * 100) + '%';
    this.el.need.textContent =
      '投手 ' + need.pitcherHave + '/' + CONFIG.PITCHER_SLOTS +
      '　野手 ' + need.fielderHave + '/' + CONFIG.FIELDER_SLOTS;
  },

  flash: function (text, kind) {
    const el = this.el.flash;
    el.textContent = text;
    el.className = 'flash flash--' + kind + ' is-on';
    setTimeout(function () { el.classList.remove('is-on'); }, 700);
  },

  save: function () {
    Storage.save(this.state);
  },
};
