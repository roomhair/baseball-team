/* ==================================================
   最強チームメーカー  main.js
   画面の切り替えと、アプリ全体の起動処理。
   ================================================== */
'use strict';

const SCREENS = {
  TOP:    'screen-top',
  GAME:   'screen-game',
  LINEUP: 'screen-lineup',
  RESULT: 'screen-result',
};

/** 画面を切り替える */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(function (el) {
    el.classList.remove('is-active');
  });
  const target = document.getElementById(screenId);
  if (!target) {
    console.error('画面が見つかりません:', screenId);
    return;
  }
  target.classList.add('is-active');
  window.scrollTo(0, 0);
}


document.addEventListener('DOMContentLoaded', function () {

  // --- 1. 選手データを読み込む ---
  try {
    PlayerPool.init();
  } catch (e) {
    document.getElementById('app').innerHTML =
      '<div class="container"><p class="placeholder">' +
      '選手データが読み込めませんでした。<br>js/players-data.js があるか確認してください。' +
      '</p></div>';
    console.error(e);
    return;
  }

  // --- 2. 各画面の準備 ---
  Game.init();
  Lineup.init();
  Ads.init();
  renderMeta();

  // --- 3. ボタンの配線 ---
  document.getElementById('btn-start').addEventListener('click', function () {
    startNewGame();
  });

  document.getElementById('btn-give-up').addEventListener('click', function () {
    if (confirm('最初からやり直しますか？　いま集めた選手は消えます。')) {
      Storage.clear();
      showScreen(SCREENS.TOP);
    }
  });

  document.getElementById('btn-result-image').addEventListener('click', function () {
    Result.makeImage();
  });
  document.getElementById('btn-result-x').addEventListener('click', function () {
    Result.shareX();
  });
  document.getElementById('btn-result-copy').addEventListener('click', function () {
    Result.copyUrl();
  });
  document.getElementById('btn-result-again').addEventListener('click', function () {
    startNewGame();
  });
  document.getElementById('btn-back-lineup').addEventListener('click', function () {
    showScreen(SCREENS.LINEUP);
  });

  document.getElementById('image-close').addEventListener('click', function () {
    document.getElementById('image-overlay').classList.remove('is-on');
  });

  // --- 4. 前回の続きがあれば復帰する ---
  const saved = Storage.load();
  if (saved && Array.isArray(saved.picked)) {
    resume(saved);
  } else {
    showScreen(SCREENS.TOP);
  }
});


/** 新しくゲームを始める */
function startNewGame() {
  Storage.clear();
  Game.start();
  showScreen(SCREENS.GAME);
}


/** 保存データから続きを再開する */
function resume(saved) {
  try {
    if (saved.phase === 'result' && saved.lineup) {
      Lineup.resume(saved.lineup);
      if (Result.showFromSlots(saved.lineup)) {
        Game.state = saved;
        showScreen(SCREENS.RESULT);
        return;
      }
    }
    if (saved.phase === 'lineup' && saved.lineup) {
      Game.state = saved;
      Lineup.resume(saved.lineup);
      showScreen(SCREENS.LINEUP);
      return;
    }
    if (saved.phase === 'lineup') {
      Game.state = saved;
      Lineup.start(Game.pickedPlayers());
      showScreen(SCREENS.LINEUP);
      return;
    }
    // 途中まで集めていた場合
    Game.resume(saved);
    showScreen(SCREENS.GAME);
  } catch (e) {
    console.warn('続きから再開できませんでした:', e);
    Storage.clear();
    showScreen(SCREENS.TOP);
  }
}


/** データの出典をフッターに出す */
function renderMeta() {
  const meta = PlayerPool.meta;
  const els = document.querySelectorAll('[data-meta-source]');
  if (!meta.source) return;

  const years = meta.years || [];
  const range = years.length ? years[0] + '〜' + years[years.length - 1] + '年' : '';

  els.forEach(function (el) {
    el.innerHTML =
      '成績データ出典：<a href="' + meta.source.url + '" target="_blank" rel="noopener">' +
      esc(meta.source.name) + '</a>（' + range + '／' + PlayerPool.all.length + '人）';
  });
}
