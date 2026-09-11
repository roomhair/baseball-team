/* ==================================================
   最強チームメーカー  data.js
   選手データの読み込みと、ランダム抽選。
   ================================================== */
'use strict';

const PlayerPool = {

  all: [],          // 全選手
  byPos: {},        // ポジションごとの選手一覧
  byId: {},         // ID から引く用
  meta: {},         // 出典・年度などの情報

  /** 起動時に1回だけ呼ぶ */
  init: function () {
    const data = window.PLAYERS_DATA;
    if (!data || !Array.isArray(data.players)) {
      throw new Error('選手データが読み込めませんでした（js/players-data.js）');
    }

    this.meta = {
      source: data.source,
      asOf: data.asOf,
      years: data.years,
      builtAt: data.builtAt,
    };

    this.all = data.players;

    const self = this;
    POS_KEYS.forEach(function (k) { self.byPos[k] = []; });

    this.all.forEach(function (p) {
      self.byId[p.id] = p;
      if (self.byPos[p.pos]) self.byPos[p.pos].push(p);
    });

    return this;
  },

  /** IDから選手を取り出す（共有URLを開いたときに使う） */
  get: function (id) {
    return this.byId[id] || null;
  },

  /**
   * 次に登場する選手を1人、ランダムに選ぶ。
   *
   * 完全な「全員から等確率」にすると、実データでは投手が半分以上を占めるため
   * 投手だらけになってしまう。そこで
   *   1. まず CONFIG.POSITION_WEIGHTS の重みでポジションを決める
   *   2. そのポジションの中から等確率で1人選ぶ
   * という2段階にしている。出やすさを変えたいときは config.js を直す。
   *
   * @param {string[]} usedNames すでに獲得した選手の名前（重複を避けるため）
   */
  draw: function (usedNames) {
    const used = usedNames || [];

    // 1. ポジションを重み付きで決める
    //    （その位置に選手が1人もいない場合は候補から外す）
    const candidates = [];
    let total = 0;
    const self = this;

    POS_KEYS.forEach(function (key) {
      const list = self.byPos[key] || [];
      const pickable = list.filter(function (p) {
        return !(CONFIG.NO_DUPLICATE_NAME && used.indexOf(p.name) !== -1);
      });
      if (pickable.length === 0) return;

      const weight = CONFIG.POSITION_WEIGHTS[key] || 0;
      if (weight <= 0) return;

      total += weight;
      candidates.push({ key: key, weight: weight, list: pickable });
    });

    if (candidates.length === 0) return null;

    let r = Math.random() * total;
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      r -= candidates[i].weight;
      if (r <= 0) { chosen = candidates[i]; break; }
    }

    // 2. そのポジションの中から1人
    const list = chosen.list;
    return list[Math.floor(Math.random() * list.length)];
  },
};
