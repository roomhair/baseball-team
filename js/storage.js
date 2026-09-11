/* ==================================================
   最強チームメーカー  storage.js
   ゲームの途中経過をブラウザに保存する。
   （リロードしても続きから遊べるようにするため）
   ================================================== */
'use strict';

const Storage = {

  /**
   * 簡単な「封印シール」を作る。
   * 保存したデータを手で書き換えると、この値が合わなくなるので気づける。
   * 暗号ではないので完全には防げないが、初期版はこれで十分としている。
   */
  sign: function (text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = ((h2 + c * (i + 7)) * 0x85ebca6b) >>> 0;
    }
    return (h1 >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36);
  },

  /** 保存する */
  save: function (state) {
    try {
      const body = JSON.stringify(state);
      const pack = {
        v: CONFIG.SAVE_VERSION,
        d: body,
        k: this.sign(body + '|' + CONFIG.SAVE_VERSION),
      };
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(pack));
      return true;
    } catch (e) {
      // プライベートモードなどで保存できないことがある。
      // 保存できなくてもゲーム自体は遊べるので、止めない。
      console.warn('保存できませんでした:', e);
      return false;
    }
  },

  /** 読み込む。無ければ null */
  load: function () {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return null;

      const pack = JSON.parse(raw);
      if (pack.v !== CONFIG.SAVE_VERSION) {
        this.clear();
        return null;
      }
      if (pack.k !== this.sign(pack.d + '|' + CONFIG.SAVE_VERSION)) {
        // 書き換えられている → 使わずに捨てる
        console.warn('保存データが壊れているため、最初からになります。');
        this.clear();
        return null;
      }
      return JSON.parse(pack.d);
    } catch (e) {
      this.clear();
      return null;
    }
  },

  /** 消す */
  clear: function () {
    try {
      localStorage.removeItem(CONFIG.SAVE_KEY);
    } catch (e) { /* 何もしない */ }
  },
};
