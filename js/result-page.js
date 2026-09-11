/* ==================================================
   最強チームメーカー  result-page.js
   result.html（他人の結果を見るページ）専用。
   URLの ?d=... を読んでチームを再現する。
   ================================================== */
'use strict';

document.addEventListener('DOMContentLoaded', function () {

  const host = document.getElementById('r-body');

  try {
    PlayerPool.init();
  } catch (e) {
    host.innerHTML = '<p class="placeholder">選手データが読み込めませんでした。</p>';
    return;
  }

  const code = new URLSearchParams(location.search).get('d');
  if (!code) {
    host.innerHTML = '<p class="placeholder">結果のデータがURLに入っていません。</p>';
    document.getElementById('r-actions-guest').hidden = false;
    return;
  }

  const slots = ShareCode.decode(code);
  if (!slots) {
    host.innerHTML = '<p class="placeholder">' +
      'この結果URLは読み取れませんでした。<br>' +
      'URLが途中で切れているか、書き換えられている可能性があります。' +
      '</p>';
    document.getElementById('r-actions-guest').hidden = false;
    return;
  }

  if (!Result.showFromSlots(slots, { viewOnly: true })) {
    host.innerHTML = '<p class="placeholder">この結果は表示できませんでした。</p>';
    document.getElementById('r-actions-guest').hidden = false;
    return;
  }

  // 出典表示
  const meta = PlayerPool.meta;
  if (meta.source) {
    const years = meta.years || [];
    const range = years.length ? years[0] + '〜' + years[years.length - 1] + '年' : '';
    document.querySelectorAll('[data-meta-source]').forEach(function (el) {
      el.innerHTML = '成績データ出典：<a href="' + meta.source.url +
        '" target="_blank" rel="noopener">' + esc(meta.source.name) + '</a>（' + range + '）';
    });
  }

  // 画像ボタン（見ている人も画像にできる）
  document.getElementById('btn-guest-image').addEventListener('click', function () {
    Result.makeImage();
  });
  document.getElementById('image-close').addEventListener('click', function () {
    document.getElementById('image-overlay').classList.remove('is-on');
  });
});
