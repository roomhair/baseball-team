/* ==================================================
   最強チームメーカー  data.js
   選手データの読み込みと、ランダム抽選。
   ================================================== */
'use strict';

const PlayerPool = {

  all: [],          // 全選手
  byPos: {},        // ポジションごとの選手一覧（投手は '投' に入る）
  byId: {},         // ID から引く用
  twoWay: [],       // 二刀流選手だけの一覧
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
      if (p.kind === 'twoway') {
        // 二刀流は投手としても野手としても取れるので、別枠で持つ
        self.twoWay.push(p);
      } else if (self.byPos[p.pos]) {
        self.byPos[p.pos].push(p);
      }
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
   * さらに、まだ空いている枠に入れる選手しか出さない。
   *   ・投手枠が埋まっていたら、投手は出てこない
   *   ・野手枠が埋まっていたら（＝残り1枠が投手）、野手は出てこない
   * これで「最後の1人が野手で投手が0人」という詰みが起きなくなる。
   *
   * @param {string[]} usedNames すでに獲得した選手の名前（重複を避けるため）
   * @param {Object}   need      あと何人必要か { pitcher: 数, fielder: 数 }
   */
  draw: function (usedNames, need) {
    const used = usedNames || [];
    const want = need || { pitcher: 1, fielder: 1 };
    const self = this;

    const isUsed = function (p) {
      return CONFIG.NO_DUPLICATE_NAME && used.indexOf(p.name) !== -1;
    };

    // --- 二刀流を出すかどうか ---
    // 二刀流は人数が少ないので、重みではなく「出す確率」で扱う。
    const twoWayPool = this.twoWay.filter(function (p) { return !isUsed(p); });
    if (twoWayPool.length > 0 && Math.random() < CONFIG.TWOWAY_RATE) {
      return twoWayPool[Math.floor(Math.random() * twoWayPool.length)];
    }

    // --- 通常の選手 ---
    const candidates = [];
    let total = 0;

    POS_KEYS.forEach(function (key) {
      // 空いている枠に入れない種類は、そもそも出さない
      if (key === '投' && want.pitcher <= 0) return;
      if (key !== '投' && want.fielder <= 0) return;

      const pickable = (self.byPos[key] || []).filter(function (p) { return !isUsed(p); });
      if (pickable.length === 0) return;

      const weight = CONFIG.POSITION_WEIGHTS[key] || 0;
      if (weight <= 0) return;

      total += weight;
      candidates.push({ key: key, weight: weight, list: pickable });
    });

    if (candidates.length === 0) {
      // 通常の選手が出せない状況（投手枠しか残っておらず投手を引き当てられない等）は
      // 二刀流で埋める
      if (twoWayPool.length > 0) {
        return twoWayPool[Math.floor(Math.random() * twoWayPool.length)];
      }
      return null;
    }

    let r = Math.random() * total;
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      r -= candidates[i].weight;
      if (r <= 0) { chosen = candidates[i]; break; }
    }

    const list = chosen.list;
    return list[Math.floor(Math.random() * list.length)];
  },
};
