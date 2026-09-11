/* ==================================================
   最強チームメーカー  main.js
   役割：画面の切り替えと、アプリ全体の起動処理。
   （ゲームのルールは STEP 3 以降で別ファイルに書きます）
   ================================================== */

/* 'use strict' は「書き間違いを厳しくチェックしてね」という宣言です。
   初心者のうちはバグに早く気づけるので必ず書いておきます。 */
'use strict';


/* --------------------------------------------------
   画面の名前の一覧
   ここに書いた名前と、index.html の id="screen-〇〇" が
   対応しています。
-------------------------------------------------- */
const SCREENS = {
  TOP:    'screen-top',
  GAME:   'screen-game',
  LINEUP: 'screen-lineup',
  RESULT: 'screen-result',
};


/* --------------------------------------------------
   画面を切り替える関数
   使い方： showScreen(SCREENS.GAME)
-------------------------------------------------- */
function showScreen(screenId) {
  // いったん全部の画面を隠す
  const all = document.querySelectorAll('.screen');
  all.forEach(function (el) {
    el.classList.remove('is-active');
  });

  // 指定された画面だけ表示する
  const target = document.getElementById(screenId);
  if (!target) {
    console.error('画面が見つかりません:', screenId);
    return;
  }
  target.classList.add('is-active');

  // 画面の一番上までスクロールを戻す
  window.scrollTo(0, 0);
}


/* --------------------------------------------------
   アプリの起動処理
   DOMContentLoaded = 「HTMLの読み込みが終わった」合図。
   これを待たないと、ボタンを探しても見つからないことがあります。
-------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {

  // 「ゲーム開始」ボタン
  const btnStart = document.getElementById('btn-start');

  btnStart.addEventListener('click', function () {
    // STEP 3 でここに「ゲームを始める処理」を書きます。
    // 今は画面を切り替えるだけです。
    showScreen(SCREENS.GAME);
  });

  // 最初はトップ画面を表示
  showScreen(SCREENS.TOP);

  console.log('最強チームメーカー: 起動しました（STEP 1）');
});
