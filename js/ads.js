/* ==================================================
   最強チームメーカー  ads.js
   広告枠のための仕組み。

   初期版では広告を出さない（config.js の ADS_ENABLED が false）。
   将来 Google AdSense などを使うときは、
   renderSlot() の中に広告タグを入れるだけでよい。
   ================================================== */
'use strict';

const Ads = {

  init: function () {
    if (!CONFIG.ADS_ENABLED) return;   // 初期版はここで終わり（枠ごと表示されない）

    const slots = document.querySelectorAll('.ad-slot');
    slots.forEach(function (el) {
      Ads.renderSlot(el, el.dataset.adSlot);
    });
  },

  /**
   * 広告1枠を描く。
   * name は 'top-header' / 'top-before-start' / 'result' など、
   * index.html の data-ad-slot に書いてある名前。
   */
  renderSlot: function (el, name) {
    // ▼ ここに広告タグを入れる（例：AdSense の <ins> タグ）
    //   いまは場所が分かるだけの枠を表示している。
    el.innerHTML =
      '<div class="ad-placeholder">広告枠（' + name + '）</div>';
  },
};
