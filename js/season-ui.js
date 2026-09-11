/* ==================================================
   最強チームメーカー  season-ui.js
   シーズン開始前の設定画面と、シーズン結果の画面。
   （計算そのものは season.js が担当する）
   ================================================== */
'use strict';

/* ==================================================
   シーズン開始前の設定
   ================================================== */
const SeasonSetup = {

  leagueKey: 'pacific',
  teamName: 'マイチーム',
  candidates: [],   // 補充候補の投手ID
  chosen: [],       // 選んだ補充投手のID
  roles: {},        // 投手ID → 役割
  lineupReady: false,

  el: {},

  init: function () {
    this.el = {
      league:  document.getElementById('ss-league'),
      name:    document.getElementById('ss-name'),
      pool:    document.getElementById('ss-pool'),
      poolInfo:document.getElementById('ss-pool-info'),
      roles:   document.getElementById('ss-roles'),
      lineup:  document.getElementById('ss-lineup'),
      start:   document.getElementById('btn-opening'),
    };

    const self = this;

    this.el.league.addEventListener('change', function (ev) {
      const r = ev.target.closest('input[name="league"]');
      if (!r) return;
      self.leagueKey = r.value;
      self.lineupReady = false;   // DHの有無が変わるので組み直し
      self.render();
    });

    this.el.name.addEventListener('input', function () {
      self.teamName = SeasonSetup.el.name.value.slice(0, 12) || 'マイチーム';
    });

    this.el.pool.addEventListener('change', function (ev) {
      const box = ev.target.closest('input[type="checkbox"]');
      if (!box) return;
      self.toggle(box.value, box.checked);
    });

    document.getElementById('btn-pool-auto').addEventListener('click', function () {
      self.autoPick();
    });

    this.el.roles.addEventListener('change', function (ev) {
      const sel = ev.target.closest('select[data-role-for]');
      if (!sel) return;
      self.roles[sel.dataset.roleFor] = sel.value;
      self.render();
    });

    document.getElementById('btn-set-lineup').addEventListener('click', function () {
      self.openLineup();
    });

    this.el.start.addEventListener('click', function () {
      self.opening();
    });
  },

  league: function () { return Season.LEAGUES[this.leagueKey]; },
  useDH: function () { return this.league().dh; },

  /** 自分が獲得した投手（二刀流で投手として取った選手を含む） */
  ownPitcher: function () {
    const e = Game.pickedEntries().find(function (x) { return x.role === 'pitcher'; });
    return e ? e.player : null;
  },

  /** シーズンを戦う投手陣（自分の1人＋補充） */
  staff: function () {
    const own = this.ownPitcher();
    const list = own ? [own] : [];
    this.chosen.forEach(function (id) {
      const p = PlayerPool.get(id);
      if (p) list.push(p);
    });
    return list;
  },

  start: function () {
    this.leagueKey = 'pacific';
    this.teamName = 'マイチーム';
    this.lineupReady = false;
    this.chosen = [];
    this.roles = {};
    this.buildCandidates();
    this.autoPick();
  },

  /** 補充候補の投手を用意する */
  buildCandidates: function () {
    const used = Game.pickedPlayers().map(function (p) { return p.name; });
    const list = [];
    for (let i = 0; i < 60 && list.length < 18; i++) {
      const p = PlayerPool.draw(used, { pitcher: 1, fielder: 0 });
      if (!p || p.pos !== '投') continue;
      list.push(p.id);
      used.push(p.name);
    }
    this.candidates = list;
  },

  /** 補充する人数（自分の1人を除いた数） */
  needCount: function () { return CONFIG.PITCHER_ROSTER - CONFIG.PITCHER_SLOTS; },

  toggle: function (id, on) {
    const i = this.chosen.indexOf(id);
    if (on && i === -1) {
      if (this.chosen.length >= this.needCount()) { this.render(); return; }
      this.chosen.push(id);
    }
    if (!on && i !== -1) this.chosen.splice(i, 1);
    this.assignRoles();
    this.render();
  },

  /**
   * おまかせ：先発と救援のバランスを取って選ぶ。
   * 能力順に上から取るだけだと救援投手だらけになり、
   * 先発が足りなくなって成績が落ちてしまうため。
   */
  autoPick: function () {
    const byOvr = function (a, b) { return PlayerPool.get(b).ovr - PlayerPool.get(a).ovr; };
    const isStarter = function (id) { return PlayerPool.get(id).role === '先発'; };

    const starters = this.candidates.filter(isStarter).sort(byOvr);
    const relievers = this.candidates.filter(function (id) { return !isStarter(id); }).sort(byOvr);

    const own = this.ownPitcher();
    const ownIsStarter = own && own.role === '先発';

    // 先発は自分のぶんを含めて5人そろえたい
    const wantStarters = Math.max(0, 5 - (ownIsStarter ? 1 : 0));

    const pick = starters.slice(0, wantStarters)
      .concat(relievers.slice(0, this.needCount() - wantStarters));

    // 足りなければ残りから補う
    const rest = this.candidates.filter(function (id) { return pick.indexOf(id) === -1; }).sort(byOvr);
    while (pick.length < this.needCount() && rest.length > 0) pick.push(rest.shift());

    this.chosen = pick.slice(0, this.needCount());
    this.roles = {};
    this.assignRoles();
    this.render();
  },

  /**
   * 役割を自動で割り当てる。
   * 先発が5人、抑え1人、セットアッパー1人、残りは中継ぎ。
   * 元が「先発」だった投手を優先して先発に回す。
   */
  assignRoles: function () {
    const staff = this.staff();
    const roles = {};

    const starters = staff.filter(function (p) { return p.role === '先発'; });
    const relievers = staff.filter(function (p) { return p.role !== '先発'; });

    starters.sort(function (a, b) { return b.ovr - a.ovr; });
    relievers.sort(function (a, b) { return b.ovr - a.ovr; });

    const rotation = starters.slice(0, 5);
    const rest = starters.slice(5).concat(relievers);

    // 先発が5人に満たなければ、救援から回す
    while (rotation.length < 5 && rest.length > 0) rotation.push(rest.shift());

    rotation.forEach(function (p) { roles[p.id] = '先発'; });
    if (rest[0]) roles[rest[0].id] = '抑え';
    if (rest[1]) roles[rest[1].id] = 'セットアッパー';
    rest.slice(2).forEach(function (p) { roles[p.id] = '中継ぎ'; });

    // すでに手で変えていた役割は残す
    const self = this;
    staff.forEach(function (p) {
      if (!self.roles[p.id]) self.roles[p.id] = roles[p.id] || '中継ぎ';
    });

    // 選ばれていない投手の役割は消す
    const ids = staff.map(function (p) { return p.id; });
    Object.keys(this.roles).forEach(function (id) {
      if (ids.indexOf(id) === -1) delete self.roles[id];
    });
  },

  /** 打順・守備位置の画面を開く */
  openLineup: function () {
    const self = this;
    Lineup.start(Game.pickedEntries(), {
      useDH: this.useDH(),
      onDone: function () {
        self.lineupReady = true;
        self.render();
        showScreen(SCREENS.SEASON_SETUP);
      },
    });
    showScreen(SCREENS.LINEUP);
  },

  render: function () {
    const self = this;

    // --- リーグ ---
    this.el.league.querySelectorAll('input[name="league"]').forEach(function (r) {
      r.checked = r.value === self.leagueKey;
    });
    document.getElementById('ss-dh-note').textContent = this.useDH()
      ? 'DH制あり：投手は打席に立ちません。野手9人のうち1人がDHです。'
      : 'DH制なし：投手も打席に立ちます。野手1人はスタメンから外れます。';

    // --- 補充候補 ---
    this.el.poolInfo.textContent =
      '補充する投手：' + this.chosen.length + ' / ' + this.needCount() + '人';

    this.el.pool.innerHTML = this.candidates.map(function (id) {
      const p = PlayerPool.get(id);
      const on = self.chosen.indexOf(id) !== -1;
      return '' +
        '<label class="pick' + (on ? ' is-on' : '') + '">' +
          '<input type="checkbox" value="' + id + '"' + (on ? ' checked' : '') + '>' +
          '<span class="pick__body">' +
            '<b>' + esc(p.name) + '</b>' +
            '<small>' + esc(p.team) + ' ' + p.year + '・' + esc(p.role) +
              '・防御率 ' + esc(p.sp.防御率) + '</small>' +
          '</span>' +
          '<span class="pick__ovr">' + p.ovr + '</span>' +
        '</label>';
    }).join('');

    // --- 役割 ---
    const ROLES = ['先発', '中継ぎ', 'セットアッパー', '抑え'];
    const staff = this.staff();
    const own = this.ownPitcher();

    this.el.roles.innerHTML = staff.map(function (p) {
      const cur = self.roles[p.id] || '中継ぎ';
      return '' +
        '<li class="rolerow">' +
          '<span class="rolerow__name">' + esc(p.name) +
            (own && p.id === own.id ? '<i class="tag-own">獲得</i>' : '') +
            '<small>' + esc(p.team) + ' ' + p.year + '・防御率 ' + esc(p.sp.防御率) + '</small>' +
          '</span>' +
          '<select data-role-for="' + p.id + '" aria-label="' + esc(p.name) + 'の役割">' +
            ROLES.map(function (r) {
              return '<option value="' + r + '"' + (cur === r ? ' selected' : '') + '>' + r + '</option>';
            }).join('') +
          '</select>' +
        '</li>';
    }).join('');

    // --- 打順 ---
    const rotation = staff.filter(function (p) { return self.roles[p.id] === '先発'; }).length;
    const ready = this.lineupReady && this.chosen.length === this.needCount() && rotation >= 1;

    this.el.lineup.innerHTML = this.lineupReady
      ? '<p class="ok-note">打順・守備位置は設定済みです。もう一度押すと直せます。</p>'
      : '<p class="warn">まだ打順・守備位置が決まっていません。</p>';

    this.el.start.disabled = !ready;
  },

  /** 開幕！ */
  opening: function () {
    if (!window.confirm('シーズンを開始していいですか？\n\n開始すると、この編成で143試合を戦います。')) return;

    const staff = this.staff();
    const team = Lineup.build();

    const result = SeasonRun.play({
      teamName: this.teamName,
      leagueKey: this.leagueKey,
      team: team,
      staff: staff,
      roles: this.roles,
    });

    Game.state.phase = 'season';
    Game.state.season = result.save;
    Storage.save(Game.state);

    SeasonResult.show(result);
    showScreen(SCREENS.SEASON);
  },
};


/* ==================================================
   シーズンを実際に走らせる
   ================================================== */
const SeasonRun = {

  play: function (input) {
    const league = Season.LEAGUES[input.leagueKey];

    // --- ① 打者の成績を作る ---
    const batters = input.team.order.map(function (slot, i) {
      return Season.projectBatter(slot.player, i, slot.pos);
    });

    // --- ② 仮の強さを出す（勝敗の計算に必要なので先に一度作る） ---
    const rough = Season.teamStrength(batters,
      input.staff.map(function (p) {
        return Season.projectPitcher(p, input.roles[p.id] || '中継ぎ', 0.5);
      }), 0);

    // --- ③ その強さを使って投手の成績を作り直す ---
    const pitchers = input.staff.map(function (p) {
      return Season.projectPitcher(p, input.roles[p.id] || '中継ぎ', rough.pyth);
    });

    // --- ④ 守備の合計（UZR） ---
    const uzrTotal = batters.reduce(function (a, b) {
      return a + (b.uzr === null ? 0 : b.uzr);
    }, 0);

    // --- ⑤ チームの強さを確定 ---
    const strength = Season.teamStrength(batters, pitchers, uzrTotal);

    // --- ⑥ 143試合（自分のリーグと、もう一方のリーグを同時に動かす） ---
    const me = { name: input.teamName, isUser: true, pyth: strength.pyth,
                 rs: strength.rs, ra: strength.ra };
    const season = Season.playSeason(me, input.leagueKey);
    const standings = season.standings;
    const mine = standings.find(function (r) { return r.team.isUser; });

    // 日本シリーズの相手になる、もう一方のリーグの優勝チームを先に決めておく
    const otherCS = Season.playCS(season.otherStandings);
    const otherChampion = {
      name: otherCS.winner.name,
      isUser: false,
      pyth: otherCS.winner.pyth,
      league: season.otherLeague.name,
    };

    return {
      teamName: input.teamName,
      league: league,
      batters: batters,
      pitchers: pitchers,
      standings: standings,
      mine: mine,
      otherChampion: otherChampion,
      strength: strength,
      useDH: input.team.useDH,
      cs: null,
      ns: null,
      save: {
        teamName: input.teamName,
        leagueKey: input.leagueKey,
        // 再現に必要な最小限だけ保存する（数字はそのまま持つ）
        batters: batters.map(function (b) {
          return { id: b.player.id, pos: b.pos, order: b.order, pa: b.pa, ab: b.ab,
                   h: b.h, bb: b.bb, hr: b.hr, rbi: b.rbi, avg: b.avg, obp: b.obp,
                   slg: b.slg, wrc: b.wrc, uzr: b.uzr };
        }),
        pitchers: pitchers.map(function (p) {
          return { id: p.player.id, role: p.role, g: p.g, ip: p.ip, w: p.w, l: p.l,
                   era: p.era, so: p.so, bb: p.bb, hbp: p.hbp, er: p.er,
                   sv: p.sv, hld: p.hld };
        }),
        standings: standings.map(function (r) {
          return { name: r.team.name, isUser: r.team.isUser, pyth: r.team.pyth,
                   w: r.w, l: r.l, d: r.d, pct: r.pct, rank: r.rank, gb: r.gb };
        }),
        useDH: input.team.useDH,
        otherChampion: otherChampion,
        cs: null, ns: null,
      },
    };
  },

  /** 保存データから画面用の形に戻す */
  restore: function (save) {
    const league = Season.LEAGUES[save.leagueKey];
    const batters = save.batters.map(function (b) {
      const o = Object.assign({}, b);
      o.player = PlayerPool.get(b.id);
      o.ops = b.obp + b.slg;
      return o;
    });
    const pitchers = save.pitchers.map(function (p) {
      const o = Object.assign({}, p);
      o.player = PlayerPool.get(p.id);
      return o;
    });
    if (batters.some(function (b) { return !b.player; })) return null;
    if (pitchers.some(function (p) { return !p.player; })) return null;

    const standings = save.standings.map(function (r) {
      return { team: { name: r.name, isUser: r.isUser, pyth: r.pyth },
               w: r.w, l: r.l, d: r.d, pct: r.pct, rank: r.rank, gb: r.gb };
    });

    return {
      teamName: save.teamName, league: league,
      batters: batters, pitchers: pitchers, standings: standings,
      mine: standings.find(function (r) { return r.team.isUser; }),
      otherChampion: save.otherChampion,
      useDH: save.useDH,
      cs: save.cs, ns: save.ns,
      save: save,
    };
  },
};
