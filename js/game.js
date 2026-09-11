/* ==================================================
   最強チームメーカー  game.js
   選手を集めるところ（ガチャ部分）の進行。
   ================================================== */
'use strict';

const Game = {

  /* --- 今の状況 --- */
  state: {
    picked: [],      // 獲得した選手のID
    passLeft: 0,     // 見送りの残り回数
    currentId: null, // いま画面に出ている選手のID
    seen: 0,         // 何人目か
    phase: 'draft',  // draft → lineup → result
    lineup: null,    // 編成が終わったら入る
  },

  /* --- 画面の部品 --- */
  el: {},

  init: function () {
    this.el = {
      count:    document.getElementById('g-count'),
      passLeft: document.getElementById('g-pass-left'),
      progress: document.getElementById('g-progress'),
      card:     document.getElementById('g-card'),
      roster:   document.getElementById('g-roster'),
      take:     document.getElementById('btn-take'),
      pass:     document.getElementById('btn-pass'),
      flash:    document.getElementById('g-flash'),
    };

    const self = this;
    this.el.take.addEventListener('click', function () { self.take(); });
    this.el.pass.addEventListener('click', function () { self.pass(); });
  },

  /** 最初から始める */
  start: function () {
    this.state = {
      picked: [],
      passLeft: CONFIG.PASS_LIMIT,
      currentId: null,
      seen: 0,
      phase: 'draft',
      lineup: null,
    };
    this.next();
  },

  /** 保存されていた状態から再開する */
  resume: function (saved) {
    this.state = saved;
    if (!this.state.currentId) this.next(true);
    else this.render();
  },

  /** 獲得済み選手の一覧（オブジェクト） */
  pickedPlayers: function () {
    return this.state.picked.map(function (id) { return PlayerPool.get(id); })
      .filter(Boolean);
  },

  /** 次の選手を出す */
  next: function (skipRender) {
    const usedNames = this.pickedPlayers().map(function (p) { return p.name; });
    const p = PlayerPool.draw(usedNames);
    if (!p) {
      // 出せる選手がいなくなった（まず起きない）
      this.el.card.innerHTML = '<p class="placeholder">出せる選手がいなくなりました。</p>';
      return;
    }
    this.state.currentId = p.id;
    this.state.seen++;
    this.save();
    if (!skipRender) this.render();
    else this.render();
  },

  /** 「取る」 */
  take: function () {
    const p = PlayerPool.get(this.state.currentId);
    if (!p) return;

    this.state.picked.push(p.id);
    this.flash('取った！', 'ok');

    if (this.state.picked.length >= CONFIG.TEAM_SIZE) {
      this.state.phase = 'lineup';
      this.state.currentId = null;
      this.save();
      this.renderHeader();
      this.el.roster.innerHTML = UI.rosterChips(this.pickedPlayers());
      const self = this;
      setTimeout(function () { self.finish(); }, 500);
      return;
    }

    this.next();
  },

  /** 「見送る」 */
  pass: function () {
    if (this.state.passLeft <= 0) return;
    this.state.passLeft--;
    this.flash('見送り　残り ' + this.state.passLeft + ' 回', 'pass');
    this.next();
  },

  /** 9人そろったときの演出 → 編成画面へ */
  finish: function () {
    const overlay = document.getElementById('complete-overlay');
    overlay.classList.add('is-on');
    overlay.querySelector('.complete__sub').textContent =
      '打順と守備位置を決めましょう';

    setTimeout(function () {
      overlay.classList.remove('is-on');
      Lineup.start(Game.pickedPlayers());
      showScreen(SCREENS.LINEUP);
    }, 1800);
  },

  /* --- 画面を描き直す --- */
  render: function () {
    this.renderHeader();

    const p = PlayerPool.get(this.state.currentId);
    if (p) this.el.card.innerHTML = UI.playerCard(p);

    this.el.roster.innerHTML = UI.rosterChips(this.pickedPlayers());

    // 見送りを使い切ったらボタンを押せなくする
    const out = this.state.passLeft <= 0;
    this.el.pass.disabled = out;
    this.el.pass.querySelector('.btn__sub').textContent =
      out ? 'もう見送れない' : '残り ' + this.state.passLeft + ' 回';
  },

  renderHeader: function () {
    const n = this.state.picked.length;
    this.el.count.textContent = n + ' / ' + CONFIG.TEAM_SIZE;
    this.el.passLeft.textContent = '見送り残り：' + this.state.passLeft + '回';
    this.el.progress.style.width = (n / CONFIG.TEAM_SIZE * 100) + '%';
  },

  /** 画面に短いメッセージをぱっと出す */
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
