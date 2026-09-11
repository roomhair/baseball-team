/* ==================================================
   最強チームメーカー  season.js

   シーズンの計算だけを担当するファイル。画面の処理は入れないこと。
     ① 選手ひとりひとりの「今シーズンの成績」を予測して作る
     ② チーム全体の戦力から、143試合の結果を計算する
     ③ クライマックスシリーズ・日本シリーズを計算する

   【成績予測の考え方】
   完全なサイコロにはしない。土台は「その選手が実際に残した成績」。
   そこに
       年齢（若手は伸びる／ベテランは落ちる）
       キャリア年数（プロ入りから何年目か）
       そのシーズンの調子（ここだけランダム）
   を足して作る。だから同じ選手でも毎回少し違う数字になるが、
   元が良い選手は基本的に良い数字になる。
   ================================================== */
'use strict';

const Season = {

  /* ==================================================
     調整用のつまみ
     ================================================== */
  TUNE: {
    // リーグ平均の目安（NPBのだいたいの実数に合わせてある）
    LG_RUNS: 4.05,      // 1試合あたりの平均得点
    LG_ERA: 3.35,       // 平均防御率
    LG_OPS: 0.700,      // 平均OPS
    LG_WOBA: 0.320,     // 平均wOBA（打撃の総合指標）

    PEAK_AGE: 27,       // 打者がいちばん良くなる年齢
    PEAK_AGE_P: 28,     // 投手がいちばん良くなる年齢
    UNKNOWN_AGE: 28,    // 年齢が分からない選手は、この年齢とみなす

    GROWTH_PER_YEAR: 0.016,   // ピークまで1歳あたり何%伸びるか
    DECLINE_PER_YEAR: 0.022,  // ピークを過ぎて1歳あたり何%落ちるか
    YOUNG_UPSIDE: 0.055,      // 若手の「覚醒」の振れ幅
    SEASON_SWING: 0.058,      // 毎シーズンの調子の振れ幅

    TIE_RATE: 0.042,          // 引き分けになる割合
    INTERLEAGUE_GAMES: 18,    // 交流戦の試合数

    // 登録した投手だけでは1年ぶんのイニングを投げきれない。
    // 足りないぶんは「その他の投手」が投げたものとして計算する。
    FILLER_ERA: 4.60,

    // ライバル6球団の平均的な強さ。
    // 「同じやり方で組んだチームの平均」に合わせてあるので、
    // ふつうに組めば5割前後、うまく組めば上位に行ける。
    RIVAL_RS: 4.15,
    RIVAL_RA: 3.17,
    RIVAL_SPREAD: 0.40,
  },

  /* ==================================================
     リーグの設定
     ※ ライバル6球団の成績は、このゲームによる架空のシミュレーションです。
     ================================================== */
  LEAGUES: {
    central: {
      key: 'central', name: 'セ・リーグ', dh: false,
      rivals: ['阪神', '巨人', 'DeNA', '広島', 'ヤクルト', '中日'],
    },
    pacific: {
      key: 'pacific', name: 'パ・リーグ', dh: true,
      rivals: ['ソフトバンク', '日本ハム', 'ロッテ', 'オリックス', '楽天', '西武'],
    },
  },


  /* ==================================================
     ① 乱数の道具
     ================================================== */

  /** 0〜1 の乱数 */
  rnd: function () { return Math.random(); },

  /** つりがね型（正規分布）の乱数。ほとんどは0の近くに出る。 */
  gauss: function (sd) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * (sd || 1);
  },

  clamp: function (n, min, max) { return Math.min(max, Math.max(min, n)); },


  /* ==================================================
     ② 年齢による伸び／衰え
     ================================================== */

  /**
   * 年齢とキャリアから「今年どれくらい伸びる／落ちるか」を返す。
   * 1.0 が「去年と同じ」。1.08 なら8%良くなる。
   */
  ageFactor: function (player, peakAge) {
    const t = this.TUNE;
    const age = player.age || t.UNKNOWN_AGE;
    const peak = peakAge || t.PEAK_AGE;

    let f = 1;
    if (age < peak) {
      f += (peak - age) * t.GROWTH_PER_YEAR;
    } else {
      // 30歳を超えると落ち方が急になる
      const over = age - peak;
      f -= over * t.DECLINE_PER_YEAR * (age >= 33 ? 1.6 : 1);
    }

    // プロ入りから間もない選手は、大きく化ける可能性がある
    if (player.car && player.car <= 3 && age <= 25) {
      f += Math.abs(this.gauss(t.YOUNG_UPSIDE));
    }
    // ベテランは、ある日いきなり落ちることがある
    if (age >= 34 && this.rnd() < 0.22) {
      f -= 0.10 + this.rnd() * 0.14;
    }

    return this.clamp(f, 0.60, 1.35);
  },


  /* ==================================================
     ③ 打者の成績を作る
     ================================================== */

  /**
   * @param {Object} player 選手
   * @param {number} orderIndex 打順（0が1番）
   * @param {string} pos 守る場所
   */
  projectBatter: function (player, orderIndex, pos) {
    const t = this.TUNE;

    // DH制がないリーグでは投手も打席に立つ。
    // 投手の打撃成績は公式データに無いので、投手らしい数字を土台にする。
    const PITCHER_BAT = { pa: 62, avg: 0.135, hr: 0, rbi: 4, obp: 0.168, slg: 0.165 };

    const base = (player.kind === 'pitcher')
      ? PITCHER_BAT
      : (player.n || { pa: 500, avg: 0.260, hr: 10, rbi: 45, obp: 0.320, slg: 0.390 });

    // --- 素の力を年齢で伸縮させ、今年の調子を足す ---
    const af = this.ageFactor(player, t.PEAK_AGE);
    const swing = 1 + this.gauss(t.SEASON_SWING);

    // OPSを土台にして、そこから各項目を作る（数字どうしが矛盾しないようにするため）
    const baseOps = base.obp + base.slg;
    const opsFloor = (player.kind === 'pitcher') ? 0.180 : 0.440;
    const ops = this.clamp(baseOps * af * swing, opsFloor, 1.150);

    // 出塁率と長打率の比率は、その選手のもともとの形を残す
    const obpShare = baseOps > 0 ? base.obp / baseOps : 0.45;
    const obpFloor = (player.kind === 'pitcher') ? 0.060 : 0.230;
    const slgFloor = (player.kind === 'pitcher') ? 0.060 : 0.250;
    let obp = this.clamp(ops * obpShare, obpFloor, 0.480);
    let slg = this.clamp(ops - obp, slgFloor, 0.720);

    // --- 打率 ---
    // ２つのやり方を半分ずつ混ぜる。片方だけだと、極端な数字が出ることがあるため。
    //   ① もともとの「出塁率と打率の差」を保つやり方
    //   ② もともとの打率を、今年の出来にあわせて伸縮させるやり方
    const gap = this.clamp(base.obp - base.avg, 0.030, 0.140);
    const avgFromObp = obp - gap;
    const avgDirect = base.avg * Math.pow(this.clamp(ops / Math.max(0.001, baseOps), 0.6, 1.5), 0.55);
    const avgFloor = (player.kind === 'pitcher') ? 0.040 : 0.190;
    let avg = this.clamp((avgFromObp + avgDirect) / 2 + this.gauss(0.010), avgFloor, 0.370);

    // --- 打席数 ---
    // ケガや不調で減ることもある。年齢が高いと減りやすい。
    // 打てない年は出番そのものが減る（打率1割台で規定打席、が起きないようにする）。
    const durability = this.clamp(1 - Math.max(0, (player.age || t.UNKNOWN_AGE) - 32) * 0.035, 0.70, 1);
    const playingTime = this.clamp(1 + (ops - 0.700) * 1.7, 0.50, 1.18);
    const paFloor = (player.kind === 'pitcher') ? 20 : 200;
    let pa = Math.round(this.clamp(
      base.pa * (0.88 + this.rnd() * 0.30) * durability * playingTime, paFloor, 670));

    // --- 四球と打数 ---
    // OBP =（安打＋四球）÷ 打席、打席 ≒ 打数＋四球 という関係から逆算する
    let bb = Math.round(pa * (obp - avg) / (1 - avg));
    bb = Math.round(this.clamp(bb, 8, pa * 0.22));
    const ab = Math.max(50, pa - bb - Math.round(pa * 0.015));   // 犠打ぶんを少し引く

    // --- 安打・本塁打 ---
    const h = Math.round(ab * avg);
    const baseHrRate = base.pa > 0 ? base.hr / base.pa : 0.02;
    let hr = Math.round(ab * baseHrRate * af * (0.75 + this.rnd() * 0.6));
    hr = Math.round(this.clamp(hr, 0, Math.min(h, 62)));

    // --- 塁打（長打率と本塁打がちぐはぐにならないようにそろえる） ---
    let tb = Math.round(ab * slg);
    tb = Math.max(tb, h + 3 * hr);         // 本塁打ぶんは最低でも入る
    tb = Math.min(tb, h + 3 * hr + Math.round((h - hr) * 0.75));
    // 実際の安打数・塁打数から計算し直して、表示する数字どうしをそろえる
    avg = ab > 0 ? h / ab : 0;
    slg = ab > 0 ? tb / ab : 0;
    obp = pa > 0 ? (h + bb) / pa : 0;

    // --- 打点（打順で変わる。クリーンアップほど多い） ---
    const orderBoost = [0.88, 0.94, 1.10, 1.18, 1.12, 1.00, 0.92, 0.86, 0.82][orderIndex] || 1;
    let rbi = Math.round((hr * 1.9 + (h - hr) * 0.30 + 6) * orderBoost * (1 + this.gauss(0.10)));
    rbi = Math.round(this.clamp(rbi, hr, 160));

    // --- wRC+（打撃をリーグ平均と比べた指標。100が平均） ---
    const singles = h - hr - Math.round((tb - h - 3 * hr) * 0.6);
    const woba = pa > 0
      ? (0.69 * bb + 0.87 * Math.max(0, singles) + 1.22 * Math.max(0, (tb - h - 3 * hr)) * 0.5 + 2.0 * hr) / pa
      : 0;
    const wrc = Math.round(this.clamp(100 + (woba - t.LG_WOBA) * 480, 20, 220));

    // --- UZR（守備でどれだけ失点を防いだか。0が平均。DHは対象外） ---
    let uzr = null;
    if (pos !== DH_KEY) {
      const fit = fitOf(player, pos);
      const factor = FIT_FACTOR[fit] || FIT_FACTOR['-'];
      uzr = Math.round((player.r.field * factor - 62) * 0.55 + this.gauss(3.2));
      uzr = this.clamp(uzr, -28, 22);
    }

    return {
      player: player, pos: pos, order: orderIndex + 1,
      pa: pa, ab: ab, h: h, bb: bb, hr: hr, rbi: rbi,
      avg: avg, obp: obp, slg: slg, ops: obp + slg,
      wrc: wrc, uzr: uzr,
    };
  },


  /* ==================================================
     ④ 投手の成績を作る
     ================================================== */

  /**
   * @param {Object} player 投手
   * @param {string} role '先発' / '中継ぎ' / 'セットアッパー' / '抑え'
   * @param {number} teamWinPct チームの強さ（勝ち星の付きやすさに使う）
   */
  projectPitcher: function (player, role, teamWinPct) {
    const t = this.TUNE;
    const base = player.np || { g: 25, ip: 120, w: 8, l: 8, era: 3.60, k: 100 };

    const af = this.ageFactor(player, t.PEAK_AGE_P);
    const swing = 1 + this.gauss(t.SEASON_SWING);

    // 防御率は「小さいほど良い」ので、伸びる＝割り算になる
    let era = this.clamp(base.era / (af * swing), 0.90, 7.50);

    let baseK9 = base.ip > 0 ? base.k / base.ip * 9 : 7;

    // --- 役割を変えたときの補正 ---
    // 救援投手を先発に回すと、1試合に何度も打線と対戦するぶん成績は落ちる。
    // 逆に先発を短いイニングで使うと、少し良くなる。
    if (role === '先発' && player.role === '救援') {
      era *= 1.22;
      baseK9 *= 0.85;
    } else if (role !== '先発' && player.role === '先発') {
      era *= 0.93;
      baseK9 *= 1.06;
    }
    let ip, g, sv = null, hld = null;

    // 年齢が高いほどイニングを投げきれなくなる
    const durability = this.clamp(1 - Math.max(0, (player.age || t.UNKNOWN_AGE) - 32) * 0.04, 0.68, 1);

    if (role === '先発') {
      // もともと救援だった投手が先発に回る場合は、標準的な先発の負荷で考える
      const baseIp = player.role === '先発' ? base.ip : 115;
      ip = this.clamp(baseIp * (0.72 + this.rnd() * 0.52) * durability, 45, 200);
      g = Math.max(8, Math.round(ip / 6.1));
    } else if (role === '抑え') {
      ip = this.clamp((45 + this.gauss(8)) * durability, 22, 72);
      g = Math.round(this.clamp(ip * 1.05, 25, 62));
      sv = Math.round(this.clamp((38 - (era - 2.0) * 7) * (0.7 + teamWinPct), 3, 52));
    } else if (role === 'セットアッパー') {
      ip = this.clamp((56 + this.gauss(9)) * durability, 25, 82);
      g = Math.round(this.clamp(ip * 1.1, 28, 68));
      hld = Math.round(this.clamp((34 - (era - 2.2) * 6) * (0.7 + teamWinPct), 2, 48));
    } else {
      ip = this.clamp((48 + this.gauss(14)) * durability, 14, 88);
      g = Math.round(this.clamp(ip * 1.15, 15, 62));
      hld = Math.round(this.clamp((16 - (era - 3.0) * 4), 0, 32));
    }
    // 野球の投球回は1/3きざみなので、それに合わせて丸める
    ip = Math.round(ip * 3) / 3;

    // たくさん投げるほど、極端に良い防御率は出にくくなる。
    // （30イニングなら防御率0点台もあるが、150イニングではまず無い）
    const eraFloor = ip > 100 ? 1.45 : (ip > 55 ? 1.10 : 0.80);
    era = this.clamp(era, eraFloor, 8.00);

    // --- 奪三振・与四球・与死球 ---
    // 先発は長いイニングを投げるので、奪三振率は救援ほど高くならない
    const k9max = role === '先発' ? 11.0 : 13.5;
    const k9 = this.clamp(baseK9 * (0.85 + this.rnd() * 0.35), 3.5, k9max);
    const so = Math.round(ip * k9 / 9);

    // 防御率が良い投手ほど四球は少なめ、という関係にしておく
    const bb9 = this.clamp(3.2 + (era - t.LG_ERA) * 0.35 + this.gauss(0.55), 1.0, 6.5);
    const bb = Math.round(ip * bb9 / 9);
    const hbp = Math.round(this.clamp(ip / 9 * (0.22 + this.rnd() * 0.28), 0, 16));

    // --- 勝敗 ---
    // 「防御率が良いほど勝ちやすい」＋「強いチームほど勝ちやすい」
    let w = 0, l = 0;
    const quality = this.clamp(0.5 + (t.LG_ERA - era) * 0.075, 0.20, 0.80);
    const winRate = this.clamp(quality * 0.65 + teamWinPct * 0.35, 0.18, 0.82);

    if (role === '先発') {
      const decisions = Math.round(this.clamp(g * 0.72, 2, 30));
      w = Math.round(decisions * winRate + this.gauss(1.4));
      w = Math.round(this.clamp(w, 0, decisions));
      l = decisions - w;
    } else {
      const decisions = Math.round(this.clamp(g * 0.13, 0, 12));
      w = Math.round(this.clamp(decisions * winRate + this.gauss(0.8), 0, decisions));
      l = decisions - w;
    }

    // --- 自責点（防御率と投球回から逆算。表示の整合を取るため） ---
    const er = Math.round(era * ip / 9);
    era = ip > 0 ? er * 9 / ip : 0;

    return {
      player: player, role: role,
      g: g, ip: ip, w: w, l: l, era: era, so: so, bb: bb, hbp: hbp,
      er: er, sv: sv, hld: hld,
    };
  },


  /* ==================================================
     ⑤ チームの強さを出す
     ================================================== */

  /**
   * 打者の成績と投手陣から、1試合あたりの得点と失点を見積もる。
   * そこから「勝率の見込み」を出す（ピタゴラス勝率という考え方）。
   */
  teamStrength: function (batters, pitchers, defenseUzr) {
    const t = this.TUNE;

    // --- 得点：打線の wRC+ の平均（打席数で重みをつける） ---
    let wsum = 0, wtot = 0;
    batters.forEach(function (b) {
      wsum += b.wrc * b.pa;
      wtot += b.pa;
    });
    const offIndex = wtot > 0 ? wsum / wtot : 100;
    const rs = t.LG_RUNS * (offIndex / 100);

    // --- 失点：投手陣の防御率（投球回で重みをつける） ---
    let esum = 0, itot = 0;
    pitchers.forEach(function (p) {
      esum += p.er;
      itot += p.ip;
    });

    // 登録した投手だけでは1年ぶん（143試合 × 9回）を投げきれない。
    // 足りないイニングは「その他の投手」が投げたものとして足しておく。
    // こうしないと、良い投手だけを並べたチームが強くなりすぎる。
    const fullIp = CONFIG.SEASON_GAMES * 9;
    const fillIp = Math.max(0, fullIp - itot);
    esum += fillIp * t.FILLER_ERA / 9;
    itot += fillIp;

    const staffEra = itot > 0 ? esum * 9 / itot : t.LG_ERA;

    // 守備が良いと失点が減る（UZRの合計を1試合あたりに直す）
    const defRuns = (defenseUzr || 0) / CONFIG.SEASON_GAMES;
    const ra = Math.max(2.2, staffEra * 1.09 - defRuns);

    // ピタゴラス勝率
    const e = 1.83;
    const pyth = Math.pow(rs, e) / (Math.pow(rs, e) + Math.pow(ra, e));

    return {
      rs: rs, ra: ra, offIndex: offIndex, staffEra: staffEra,
      pyth: this.clamp(pyth, 0.22, 0.78),
    };
  },

  /** ライバル6球団の強さを作る（毎回少し変わる） */
  makeRivals: function (league) {
    const self = this;
    const t = this.TUNE;
    return league.rivals.map(function (name) {
      const rs = t.RIVAL_RS + self.gauss(t.RIVAL_SPREAD);
      const ra = t.RIVAL_RA + self.gauss(t.RIVAL_SPREAD);
      const e = 1.83;
      return {
        name: name, isUser: false,
        rs: rs, ra: ra,
        pyth: self.clamp(Math.pow(rs, e) / (Math.pow(rs, e) + Math.pow(ra, e)), 0.30, 0.70),
      };
    });
  },


  /* ==================================================
     ⑥ 143試合を戦う
     ================================================== */

  /** AがBに勝つ確率（log5という計算の仕方） */
  winProb: function (a, b) {
    const pa = a, pb = b;
    const d = pa + pb - 2 * pa * pb;
    if (d <= 0) return 0.5;
    return this.clamp((pa - pa * pb) / d, 0.05, 0.95);
  },

  /** 1試合の結果を決める。 'W' / 'L' / 'D' */
  playGame: function (pa, pb) {
    if (this.rnd() < this.TUNE.TIE_RATE) return 'D';
    return this.rnd() < this.winProb(pa, pb) ? 'W' : 'L';
  },

  /**
   * リーグ戦を丸ごと計算する。
   * 7チーム（自分＋6球団）が交流戦を含めて143試合ずつ戦う。
   */
  playLeague: function (teams) {
    const self = this;
    const n = teams.length;
    const inter = this.TUNE.INTERLEAGUE_GAMES;
    const leagueGames = CONFIG.SEASON_GAMES - inter;
    const perRival = Math.floor(leagueGames / (n - 1));
    const extra = leagueGames - perRival * (n - 1);   // 割り切れないぶん

    const rec = teams.map(function (t) {
      return { team: t, w: 0, l: 0, d: 0 };
    });

    // --- リーグ内の対戦 ---
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // 余りぶんは先の組に1試合ずつ足す
        const games = perRival + ((i + j) % (n - 1) < extra ? 1 : 0);
        for (let k = 0; k < games; k++) {
          const r = self.playGame(teams[i].pyth, teams[j].pyth);
          if (r === 'D') { rec[i].d++; rec[j].d++; }
          else if (r === 'W') { rec[i].w++; rec[j].l++; }
          else { rec[i].l++; rec[j].w++; }
        }
      }
    }

    // --- 交流戦（相手はもう一方のリーグの平均的なチーム） ---
    rec.forEach(function (r) {
      for (let k = 0; k < inter; k++) {
        const res = self.playGame(r.team.pyth, 0.500);
        if (res === 'D') r.d++;
        else if (res === 'W') r.w++;
        else r.l++;
      }
    });

    // --- 143試合ちょうどに整える ---
    rec.forEach(function (r) {
      let total = r.w + r.l + r.d;
      while (total > CONFIG.SEASON_GAMES) {
        if (r.d > 0) r.d--; else if (r.l > r.w) r.l--; else r.w--;
        total--;
      }
      while (total < CONFIG.SEASON_GAMES) {
        const res = self.playGame(r.team.pyth, 0.500);
        if (res === 'D') r.d++; else if (res === 'W') r.w++; else r.l++;
        total++;
      }
      // 勝率（引き分けは計算から外すのが一般的なやり方）
      r.pct = (r.w + r.l) > 0 ? r.w / (r.w + r.l) : 0;
    });

    // --- 順位をつける ---
    rec.sort(function (a, b) {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return b.w - a.w;
    });
    rec.forEach(function (r, i) { r.rank = i + 1; });

    // 首位とのゲーム差
    const top = rec[0];
    rec.forEach(function (r) {
      r.gb = ((top.w - r.w) + (r.l - top.l)) / 2;
    });

    return rec;
  },


  /* ==================================================
     ⑦ 短期決戦（CS・日本シリーズ）
     ================================================== */

  /**
   * 先に winsNeeded 勝したほうが勝ち。
   * @param {number} headStart 上位チームにあらかじめ付く勝ち星
   */
  playSeries: function (a, b, winsNeeded, headStart) {
    let aw = headStart || 0, bw = 0;
    const games = [];
    let guard = 0;
    while (aw < winsNeeded && bw < winsNeeded && guard++ < 20) {
      // 上位チームは本拠地開催のぶん少し有利にする
      const r = this.playGame(this.clamp(a.pyth + 0.02, 0.05, 0.95), b.pyth);
      if (r === 'D') { games.push('分'); continue; }
      if (r === 'W') { aw++; games.push('○'); }
      else { bw++; games.push('●'); }
    }
    return { winner: aw >= winsNeeded ? a : b, a: aw, b: bw, games: games };
  },

  /** クライマックスシリーズ（3位以内が対象） */
  playCS: function (standings) {
    const t = function (i) { return standings[i].team; };

    // ファーストステージ：2位 vs 3位（3戦2勝）
    const first = this.playSeries(t(1), t(2), 2, 0);

    // ファイナルステージ：1位 vs 勝者（6戦4勝。1位に1勝のアドバンテージ）
    const final = this.playSeries(t(0), first.winner, 4, 1);

    return { first: first, final: final, winner: final.winner };
  },

  /** 日本シリーズ（7戦4勝） */
  playNipponSeries: function (champ, otherLeagueName) {
    const rival = {
      name: otherLeagueName,
      isUser: false,
      pyth: this.clamp(0.560 + this.gauss(0.035), 0.48, 0.66),   // もう一方のリーグの優勝チーム
    };
    const s = this.playSeries(champ, rival, 4, 0);
    return { rival: rival, series: s, winner: s.winner };
  },
};
