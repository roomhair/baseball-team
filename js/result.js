/* ==================================================
   最強チームメーカー  result.js
   完成したチームの結果画面。
   ================================================== */
'use strict';

const Result = {

  team: null,     // Lineup.build() が作った編成
  ev: null,       // 評価結果
  viewOnly: false, // 他人の結果を見ているだけのとき true

  /** 編成データから結果を表示する */
  show: function (team, options) {
    const opt = options || {};
    this.team = team;
    this.viewOnly = !!opt.viewOnly;
    this.ev = Evaluate.run(team);
    this.render();
  },

  /** 保存形式（{pitcherId, slots, useDH}）から表示する */
  showFromSaved: function (saved, options) {
    if (!saved || !Array.isArray(saved.slots)) return false;

    const order = saved.slots.map(function (s) {
      return { player: PlayerPool.get(s.playerId), pos: s.pos };
    });
    if (order.some(function (o) { return !o.player; })) return false;

    const pitcher = PlayerPool.get(saved.pitcherId);
    if (!pitcher) return false;

    const defense = order.filter(function (o) { return o.pos !== DH_KEY; });
    const useDH = saved.useDH !== false;
    if (useDH) defense.unshift({ player: pitcher, pos: '投' });

    this.show({
      order: order, defense: defense, pitcher: pitcher,
      bench: saved.benchId ? PlayerPool.get(saved.benchId) : null,
      useDH: useDH,
    }, options);
    return true;
  },

  render: function () {
    const ev = this.ev;
    const self = this;

    const host = document.getElementById('r-body');

    const scoreRow = function (label, obj) {
      return '' +
        '<div class="score">' +
          '<span class="score__label">' + label + '</span>' +
          '<span class="score__stars">' + UI.stars(obj.stars) + '</span>' +
          '<span class="score__num">' + obj.score + '</span>' +
        '</div>';
    };

    const rows = this.team.order.map(function (slot, i) {
      const p = slot.player;
      const grade = ev.fits[i];
      return '' +
        '<li class="row">' +
          '<span class="row__order">' + (i + 1) + '</span>' +
          '<span class="row__pos" data-pos="' + slot.pos + '">' + slot.pos + '</span>' +
          '<span class="row__name">' + esc(p.name) +
            '<small>' + esc(p.team) + ' ' + p.year + '・本職' + esc(posName(p.pos)) + '</small>' +
          '</span>' +
          '<span class="fit fit--' + grade + '">' + FIT_LABEL[grade] + '</span>' +
        '</li>';
    }).join('');

    host.innerHTML = '' +
      '<div class="verdict">' +
        '<p class="verdict__stars">' + UI.stars(ev.stars) + '</p>' +
        '<h2 class="verdict__title">「' + esc(ev.title) + '」</h2>' +
        '<p class="verdict__total"><b>' + ev.total + '</b><span>点</span></p>' +
        '<p class="verdict__comment">' + esc(ev.comment) + '</p>' +
      '</div>' +

      '<div class="scores">' +
        scoreRow('打撃力', ev.batting) +
        scoreRow('投手力', ev.pitching) +
        scoreRow('守備力', ev.fielding) +
      '</div>' +

      '<div class="defense-note">' + esc(ev.defenseComment) + '</div>' +

      (this.team.useDH ? '' +
        '<div class="fixed-slot fixed-slot--result">' +
          '<span class="row__pos" data-pos="投">投</span>' +
          '<span class="row__name">' + esc(this.team.pitcher.name) +
            '<small>' + esc(this.team.pitcher.team) + ' ' + this.team.pitcher.year +
            '・先発投手</small></span>' +
        '</div>' : '') +

      '<ol class="rows">' + rows + '</ol>';

    // ボタンの表示切り替え
    document.getElementById('r-actions-own').hidden = this.viewOnly;
    document.getElementById('r-actions-guest').hidden = !this.viewOnly;
  },

  /* ==================================================
     結果画像
     ================================================== */
  makeImage: function () {
    const canvas = ResultImage.draw(this.team, this.ev);
    const overlay = document.getElementById('image-overlay');
    const box = document.getElementById('image-box');

    box.innerHTML = '';
    const img = new Image();
    img.alt = '最強チームメーカーの結果画像';
    img.src = canvas.toDataURL('image/png');
    box.appendChild(img);

    const link = document.getElementById('image-download');
    link.href = img.src;
    link.download = 'saikyo-team.png';

    overlay.classList.add('is-on');
  },

  /* ==================================================
     Xでシェア
     ================================================== */
  shareX: function () {
    ShareText.open(this.ev, this.shareUrl());
  },

  shareUrl: function () {
    return ShareCode.url({
      slots: this.team.order.map(function (l) {
        return { playerId: l.player.id, pos: l.pos };
      }),
      pitcherId: this.team.pitcher.id,
      useDH: this.team.useDH,
    });
  },

  /** 結果URLをコピーする */
  copyUrl: function () {
    const url = this.shareUrl();
    const done = function (ok) {
      const el = document.getElementById('r-copy-msg');
      el.textContent = ok ? 'コピーしました！' : 'コピーできませんでした。URLを長押しして選んでください。';
      el.hidden = false;
      setTimeout(function () { el.hidden = true; }, 2600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); },
        function () { done(false); });
    } else {
      done(false);
    }
  },
};
