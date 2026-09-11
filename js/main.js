/* ==================================================
   最強チームメーカー  main.js
   画面の切り替えと、アプリ全体の起動処理。
   ================================================== */
'use strict';

const SCREENS = {
  TOP:          'screen-top',
  GAME:         'screen-game',
  ROSTER:       'screen-roster',
  LINEUP:       'screen-lineup',
  SEASON_SETUP: 'screen-season-setup',
  SEASON:       'screen-season',
  RESULT:       'screen-result',
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
  Roster.init();
  Lineup.init();
  SeasonSetup.init();
  SeasonResult.init();
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
    Lineup.onDone = null;
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
    Game.state = saved;

    // --- シーズンまで進んでいた場合 ---
    if (saved.phase === 'season' && saved.season) {
      const restored = SeasonRun.restore(saved.season);
      if (restored) {
        SeasonResult.show(restored);
        showScreen(SCREENS.SEASON);
        return;
      }
    }

    // --- チーム評価まで進んでいた場合 ---
    if (saved.phase === 'result' && saved.lineup) {
      Lineup.resume(saved.lineup);
      if (Result.showFromSaved(saved.lineup)) {
        showScreen(SCREENS.RESULT);
        return;
      }
    }

    // --- 打順を決めている途中 ---
    if (saved.phase === 'lineup' && saved.lineup) {
      Lineup.resume(saved.lineup);
      showScreen(SCREENS.LINEUP);
      return;
    }

    // --- シーズンの準備中、またはメンバー確認画面 ---
    if (saved.phase === 'season-setup' || saved.phase === 'roster' ||
        saved.picked.length >= CONFIG.TEAM_SIZE) {
      Roster.show();
      showScreen(SCREENS.ROSTER);
      return;
    }

    // --- 途中まで集めていた場合 ---
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
