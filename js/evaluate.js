/* ==================================================
   最強チームメーカー  evaluate.js

   チームの評価だけを担当するファイル。
   バランスを調整したいときは、このファイルだけ直せばよい。
   （ゲームの進行や画面表示のコードは一切入れないこと）
   ================================================== */
'use strict';

const Evaluate = {

  /* --- 調整用のつまみ ------------------------------------ */
  WEIGHTS: {
    // 総合点の配分
    total: { batting: 0.35, pitching: 0.30, fielding: 0.35 },

    // 守備の重要度（捕手・遊撃手・中堅手はごまかしが効かない）
    defense: {
      '投': 1.0, '捕': 1.3, '一': 0.8, '二': 1.2, '三': 1.0,
      '遊': 1.3, '左': 0.8, '中': 1.2, '右': 1.0,
    },

    // 打順ごとの重み（上位打線ほど打席が多く回る）
    order: [1.20, 1.16, 1.12, 1.08, 1.04, 1.00, 0.95, 0.90, 0.85],
  },

  /* --- 点数の伸ばし方 ---
     選手の素の数値をそのまま足すと、どんなに良いチームでも70点前後で
     頭打ちになってしまう。そこで「このくらいが0点／このくらいが100点」を
     決めて、0〜100点に引き伸ばしている。
     ゲームが簡単すぎる／難しすぎると感じたら、この数字を動かす。 */
  CURVE: {
    batting:  { zero: 38, full: 80 },
    pitching: { zero: 28, full: 86 },
    fielding: { zero: 26, full: 74 },
  },

  /* --- ★の数を決めるしきい値 --- */
  STAR_STEPS: [82, 68, 54, 38],   // 上から ★5 / ★4 / ★3 / ★2 / それ未満は★1


  /**
   * 評価の本体。
   * @param {Array} lineup 打順順に並んだ9人。各要素は { player, pos }
   * @returns {Object} 評価結果
   */
  run: function (lineup) {
    const fits = lineup.map(function (slot) {
      return fitOf(slot.player, slot.pos);
    });

    const batting  = this.batting(lineup);
    const pitching = this.pitching(lineup, fits);
    const fielding = this.fielding(lineup, fits);

    const w = this.WEIGHTS.total;
    const total = clampScore(Math.round(
      batting * w.batting + pitching * w.pitching + fielding * w.fielding
    ));

    const facts = this.facts(lineup, fits);
    const verdict = this.verdict(total, facts);

    return {
      batting:  { score: batting,  stars: this.stars(batting) },
      pitching: { score: pitching, stars: this.stars(pitching) },
      fielding: { score: fielding, stars: this.stars(fielding) },
      total: total,
      stars: this.stars(total),
      title: verdict.title,
      comment: verdict.comment,
      defenseComment: this.defenseComment(facts),
      fits: fits,
      facts: facts,
    };
  },


  /* ==================================================
     打撃力
     ================================================== */
  batting: function (lineup) {
    const orderW = this.WEIGHTS.order;
    let sum = 0, wsum = 0;

    // 投手の枠に入っている選手は打撃の計算から外す。
    // どんなチームでも投手は打つのが仕事ではないため。
    // ＝ 投手を「野手の位置」に置いたときだけ、打撃力が大きく下がる。
    lineup.forEach(function (slot, i) {
      if (slot.pos === '投') return;
      const w = orderW[i] || 1;
      sum += slot.player.r.bat * w;
      wsum += w;
    });
    const base = wsum > 0 ? sum / wsum : 0;

    // 打順の組み方のボーナス／ペナルティ
    //   1・2番 … 足が速い人を置くと有利
    //   3〜5番 … 長打力がある人を置くと有利
    const top = avg([lineup[0], lineup[1]].map(function (s) { return s.player.r.run; }));
    const mid = avg([lineup[2], lineup[3], lineup[4]].map(function (s) { return s.player.r.power; }));
    const bonus = clamp((top - 60) * 0.08 + (mid - 55) * 0.08, -8, 8);

    return this.curve(base + bonus, this.CURVE.batting);
  },


  /* ==================================================
     投手力
     投手の枠に誰を置いたかで、ほぼすべてが決まる。
     ================================================== */
  pitching: function (lineup, fits) {
    const slot = lineup.find(function (s) { return s.pos === '投'; });
    if (!slot) return 0;

    const p = slot.player;

    // 野手がマウンドに立っている場合
    if (p.kind !== 'pitcher') return 0;

    let score = p.r.pitch;

    // 救援投手は「1試合を任せる」前提だと少し割引
    if (p.role === '救援') score = score * 0.92;

    return this.curve(score, this.CURVE.pitching);
  },


  /* ==================================================
     守備力
     「その選手の守備力 × 適性の係数」を、
     守備位置の重要度で加重平均する。
     ================================================== */
  fielding: function (lineup, fits) {
    const defW = this.WEIGHTS.defense;
    let sum = 0, wsum = 0;

    lineup.forEach(function (slot, i) {
      const w = defW[slot.pos] || 1;
      const factor = FIT_FACTOR[fits[i]] || FIT_FACTOR['-'];
      sum += slot.player.r.field * factor * w;
      wsum += w;
    });

    return this.curve(wsum > 0 ? sum / wsum : 0, this.CURVE.fielding);
  },


  /** 素の数値を 0〜100点 に引き伸ばす */
  curve: function (raw, range) {
    return clampScore(Math.round((raw - range.zero) / (range.full - range.zero) * 100));
  },


  /* ==================================================
     チームの「事実」を数える（コメントを出し分けるため）
     ================================================== */
  facts: function (lineup, fits) {
    const count = { A: 0, B: 0, C: 0, '-': 0 };
    fits.forEach(function (f) { count[f]++; });

    const pitchers = lineup.filter(function (s) { return s.player.kind === 'pitcher'; });
    const mound = lineup.find(function (s) { return s.pos === '投'; });

    const at = {};
    lineup.forEach(function (s, i) {
      at[s.pos] = { player: s.player, fit: fits[i] };
    });

    return {
      fitCount: count,
      perfect: count.A === 9,
      misfit: count['-'],
      rough: count['-'] + count.C,
      pitcherCount: pitchers.length,
      // 投手なのに野手の位置を守らされている人数
      pitcherOutOfPlace: pitchers.filter(function (s) { return s.pos !== '投'; }).length,
      hasRealPitcher: !!(mound && mound.player.kind === 'pitcher'),
      catcherIsReal: !!(at['捕'] && at['捕'].fit === 'A'),
      avgOverall: Math.round(avg(lineup.map(function (s) { return s.player.ovr; }))),
      at: at,
    };
  },


  /* ==================================================
     総合評価の見出しとコメント

     上から順に条件を見て、最初に当てはまったものを使う。
     当てはまらなければ★の数で決める。
     ================================================== */
  RULES: [
    {
      when: function (f) { return !f.hasRealPitcher; },
      title: 'どうしてこうなった',
      comment: 'マウンドに立っているのが投手ではありません。試合は成立しません。',
    },
    {
      when: function (f) { return f.pitcherOutOfPlace >= 3; },
      title: '投手だらけ',
      comment: '投手を取りすぎました。野手の位置に投手が' + '並んでいます。',
    },
    {
      when: function (f) { return f.misfit >= 3; },
      title: 'ポジションがめちゃくちゃ',
      comment: '適性外が3人以上。守れる人が守れる場所にいません。',
    },
    {
      when: function (f) { return f.avgOverall >= 72 && f.rough >= 4; },
      title: '選手は一流、守備位置は三流',
      comment: '一人ひとりは素晴らしい。並べ方が最悪なだけです。',
    },
    {
      when: function (f) { return f.perfect; },
      title: '完璧なチーム',
      comment: '9人全員が本職。ここまで揃うことは滅多にありません。',
    },
    {
      when: function (f) { return !f.catcherIsReal; },
      title: '捕手不在',
      comment: '本職の捕手がいません。捕手は最後まで来なかったようです。',
    },
  ],

  /* 上のルールに当てはまらなかったときの、★の数ごとの評価 */
  FALLBACK: {
    5: { title: '完璧なチーム',       comments: ['文句のつけようがありません。', 'これ以上は望めない布陣です。'] },
    4: { title: 'かなり強い',         comments: ['優勝を狙えます。', '穴らしい穴がありません。'] },
    3: { title: '悪くない',           comments: ['戦えます。あと一押し。', 'そこそこ形になっています。'] },
    2: { title: 'ポジションがめちゃくちゃ', comments: ['守備が不安すぎます。', '毎回エラーが出そうです。'] },
    1: { title: 'どうしてこうなった', comments: ['野球をする気があるのか疑われます。', '9人いるだけマシ、と考えましょう。'] },
  },

  verdict: function (total, facts) {
    for (let i = 0; i < this.RULES.length; i++) {
      if (this.RULES[i].when(facts)) {
        return { title: this.RULES[i].title, comment: this.RULES[i].comment };
      }
    }
    const tier = this.FALLBACK[this.stars(total)] || this.FALLBACK[3];
    const list = tier.comments;
    return {
      title: tier.title,
      comment: list[Math.floor(Math.random() * list.length)],
    };
  },


  /* ==================================================
     守備についての一言（Xシェアの文章にも使う）
     ================================================== */
  defenseComment: function (facts) {
    const at = facts.at;
    const weak = function (key) {
      return at[key] && (at[key].fit === '-' || at[key].fit === 'C');
    };

    if (!facts.hasRealPitcher)            return '投手が投げられません。';
    if (at['捕'] && at['捕'].fit === '-') return '捕手が捕手じゃありません。';
    if (weak('二') && weak('遊'))         return '二遊間が壊滅しました。';
    if (weak('中') && weak('遊'))         return 'センターラインが崩壊しました。';
    if (facts.pitcherOutOfPlace >= 2)     return '投手が野手をやらされています。';
    if (weak('左') && weak('中') && weak('右')) return '外野がまるごと未経験者です。';
    if (facts.perfect)                    return '全員が本職。文句なしです。';
    if (facts.misfit >= 1)                return '適性外が' + facts.misfit + '人います。';
    if (facts.fitCount.C >= 3)            return '無理なコンバートが多すぎます。';
    return '守備はなんとか形になりました。';
  },


  /* ==================================================
     点数 → ★の数
     ================================================== */
  stars: function (score) {
    const steps = this.STAR_STEPS;
    for (let i = 0; i < steps.length; i++) {
      if (score >= steps[i]) return 5 - i;
    }
    return 1;
  },
};


/* --- このファイルの中だけで使う小さな道具 --- */
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function clampScore(n) { return clamp(n, 0, 100); }
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
}
