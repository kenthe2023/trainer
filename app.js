(function () {
  'use strict';

  var BANK = window.QBANK || [];
  var LEARN = window.LEARN || { mods: [], cards: [] };
  var LCARDS = LEARN.cards || [];
  var LMODS = LEARN.mods || [];
  var LCARD_BY_ID = {};
  for (var li = 0; li < LCARDS.length; li++) { LCARD_BY_ID[LCARDS[li].i] = LCARDS[li]; }
  var MODS = (function () {
    var arr = [], seen = {};
    for (var i = 0; i < BANK.length; i++) {
      var m = BANK[i].m;
      if (m && !seen[m]) { seen[m] = 1; arr.push(m); }
    }
    return arr;
  })();
  var LETTERS = ['A', 'B', 'C', 'D'];
  var STORE_KEY = 'ait_l3_v1';

  var db = {
    ans: {},      // id -> {ok:boolean, n:number}
    wrong: {},    // id -> {n:number, t:number}
    fav: {},      // id -> t
    exams: [],    // {t,total,score,right,wrongList}
    examDate: '',
    totalDone: 0,
    learn: {},     // 已学卡片编号 -> 1
    paper: 'p190',  // 模考配比：p190 / p180 / p100
    quiz: null     // 未完成的练习/模考会话（退出、杀进程后仍可续做）
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in o) { if (o.hasOwnProperty(k)) db[k] = o[k]; }
      }
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) {}
  }
  load();
  if (!db.learn) db.learn = {};
  if (!db.paper || (db.paper !== 'p190' && db.paper !== 'p180' && db.paper !== 'p100')) db.paper = 'p190';

  var $view = document.getElementById('view');
  var $title = document.getElementById('pageTitle');
  var $sub = document.getElementById('pageSub');
  var $back = document.getElementById('backBtn');
  var $tabbar = document.getElementById('tabbar');
  var $topbar = document.getElementById('topbar');

  var nav = { tab: 'learn', screen: 'tab' };

  // 机构课程（越平智慧校园「人工智能训练师三级」65 讲 + 考前模拟 5 讲）与本 App 卡片的对照
  var CMAP = [
    ['第 1–5 讲 · 开班预习 / 第一讲 / 人工智能概况', '1.1–1.4、3.0–3.4', 'AI 四种定义、发展史、智能体、学习范式'],
    ['第 6–16 讲 · 人工智能概论 / 数据采集（含爬虫）', '5.0、5.0.1', '四渠道采集、爬虫分类与六种策略'],
    ['第 17–25 讲 · 数据处理：清洗 / 集成 / 归约 / 变换', '5.0.2、5.0.3、5.1', '质量六维、缺失值处理、集成归约变换'],
    ['第 26–30 讲 · 数据标注工程', '5.0.4、5.0.5、5.2–5.4', '标注全流程、项目管理与质检、规范一致性'],
    ['第 31–36 讲 · 业务流程', '4.0、4.0.1、4.1–4.5', '流程六要素、五种画法、流程图结构、模块优化'],
    ['第 37–41 讲 · 智能系统设计-数据分析', '6.2.0、6.2.1、6.1、6.2', '数据库与 SQL 单表查询、排序聚合、监控归因'],
    ['第 42–47 讲 · 人机交互设计与应用', '6.3.0、6.3.1、6.3、6.6', '九步流程、需求与 KANO、设计模型'],
    ['第 48–64 讲 · 机器学习（一）到（四）', '3.0.3–3.0.5、3.2、3.3、5.5–5.7', '三要素、算法速查、全流程、评估指标'],
    ['第 65 讲 · 培训与指导', '7.0、7.0.1、7.1–7.5', '开班筹备、讲义框架、柯氏四级、指导方法'],
    ['考前模拟 5 讲 · 实操复习 + 四模块模拟', '7.0.1、4.5、5.8、5.9、6.5、6.6、7.5', '2 小时 100 分 · 25/35/35/5，答题步骤与模板']
  ];
  var learnNav = { mod: '', card: '' };
  var quiz = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function byId(id) {
    for (var i = 0; i < BANK.length; i++) { if (BANK[i].id === id) return BANK[i]; }
    return null;
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad(m) + ':' + pad(s);
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---------- 统计计算 ----------
  function statAll() {
    var done = 0, ok = 0;
    for (var k in db.ans) {
      if (db.ans.hasOwnProperty(k)) { done++; if (db.ans[k].ok) ok++; }
    }
    return { done: done, ok: ok, rate: pct(ok, done), total: BANK.length };
  }
  function statMod(m) {
    var done = 0, ok = 0;
    for (var i = 0; i < BANK.length; i++) {
      if (BANK[i].m !== m) continue;
      var a = db.ans[BANK[i].id];
      if (a) { done++; if (a.ok) ok++; }
    }
    return { done: done, ok: ok, rate: pct(ok, done), total: 0 };
  }
  function modTotal(m) {
    var n = 0;
    for (var i = 0; i < BANK.length; i++) { if (BANK[i].m === m) n++; }
    return n;
  }
  function wrongCount() {
    var n = 0;
    for (var k in db.wrong) { if (db.wrong.hasOwnProperty(k)) n++; }
    return n;
  }
  function daysLeft() {
    if (!db.examDate) return null;
    var t = new Date(db.examDate + 'T00:00:00');
    if (isNaN(t.getTime())) return null;
    var now = new Date();
    var d = Math.ceil((t - now) / 86400000);
    return d;
  }

  // ---------- 顶部 ----------
  function setHeader(title, sub, showBack) {
    $title.textContent = title;
    $sub.textContent = sub || '';
    $back.hidden = !showBack;
  }

  function setTabs(tab) {
    var ts = $tabbar.querySelectorAll('.tab');
    for (var i = 0; i < ts.length; i++) {
      ts[i].className = 'tab' + (ts[i].getAttribute('data-tab') === tab ? ' active' : '');
    }
  }

  // ---------- 首页 ----------
  function renderHome() {
    var s = statAll();
    var dl = daysLeft();
    var todayDone = db.today === todayKey() ? (db.todayN || 0) : 0;
    var rec = recommend();

    var hero =
      '<div class="hero">' +
        '<div class="kick">AI TRAINER · LEVEL 3</div>' +
        '<div class="big">' + (dl === null ? '设置考试日期' : '距考试 ' + dl + ' 天') + '</div>' +
        '<div class="sub">' + (dl === null ? '在“我的”里填入考试日期，开始倒计时' : '截至 ' + esc(db.examDate) + ' · 每天 60–90 分钟') + '</div>' +
        '<div class="hero-row">' +
          '<div class="hero-stat"><b>' + s.done + '<span style="font-size:12px;opacity:.7">/' + s.total + '</span></b><span>已刷题</span></div>' +
          '<div class="hero-stat"><b>' + s.rate + '%</b><span>总正确率</span></div>' +
          '<div class="hero-stat"><b>' + wrongCount() + '</b><span>待清错题</span></div>' +
        '</div>' +
      '</div>';

    var grid =
      '<div class="grid">' +
        entry('practice', '✎', '专项练习', '按模块和题型刷题') +
        entry('exam', '⏱', '模拟考试', '190 题 · 90 分钟') +
        entry('wrong', '✦', '错题本', '只练不会的') +
        entry('stats', '≡', '学习统计', '掌握度与记录') +
      '</div>';

    var recHtml = '';
    if (rec) {
      recHtml = '<div class="card">' +
        '<div class="row between"><div class="h2">今日推荐</div><span class="muted tiny">' + esc(rec.why) + '</span></div>' +
        '<div class="muted" style="margin:6px 0 12px">' + esc(rec.desc) + '</div>' +
        '<button class="btn" data-act="start-rec">开始 · ' + rec.count + ' 题</button>' +
      '</div>';
    }

    var modBars = '';
    for (var i = 0; i < MODS.length; i++) {
      var m = MODS[i];
      var st = statMod(m);
      var tot = modTotal(m);
      modBars += '<div class="mod-row">' +
        '<div class="mod-head"><span class="n">' + esc(m) + '</span><span class="v">' + st.done + '/' + tot + ' · ' + st.rate + '%</span></div>' +
        '<div class="bar"><i style="width:' + pct(st.done, tot) + '%"></i></div>' +
      '</div>';
    }

    var todayCard =
      '<div class="card flat">' +
        '<div class="row between"><div class="h2">今日进度</div><span class="muted tiny">' + todayDone + ' / 40 题</span></div>' +
        '<div class="bar" style="margin-top:10px"><i style="width:' + Math.min(100, pct(todayDone, 40)) + '%"></i></div>' +
        '<div class="muted tiny" style="margin-top:8px">' + (todayDone >= 40 ? '今天的量完成了，保持住。' : '再刷 ' + (40 - todayDone) + ' 题即可完成今日目标。') + '</div>' +
      '</div>';

    $view.innerHTML = hero + recHtml + '<div class="section-title">开始学习</div>' + grid +
      '<div class="section-title">模块掌握度</div><div class="card">' + modBars + '</div>' + todayCard +

      '<div class="card flat" style="margin-top:14px">' +
        '<div class="h2">考试结构速记</div>' +
        '<div class="muted" style="font-size:13px;line-height:1.7">' +
          '理论 190 题：判断 40×0.5 + 单选 140×0.5 + 多选 10×1，90 分钟，60 分合格。<br>' +
          '技能 6 单元 120 分钟：业务分析、智能训练、智能系统设计、培训与指导。' +
        '</div>' +
      '</div>';

    setHeader('训练师三级', '2026–2027 考证 · 高级工');
  }

  // ---------- 学习模式 ----------
  function learnDoneN() {
    var n = 0;
    for (var k in db.learn) { if (db.learn[k]) n++; }
    return n;
  }
  function modCards(m) {
    var list = [];
    for (var i = 0; i < LCARDS.length; i++) { if (LCARDS[i].m === m) list.push(LCARDS[i]); }
    return list;
  }
  function modLearnedN(m) {
    var list = modCards(m), n = 0;
    for (var i = 0; i < list.length; i++) { if (db.learn[list[i].i]) n++; }
    return n;
  }
  function cardIdx(id) {
    for (var i = 0; i < LCARDS.length; i++) { if (LCARDS[i].i === id) return i; }
    return -1;
  }
  function firstUnlearned() {
    for (var i = 0; i < LCARDS.length; i++) { if (!db.learn[LCARDS[i].i]) return LCARDS[i]; }
    return null;
  }

  function renderLearn() {
    nav.screen = 'tab';
    var s = statAll();
    var dl = daysLeft();
    var doneN = learnDoneN();
    var total = LCARDS.length;
    var next = firstUnlearned();

    var hero =
      '<div class="hero">' +
        '<div class="kick">先学 · 后练 · 再模考</div>' +
        '<div class="big">' + (dl === null ? '设置考试日期' : '距考试 ' + dl + ' 天') + '</div>' +
        '<div class="sub">' + (dl === null ? '在“我的”里填入考试日期，开始倒计时' : '截至 ' + esc(db.examDate) + ' · 每天 1–2 节，学完再做题') + '</div>' +
        '<div class="hero-row">' +
          '<div class="hero-stat"><b>' + doneN + '<span style="font-size:12px;opacity:.7">/' + total + '</span></b><span>已学小节</span></div>' +
          '<div class="hero-stat"><b>' + s.done + '</b><span>已刷题</span></div>' +
          '<div class="hero-stat"><b>' + s.rate + '%</b><span>正确率</span></div>' +
        '</div>' +
      '</div>';

    var contCard =
      '<div class="card">' +
        '<div class="row between"><div class="h2">学习进度</div><span class="muted tiny">' + doneN + ' / ' + total + ' 节</span></div>' +
        '<div class="bar" style="margin:10px 0 6px"><i style="width:' + pct(doneN, total) + '%"></i></div>' +
        '<div class="muted tiny" style="margin-bottom:12px">' +
          (next ? '下一节：' + esc(next.i) + ' ' + esc(next.t) : '全部学完，直接去模考检验。') +
        '</div>' +
        '<button class="btn" data-act="learn-continue">' + (next ? '继续学习' : '去模考') + '</button>' +
      '</div>';

    var modRows = '';
    for (var i = 0; i < LMODS.length; i++) {
      var m = LMODS[i].m;
      var list = modCards(m);
      var dn = modLearnedN(m);
      var p = pct(dn, list.length);
      modRows += '<button class="mod-entry" data-act="open-mod" data-mod="' + esc(m) + '">' +
        '<div class="me-left">' +
          '<div class="me-name">' + esc(m) + '</div>' +
          '<div class="me-sub">' + list.length + ' 节 · 已学 ' + dn + '</div>' +
          '<div class="bar" style="margin-top:8px"><i style="width:' + p + '%"></i></div>' +
        '</div>' +
        '<div class="me-right"><span class="me-pct">' + p + '%</span><span class="me-arrow">›</span></div>' +
      '</button>';
    }

    var rec = recommend();
    var recHtml = '';
    if (rec) {
      recHtml = '<div class="section-title">学完就练</div>' +
        '<div class="card">' +
          '<div class="row between"><div class="h2">今日推荐</div><span class="muted tiny">' + esc(rec.why) + '</span></div>' +
          '<div class="muted" style="margin:6px 0 12px">' + esc(rec.desc) + '</div>' +
          '<button class="btn ghost" data-act="start-rec">练 ' + rec.count + ' 题</button>' +
        '</div>';
    }

    var pnow = PAPERS[db.paper] || PAPERS.p190;
    var quick =
      '<div class="card flat">' +
        '<div class="h2">考试结构速记</div>' +
        '<div class="muted" style="font-size:13px;line-height:1.8">' +
          '理论 ' + pnow.total + ' 题 / 100 分 / 90 分钟：判断 ' + pnow.judge + '×' + pnow.jp + ' · 单选 ' + pnow.single + '×' + pnow.sp + ' · 多选 ' + pnow.multi + '×' + pnow.mp + '，60 分合格。<br>' +
          '技能 6 单元 / 120 分钟：智能训练与智能系统设计为必考单元。<br>' +
          '两科都过 60 分才算合格，单科不及格可分别补考。<br>' +
          '<span class="tiny">题量配比按你报考机构的方案，在“模考”页切换。</span>' +
        '</div>' +
      '</div>';

    var cmapRows = '';
    for (var ci = 0; ci < CMAP.length; ci++) {
      cmapRows += '<div class="list-item"><div class="li-main">' +
        '<div class="li-title" style="font-weight:500;font-size:13px;line-height:1.5">' + esc(CMAP[ci][0]) + '</div>' +
        '<div class="li-sub">对照 ' + esc(CMAP[ci][1]) + ' · ' + esc(CMAP[ci][2]) + '</div></div></div>';
    }

    var courseCard =
      '<div class="section-title">机构视频课对照</div>' +
      '<div class="card" style="padding:4px 16px">' + cmapRows + '</div>' +
      '<div class="tips">机构小程序「越平智慧校园 · 人工智能训练师三级」共 65 讲，另有考前模拟 5 讲。全部 ' + LCARDS.length + ' 张学习卡已按真题考点重编：每张卡标注本模块真题数量，卡内「真题示例」直接选自机构题库并为最新逐题解析，学完点「练本模块真题」就能当场验证。建议先看视频再翻卡片记要点，最后做题。登录学号 20261110008887。</div>';

    $view.innerHTML = hero + contCard +
      '<div class="section-title">按模块学习</div>' +
      '<div class="card" style="padding:4px 16px">' + modRows + '</div>' +
      recHtml + quick + courseCard;

    setHeader('训练师三级', '2026–2027 考证 · 高级工');
    updateTabVisible(true);
  }

  function openMod(m) {
    learnNav.mod = m;
    renderLearnMod(m);
  }

  function renderLearnMod(m) {
    learnNav.mod = m;
    nav.screen = 'modlist';
    var list = modCards(m);
    var dn = modLearnedN(m);
    var rows = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var done = !!db.learn[c.i];
      var meta = c.p.length + ' 条要点';
      if (c.tpl) meta += ' · 技能模板';
      if (c.qn) meta += ' · 本模块真题 ' + c.qn + ' 道';
      rows += '<button class="lc-item" data-act="open-card" data-card="' + esc(c.i) + '">' +
        '<span class="lc-no">' + esc(c.i) + '</span>' +
        '<span class="lc-main"><span class="lc-t">' + esc(c.t) + '</span>' +
          '<span class="lc-s">' + meta + '</span></span>' +
        '<span class="lc-st' + (done ? ' done' : '') + '">' + (done ? '已学' : '未学') + '</span>' +
      '</button>';
    }
    var drill = m === '考前速记' ? '' :
      '<button class="btn ghost" style="margin-top:14px" data-act="drill-mod" data-mod="' + esc(m) + '">练本模块 10 题</button>';

    $view.innerHTML =
      '<div class="card" style="margin-top:12px">' +
        '<div class="row between"><div class="h2">' + esc(m) + '</div><span class="muted tiny">' + dn + ' / ' + list.length + ' 节</span></div>' +
        '<div class="bar" style="margin-top:10px"><i style="width:' + pct(dn, list.length) + '%"></i></div>' +
      '</div>' +
      '<div class="card" style="padding:4px 16px">' + rows + '</div>' +
      drill +
      '<div style="height:20px"></div>';

    setHeader(m, list.length + ' 节 · 已学 ' + dn, true);
    updateTabVisible(false);
  }

  function openCard(id) {
    learnNav.card = id;
    renderCard(id);
  }

  function renderCard(id) {
    var c = LCARD_BY_ID[id];
    if (!c) { goTab('learn'); return; }
    learnNav.card = id;
    nav.screen = 'card';
    var done = !!db.learn[id];

    var pts = '';
    for (var i = 0; i < c.p.length; i++) {
      pts += '<div class="pt-item">' + esc(c.p[i]) + '</div>';
    }

    var tipHtml = c.tip ? '<div class="tip-block"><span class="block-label">记住这一点</span>' + esc(c.tip) + '</div>' : '';
    var tplHtml = c.tpl ? '<div class="tpl-block"><span class="block-label">技能作答模板 · 直接背下来</span>' + esc(c.tpl) + '</div>' : '';

    var exHtml = '';
    if (c.ex && c.ex.length) {
      exHtml = '<div class="section-title" style="margin-top:22px">真题示例 · 选自机构题库</div>';
      for (var j = 0; j < c.ex.length; j++) {
        var e = c.ex[j];
        exHtml += '<div class="ex-block">' +
          '<div class="ex-q">' + esc(e.q) + '</div>' +
          '<button class="btn small ghost" style="margin-top:12px" data-act="reveal-ans">看答案与解析</button>' +
          '<div class="ex-ans">' +
            '<div class="ex-a">答案：' + esc(e.a) + '</div>' +
            (e.e ? '<div class="ex-e">' + esc(e.e) + '</div>' : '') +
          '</div>' +
        '</div>';
      }
    }

    var metaBits = [];
    if (c.tp && c.tp !== '通用考点') metaBits.push('考点：' + c.tp);
    if (c.qn) metaBits.push('本模块真题 ' + c.qn + ' 道');
    var metaHtml = metaBits.length
      ? '<div class="muted tiny" style="margin:8px 2px 0">' + esc(metaBits.join(' · ')) + '</div>'
      : '';
    var drillHtml = (c.qn && c.mk)
      ? '<button class="btn ghost" style="margin-top:14px" data-act="drill-k" data-k="' + esc(c.mk) + '">练本模块真题（' + c.qn + ' 道）</button>'
      : '';

    var idx = cardIdx(id);
    var isLast = idx >= LCARDS.length - 1;
    var mainLabel = isLast ? '完成本节' : (done ? '下一节' : '学会了 · 下一节');

    $view.innerHTML =
      '<div class="muted tiny" style="margin:14px 2px 0">' + esc(c.c) + ' · ' + esc(c.m) + '</div>' +
      '<div class="h1">' + esc(c.i) + ' ' + esc(c.t) + '</div>' +
      metaHtml +
      '<div class="card" style="padding:4px 18px 18px">' + pts + tipHtml + tplHtml + '</div>' +
      drillHtml +
      exHtml +
      '<div style="height:100px"></div>' +
      '<div class="footer-fixed"><div class="pager">' +
        '<button class="btn line" data-act="learn-prev" ' + (idx <= 0 ? 'disabled' : '') + '>上一节</button>' +
        '<button class="btn" data-act="learn-next">' + mainLabel + '</button>' +
      '</div></div>';

    setHeader(c.i + ' ' + c.t, c.m + (done ? ' · 已学' : ''), true);
    updateTabVisible(false);
  }

  function revealAns(btn) {
    var box = btn.parentNode ? btn.parentNode.querySelector('.ex-ans') : null;
    if (!box) return;
    box.className = 'ex-ans show';
    btn.style.display = 'none';
  }

  function learnNext() {
    var idx = cardIdx(learnNav.card);
    if (idx < 0) { goTab('learn'); return; }
    var c = LCARDS[idx];
    if (!db.learn[c.i]) { db.learn[c.i] = 1; save(); }
    if (idx >= LCARDS.length - 1) {
      showToast('这一节学会了');
      if (learnNav.mod) renderLearnMod(learnNav.mod); else goTab('learn');
      return;
    }
    openCard(LCARDS[idx + 1].i);
  }

  function learnPrev() {
    var idx = cardIdx(learnNav.card);
    if (idx <= 0) return;
    openCard(LCARDS[idx - 1].i);
  }

  function learnContinue() {
    var next = firstUnlearned();
    if (!next) { goTab('exam'); return; }
    learnNav.mod = next.m;
    openCard(next.i);
  }

  function bankIdsByTopics(tops, n) {
    var out = [];
    for (var i = 0; i < BANK.length; i++) {
      var e = BANK[i].e || '';
      for (var j = 0; j < tops.length; j++) {
        if (e.indexOf('【考点】' + tops[j]) === 0) { out.push(BANK[i].id); break; }
      }
    }
    return shuffle(out).slice(0, n);
  }

  // 模块键 → 题目池（按 tagged 的 k 字段筛题）
  function bankIdsByK(k, n) {
    var out = [];
    for (var i = 0; i < BANK.length; i++) {
      if (k && BANK[i].k === k) out.push(BANK[i].id);
    }
    return shuffle(out).slice(0, n);
  }

  var MODK = {
    '职业与基础': 'jichu', '业务分析': 'yewu', '智能训练': 'xunlian',
    '智能系统设计': 'sheji', '运维与测试': 'yunwei', '培训与指导': 'peixun'
  };

  function drillMod(m) {
    var k = MODK[m];
    var ids = k ? bankIdsByK(k, 10) : [];
    if (!ids.length) ids = pickUnseen(m, 10);
    if (!ids.length) { showToast('本模块暂无题目'); return; }
    startQuiz({ ids: ids, mode: 'practice', title: m + ' · 10 题' });
  }

  function entry(act, ico, name, desc) {
    return '<button class="entry" data-act="' + act + '">' +
      '<span class="entry-ico">' + ico + '</span>' +
      '<span class="entry-name">' + name + '</span>' +
      '<span class="entry-desc">' + desc + '</span></button>';
  }

  // 推荐：优先错题，其次没做过的，再其次正确率低的模块
  function recommend() {
    var wrongIds = [];
    for (var k in db.wrong) { if (db.wrong.hasOwnProperty(k)) wrongIds.push(parseInt(k, 10)); }
    if (wrongIds.length >= 5) {
      return { ids: wrongIds.slice(0, 20), count: Math.min(20, wrongIds.length), why: '错题优先', desc: '先把错题清掉，比刷新题更划算。' };
    }
    // 找正确率最低且有未做题的模块
    var best = null;
    for (var i = 0; i < MODS.length; i++) {
      var m = MODS[i];
      var undone = 0;
      for (var j = 0; j < BANK.length; j++) {
        if (BANK[j].m === m && !db.ans[BANK[j].id]) undone++;
      }
      if (undone === 0) continue;
      var st = statMod(m);
      var score = (100 - st.rate) * (undone / modTotal(m));
      if (!best || score > best.score) best = { m: m, undone: undone, score: score, rate: st.rate };
    }
    if (!best) return null;
    var pick = pickUnseen(best.m, 20);
    return {
      ids: pick, count: pick.length, why: best.m,
      desc: '该模块还有 ' + best.undone + ' 题没做过，当前正确率 ' + best.rate + '%。'
    };
  }

  function pickUnseen(m, n) {
    var pool = [];
    for (var i = 0; i < BANK.length; i++) {
      if (BANK[i].m === m && !db.ans[BANK[i].id]) pool.push(BANK[i].id);
    }
    pool = shuffle(pool);
    return pool.slice(0, n);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------- 练习设置 ----------
  var practiceSel = { mod: '全部', type: '全部', order: '顺序' };

  function renderPractice() {
    var modChips = '<div class="row wrap">';
    var mods = ['全部'].concat(MODS);
    for (var i = 0; i < mods.length; i++) {
      modChips += '<button class="chip' + (practiceSel.mod === mods[i] ? ' on' : '') + '" data-act="pick-mod" data-v="' + esc(mods[i]) + '">' + esc(mods[i]) + '</button>';
    }
    modChips += '</div>';

    var typeChips = '<div class="row wrap">';
    var types = ['全部', '判断', '单选', '多选'];
    for (var j = 0; j < types.length; j++) {
      typeChips += '<button class="chip' + (practiceSel.type === types[j] ? ' on' : '') + '" data-act="pick-type" data-v="' + esc(types[j]) + '">' + esc(types[j]) + '</button>';
    }
    typeChips += '</div>';

    var orderChips = '<div class="row wrap">';
    var orders = ['顺序', '随机'];
    for (var k = 0; k < orders.length; k++) {
      orderChips += '<button class="chip' + (practiceSel.order === orders[k] ? ' on' : '') + '" data-act="pick-order" data-v="' + esc(orders[k]) + '">' + esc(orders[k]) + '</button>';
    }
    orderChips += '</div>';

    var count = countFilter();

    $view.innerHTML =
      resumeCard('practice') +
      '<div class="card" style="margin-top:12px">' +
        '<div class="h2">模块</div>' + modChips +
        '<div class="h2" style="margin-top:16px">题型</div>' + typeChips +
        '<div class="h2" style="margin-top:16px">顺序</div>' + orderChips +
      '</div>' +
      '<div class="card flat"><div class="row between"><span class="muted">当前可选题目</span><b>' + count + ' 题</b></div></div>' +
      '<div style="height:8px"></div>' +
      '<button class="btn" data-act="start-practice" ' + (count ? '' : 'disabled') + '>开始练习</button>' +
      '<div class="tips" style="margin-top:14px">判断题与单选题点选后立即判定；多选题选完点“提交”再判定。答错自动进入错题本。</div>';

    setHeader('专项练习', '按模块 / 题型筛选');
  }

  function countFilter() {
    var n = 0;
    for (var i = 0; i < BANK.length; i++) {
      if (practiceSel.mod !== '全部' && BANK[i].m !== practiceSel.mod) continue;
      if (practiceSel.type !== '全部' && BANK[i].t !== practiceSel.type) continue;
      n++;
    }
    return n;
  }

  function filterIds() {
    var ids = [];
    for (var i = 0; i < BANK.length; i++) {
      if (practiceSel.mod !== '全部' && BANK[i].m !== practiceSel.mod) continue;
      if (practiceSel.type !== '全部' && BANK[i].t !== practiceSel.type) continue;
      ids.push(BANK[i].id);
    }
    if (practiceSel.order === '随机') ids = shuffle(ids);
    return ids;
  }

  // ---------- 考试 ----------
  // 广东各评价机构三级理论配比不完全一致，做成可选纸型；各配比分值合计均为 100 分
  var PAPERS = {
    p190: { key: 'p190', name: '标准版', total: 190, judge: 40, single: 140, multi: 10, jp: 0.5, sp: 0.5, mp: 1 },
    p180: { key: 'p180', name: '变体版', total: 180, judge: 40, single: 120, multi: 20, jp: 0.5, sp: 0.5, mp: 1 },
    p100: { key: 'p100', name: '精简版', total: 100, judge: 20, single: 70, multi: 10, jp: 1, sp: 1, mp: 1 }
  };

  function renderExam() {
    var paper = PAPERS[db.paper] || PAPERS.p190;
    var last = db.exams.length ? db.exams[db.exams.length - 1] : null;

    var chips = '<div class="row wrap">';
    for (var p in PAPERS) {
      if (!PAPERS.hasOwnProperty(p)) continue;
      chips += '<button class="chip' + (db.paper === p ? ' on' : '') + '" data-act="pick-paper" data-v="' + p + '">' +
        PAPERS[p].name + ' ' + PAPERS[p].total + ' 题</button>';
    }
    chips += '</div>';

    var hist = '';
    if (db.exams.length) {
      hist = '<div class="section-title">历史记录</div><div class="card">';
      for (var i = db.exams.length - 1; i >= 0 && i >= db.exams.length - 5; i--) {
        var e = db.exams[i];
        hist += '<div class="list-item"><div class="li-main">' +
          '<div class="li-title">' + e.score + ' 分 · 正确 ' + e.right + '/' + e.total + '</div>' +
          '<div class="li-sub">' + esc(e.t) + (e.paper && PAPERS[e.paper] ? ' · ' + PAPERS[e.paper].name : '') + '</div></div>' +
          '<span class="badge' + (e.score >= 60 ? '' : ' multi') + '">' + (e.score >= 60 ? '合格' : '未达标') + '</span></div>';
      }
      hist += '</div>';
    }

    $view.innerHTML =
      resumeCard('exam') +
      '<div class="hero" style="background:linear-gradient(150deg,#243A5E 0%,#3C5C8F 100%)">' +
        '<div class="kick">MOCK EXAM</div>' +
        '<div class="big">' + paper.total + ' 题 · 90 分钟</div>' +
        '<div class="sub">判断 ' + paper.judge + '（' + paper.jp + ' 分/题）· 单选 ' + paper.single + '（' + paper.sp + ' 分/题）· 多选 ' + paper.multi + '（' + paper.mp + ' 分/题）</div>' +
        '<div class="hero-row">' +
          '<div class="hero-stat"><b>100</b><span>满分</span></div>' +
          '<div class="hero-stat"><b>60</b><span>合格线</span></div>' +
          '<div class="hero-stat"><b>' + (last ? last.score : '—') + '</b><span>上次得分</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:12px">' +
        '<div class="h2">按你机构的方案选一项</div>' + chips +
        '<div class="muted" style="font-size:12.5px;line-height:1.75;margin-top:10px">' +
          '广东省内不同评价机构的三级理论配比不一样，常见三种：190 题（判断 40 / 单选 140 / 多选 10，判断与单选各 0.5 分）；180 题（判断 40 / 单选 120 / 多选 20）；100 题（判断 20 / 单选 70 / 多选 10，每题 1 分）。按报名机构给的方案选，模考会照该配比抽题、按真实每题分值算分。' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="h2">考试规则</div>' +
        '<div class="muted" style="font-size:13px;line-height:1.8">' +
          '· 作答过程中不显示对错，交卷后统一评分<br>' +
          '· 时间到自动交卷，未答题目按错计<br>' +
          '· 多选题少选、多选、错选均不得分<br>' +
          '· 交卷后可查看错题与解析' +
        '</div>' +
      '</div>' +
      '<button class="btn" data-act="start-exam">开始模拟考试（' + paper.total + ' 题）</button>' + hist +
      '<div class="tips" style="margin-top:14px">题库共 ' + BANK.length + ' 题，模考按所选配比随机抽取，多次模考题目不完全重复。</div>';

    setHeader('模拟考试', paper.name + ' · ' + paper.total + ' 题');
  }

  function buildExamSet(paperKey) {
    var p = PAPERS[paperKey] || PAPERS.p190;
    var judge = [], single = [], multi = [];
    for (var i = 0; i < BANK.length; i++) {
      if (BANK[i].t === '判断') judge.push(BANK[i].id);
      else if (BANK[i].t === '单选') single.push(BANK[i].id);
      else multi.push(BANK[i].id);
    }
    var ids = shuffle(judge).slice(0, p.judge)
      .concat(shuffle(single).slice(0, p.single))
      .concat(shuffle(multi).slice(0, p.multi));
    var picked = {};
    for (var k = 0; k < ids.length; k++) picked[ids[k]] = 1;
    if (ids.length < p.total) {
      var pool = shuffle(BANK.map(function (x) { return x.id; }));
      for (var z = 0; z < pool.length && ids.length < p.total; z++) {
        if (!picked[pool[z]]) { picked[pool[z]] = 1; ids.push(pool[z]); }
      }
    }
    return ids;
  }

  // ---------- 错题本 ----------
  function renderWrong() {
    var ids = wrongIdsSorted();
    if (!ids.length) {
      $view.innerHTML = '<div class="empty"><span class="e-ico">✦</span>错题本是空的<br><span class="tiny">练习时答错的题会自动收进来，同一题连续答对 2 次自动移出</span></div>';
      setHeader('错题本', '0 题');
      return;
    }
    var hardN = 0, rows = '';
    for (var i = 0; i < ids.length; i++) {
      var q = byId(ids[i]);
      if (!q) continue;
      var w = db.wrong[ids[i]] || { n: 1 };
      var n = w.n || 1;
      if (n >= 2) hardN++;
      var star = n >= 3 ? ' ★★★' : (n >= 2 ? ' ★★' : '');
      rows += '<div class="list-item" data-act="repair" data-id="' + q.id + '">' +
        '<div class="li-main"><div class="li-title" style="font-weight:500;font-size:13.5px;line-height:1.5">' + esc(q.q.slice(0, 42)) + (q.q.length > 42 ? '…' : '') + '</div>' +
        '<div class="li-sub">' + esc(q.m) + ' · ' + esc(q.t) + ' · 错 ' + n + ' 次' + star +
        (w.ok ? ' · 已连对 ' + w.ok + '/2' : '') + '</div></div>' +
        '<span class="muted" style="font-size:18px">›</span></div>';
    }
    $view.innerHTML =
      '<div class="card flat" style="margin-top:12px">' +
        '<div class="row between"><span>共 <b>' + ids.length + '</b> 道错题</span><span class="tiny muted">错 2 次以上 ' + hardN + ' 道</span></div>' +
        '<div class="tiny muted" style="margin-top:6px">点任意一题可直接重做并查看解析；连续答对 2 次自动移出。</div>' +
      '</div>' +
      '<button class="btn" style="margin:10px 0 6px" data-act="start-wrong">重练全部错题</button>' +
      (hardN ? '<button class="btn line" data-act="start-hard">只练顽固错题（' + hardN + '）</button>' : '') +
      '<div class="card" style="padding:4px 16px;margin-top:10px">' + rows + '</div>' +
      '<button class="btn ghost" style="margin-top:12px" data-act="clear-wrong">清空错题本</button>';
    setHeader('错题本', ids.length + ' 题');
  }

  function wrongIdsSorted() {
    var ids = [];
    for (var k in db.wrong) { if (db.wrong.hasOwnProperty(k)) ids.push(parseInt(k, 10)); }
    ids.sort(function (a, b) {
      var x = db.wrong[a] || {}, y = db.wrong[b] || {};
      return (y.n || 0) - (x.n || 0) || ((y.t || 0) - (x.t || 0));
    });
    return ids;
  }

  // ---------- 统计 ----------
  function renderStats() {
    var s = statAll();
    var bars = '';
    for (var i = 0; i < MODS.length; i++) {
      var m = MODS[i], st = statMod(m), tot = modTotal(m);
      var color = st.rate >= 80 ? 'var(--ok)' : (st.rate >= 60 ? 'var(--accent)' : 'var(--bad)');
      bars += '<div class="mod-row">' +
        '<div class="mod-head"><span class="n">' + esc(m) + '</span><span class="v">' + st.ok + '/' + st.done + ' 正确 · 覆盖 ' + pct(st.done, tot) + '%</span></div>' +
        '<div class="bar"><i style="width:' + st.rate + '%;background:' + color + '"></i></div>' +
      '</div>';
    }
    var histRows = '';
    if (db.exams.length) {
      for (var j = db.exams.length - 1; j >= 0 && j >= db.exams.length - 8; j--) {
        var e = db.exams[j];
        histRows += '<div class="list-item"><div class="li-main"><div class="li-title">' + e.score + ' 分</div>' +
          '<div class="li-sub">' + esc(e.t) + ' · 正确 ' + e.right + '/' + e.total + '</div></div></div>';
      }
    } else {
      histRows = '<div class="muted" style="padding:12px 4px">还没有模考记录</div>';
    }

    $view.innerHTML =
      '<div class="card" style="margin-top:12px">' +
        '<div class="statbig"><b>' + s.rate + '%</b><span>总正确率</span></div>' +
        '<div class="row" style="margin-top:6px;gap:22px">' +
          '<div><div class="muted tiny">已做</div><div style="font-weight:700">' + s.done + ' 题</div></div>' +
          '<div><div class="muted tiny">正确</div><div style="font-weight:700;color:var(--ok)">' + s.ok + ' 题</div></div>' +
          '<div><div class="muted tiny">题库</div><div style="font-weight:700">' + s.total + ' 题</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="section-title">各模块掌握度</div><div class="card">' + bars + '</div>' +
      '<div class="section-title">模拟考记录</div><div class="card" style="padding:4px 16px">' + histRows + '</div>';

    setHeader('学习统计', '按最后一次作答计算');
  }

  // ---------- 我的 ----------
  function renderMe() {
    var dl = daysLeft();
    var s = statAll();
    $view.innerHTML =
      '<div class="card" style="margin-top:12px">' +
        '<div class="h2">考试日期</div>' +
        '<div class="muted" style="margin-bottom:10px">填上考试日，首页会显示倒计时。</div>' +
        '<input type="date" id="examDate" value="' + esc(db.examDate) + '" ' +
        'style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:15px">' +
        '<div style="height:10px"></div>' +
        '<button class="btn small" data-act="save-date" style="width:100%">保存考试日期</button>' +
      '</div>' +
      '<div class="card flat"><div class="list-item"><div class="li-main"><div class="li-title">题库总量</div><div class="li-sub">机构题库真题（练习一 + 练习二，已去重）</div></div><b>' + BANK.length + '</b></div>' +
        '<div class="list-item"><div class="li-main"><div class="li-title">已作答</div><div class="li-sub">去重统计</div></div><b>' + s.done + '</b></div>' +
        '<div class="list-item"><div class="li-main"><div class="li-title">错题</div><div class="li-sub">含历史累计</div></div><b>' + wrongCount() + '</b></div>' +
        '<div class="list-item"><div class="li-main"><div class="li-title">模考次数</div><div class="li-sub">完整 190 题</div></div><b>' + db.exams.length + '</b></div>' +
      '</div>' +
      '<button class="btn ghost" style="margin-top:14px" data-act="stats">查看学习统计</button>' +
      '<button class="btn line" style="margin-top:14px" data-act="reset-all">清空全部学习记录</button>' +
      '<div class="tips" style="margin-top:14px">本应用完全离线运行，不联网、不上传任何数据，学习记录只保存在本机。</div>' +
      '<div class="muted tiny" style="text-align:center;margin:20px 0 8px">依据《人工智能训练师国家职业技能标准（2021 年版）》与三级认定考试方案整理</div>';

    setHeader('我的', dl === null ? '未设置考试日期' : '距考试 ' + dl + ' 天');
  }

  // ---------- 答题 ----------
  // ---------- 会话持久化：任何一次作答都落盘，退出/杀进程后可续做 ----------
  function saveQuiz() {
    if (!quiz) { db.quiz = null; save(); return; }
    db.quiz = {
      ids: quiz.ids,
      idx: quiz.idx,
      answers: quiz.answers,
      judged: quiz.judged,
      mode: quiz.mode,
      title: quiz.title,
      paper: quiz.paper,
      remain: quiz.remain,
      t: Date.now()
    };
    save();
  }

  // 离开练习页时，把当前已选但还没提交的答案判定掉，保证"错了立刻进错题本"
  function flushJudge() {
    if (!quiz) return;
    if (quiz.mode !== 'practice') { saveQuiz(); return; }
    var q = byId(quiz.ids[quiz.idx]);
    if (!q || quiz.judged[q.id]) { saveQuiz(); return; }
    var sel = quiz.answers[q.id] || [];
    if (!sel.length) { saveQuiz(); return; }
    quiz.judged[q.id] = true;
    recordAnswer(q, sel, true);
    saveQuiz();
  }

  function resumeQuiz() {
    var s = db.quiz;
    if (!s || !s.ids || !s.ids.length) return false;
    quiz = {
      ids: s.ids,
      idx: Math.min(Math.max(0, s.idx || 0), s.ids.length - 1),
      answers: s.answers || {},
      judged: s.judged || {},
      mode: s.mode === 'exam' ? 'exam' : 'practice',
      title: s.title || '继续练习',
      paper: s.paper || '',
      timer: null,
      remain: s.remain || 0
    };
    nav.screen = 'quiz';
    renderQuiz();
    if (quiz.mode === 'exam' && quiz.remain > 0) startTimer();
    return true;
  }

  function quizDoneN(s) {
    if (!s || !s.answers) return 0;
    var n = 0;
    for (var k in s.answers) { if (s.answers.hasOwnProperty(k) && s.answers[k] && s.answers[k].length) n++; }
    return n;
  }

  function resumeCard(kind) {
    var s = db.quiz;
    if (!s || !s.ids || !s.ids.length) return '';
    if ((s.mode === 'exam') !== (kind === 'exam')) return '';
    var done = quizDoneN(s);
    return '<div class="card" style="border-color:var(--accent)">' +
      '<div class="row between"><div class="h2">上次没做完，可以接着做</div><span class="muted tiny">' + done + ' / ' + s.ids.length + ' 已答</span></div>' +
      '<div class="muted" style="margin:8px 0 12px;font-size:13px">' + esc(s.title || '练习') + ' · 停在第 ' + ((s.idx || 0) + 1) + ' 题，答题记录和错题都已保存。</div>' +
      '<div class="row"><button class="btn" data-act="resume-quiz">继续做题</button>' +
      '<button class="btn ghost" data-act="drop-quiz" style="margin-left:10px">放弃这次</button></div>' +
    '</div>';
  }

  function startQuiz(opts) {
    quiz = {
      ids: opts.ids,
      idx: 0,
      answers: {},     // id -> 数组（选中下标）
      judged: {},      // id -> true
      mode: opts.mode, // 'practice' | 'exam'
      title: opts.title,
      startAt: Date.now(),
      limit: opts.limit || 0,
      paper: opts.paper || '',
      timer: null,
      remain: opts.limit || 0
    };
    nav.screen = 'quiz';
    renderQuiz();
    if (opts.limit) startTimer();
    saveQuiz();
  }

  function startTimer() {
    stopTimer();
    quiz.timer = setInterval(function () {
      quiz.remain--;
      var t = document.getElementById('timer');
      if (t) t.textContent = fmtTime(Math.max(0, quiz.remain));
      if (quiz.remain <= 0) {
        stopTimer();
        submitExam(true);
      }
    }, 1000);
  }
  function stopTimer() { if (quiz && quiz.timer) { clearInterval(quiz.timer); quiz.timer = null; } }

  function renderQuiz() {
    if (!quiz) return;
    var q = byId(quiz.ids[quiz.idx]);
    if (!q) return;
    var sel = quiz.answers[q.id] || [];
    var judged = quiz.mode === 'practice' && quiz.judged[q.id];
    var badgeCls = q.t === '多选' ? ' multi' : (q.t === '判断' ? ' judge' : '');

    var opts = '';
    for (var i = 0; i < q.o.length; i++) {
      var cls = 'opt';
      if (judged) {
        var correct = isCorrect(q, sel);
        if (isAnswer(q, i)) cls += ' right';
        else if (sel.indexOf(i) >= 0) cls += ' wrong';
      } else if (sel.indexOf(i) >= 0) {
        cls += ' sel';
      }
      opts += '<button class="' + cls + '" data-act="pick-opt" data-i="' + i + '">' +
        '<span class="key">' + (q.t === '判断' ? (i === 0 ? '✓' : '✕') : LETTERS[i]) + '</span>' +
        '<span class="txt">' + esc(q.o[i]) + '</span></button>';
    }

    var verdict = '';
    var explain = '';
    if (judged) {
      var ok = isCorrect(q, sel);
      verdict = '<div class="verdict ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '回答正确' : '回答错误 · 正确答案 ' + answerText(q)) + '</div>';
      if (q.e) {
        explain = '<div class="explain"><div class="etitle">解析</div><div class="ebody">' + esc(q.e) + '</div></div>';
      }
    }

    var barW = pct(quiz.idx + 1, quiz.ids.length);
    var timerHtml = quiz.mode === 'exam' ? '<span class="timer" id="timer">' + fmtTime(quiz.remain) + '</span>' : '';

    var bottom = '';
    if (quiz.mode === 'exam') {
      bottom = '<div class="pager">' +
        '<button class="btn line" data-act="prev-q" ' + (quiz.idx === 0 ? 'disabled' : '') + '>上一题</button>' +
        (quiz.idx === quiz.ids.length - 1
          ? '<button class="btn" data-act="submit-exam">交卷</button>'
          : '<button class="btn" data-act="next-q">下一题</button>') +
      '</div>';
    } else {
      bottom = '<div class="pager">' +
        (judged
          ? '<button class="btn" data-act="next-q">' + (quiz.idx === quiz.ids.length - 1 ? '查看结果' : '下一题') + '</button>'
          : (q.t === '多选'
              ? '<button class="btn" data-act="judge" ' + (sel.length ? '' : 'disabled') + '>提交答案</button>'
              : '<button class="btn" disabled>请选择答案</button>')) +
      '</div>';
    }

    $view.innerHTML =
      '<div class="quizbar">' +
        '<span class="qcount">' + (quiz.idx + 1) + ' / ' + quiz.ids.length + '</span>' +
        '<div class="bar"><i style="width:' + barW + '%"></i></div>' +
        timerHtml +
      '</div>' +
      '<div class="qcard card" style="margin-top:0">' +
        '<div class="qmeta"><span class="badge' + badgeCls + '">' + esc(q.t) + '</span><span class="muted tiny">' + esc(q.m) + '</span>' +
        (q.t === '多选' ? '<span class="muted tiny">· 多选，全部选对才得分</span>' : '') + '</div>' +
        '<div class="stem">' + esc(q.q) + '</div>' +
        opts + verdict + explain +
      '</div>' +
      '<div style="height:90px"></div>' +
      '<div class="footer-fixed">' + bottom + '</div>';

    setHeader(quiz.title || '练习', quiz.mode === 'exam' ? '不显示对错' : '即时解析', true);
    updateTabVisible(false);
  }

  function isAnswer(q, i) {
    if (q.t === '多选') return q.a.indexOf(i) >= 0;
    return q.a === i;
  }
  function isCorrect(q, sel) {
    if (!sel || !sel.length) return false;
    if (q.t === '多选') {
      if (sel.length !== q.a.length) return false;
      var sorted = sel.slice().sort();
      var target = q.a.slice().sort();
      for (var i = 0; i < target.length; i++) { if (sorted[i] !== target[i]) return false; }
      return true;
    }
    return sel[0] === q.a;
  }
  function answerText(q) {
    if (q.t === '多选') {
      var ks = [];
      for (var i = 0; i < q.a.length; i++) ks.push(LETTERS[q.a[i]]);
      return ks.join('、');
    }
    if (q.t === '判断') return q.a === 0 ? '正确' : '错误';
    return LETTERS[q.a];
  }

  function pickOpt(i) {
    var q = byId(quiz.ids[quiz.idx]);
    if (quiz.mode === 'practice' && quiz.judged[q.id]) return;
    var sel = quiz.answers[q.id] || [];
    if (q.t === '多选') {
      var pos = sel.indexOf(i);
      if (pos >= 0) sel.splice(pos, 1); else sel.push(i);
    } else {
      sel = [i];
    }
    quiz.answers[q.id] = sel;

    if (quiz.mode === 'practice' && q.t !== '多选') {
      judgeNow();
    } else {
      saveQuiz();
      renderQuiz();
    }
  }

  function judgeNow() {
    var q = byId(quiz.ids[quiz.idx]);
    var sel = quiz.answers[q.id] || [];
    if (!sel.length) return;
    quiz.judged[q.id] = true;
    recordAnswer(q, sel, true);
    saveQuiz();
    renderQuiz();
  }

  function recordAnswer(q, sel, immediate) {
    var ok = isCorrect(q, sel);
    var prev = db.ans[q.id];
    db.ans[q.id] = { ok: ok, n: (prev ? prev.n : 0) + 1 };
    db.totalDone = (db.totalDone || 0) + 1;
    if (db.today !== todayKey()) { db.today = todayKey(); db.todayN = 0; }
    db.todayN = (db.todayN || 0) + 1;
    if (!ok) {
      var w = db.wrong[q.id] || { n: 0, ok: 0 };
      w.n = (w.n || 0) + 1;
      w.ok = 0;
      w.t = Date.now();
      db.wrong[q.id] = w;
    } else if (db.wrong[q.id]) {
      var w2 = db.wrong[q.id];
      w2.ok = (w2.ok || 0) + 1;
      if (w2.ok >= 2) { delete db.wrong[q.id]; }
      else { w2.t = Date.now(); db.wrong[q.id] = w2; }
    }
    save();
  }

  function nextQ() {
    if (quiz.idx >= quiz.ids.length - 1) {
      finishPractice();
      return;
    }
    quiz.idx++;
    saveQuiz();
    renderQuiz();
  }

  function finishPractice() {
    var right = 0, wrong = 0;
    for (var i = 0; i < quiz.ids.length; i++) {
      var id = quiz.ids[i], q = byId(id), sel = quiz.answers[id];
      if (sel && isCorrect(q, sel)) right++; else wrong++;
    }
    var total = quiz.ids.length;
    var res = { total: total, right: right, wrong: wrong, rate: pct(right, total), mode: 'practice' };
    stopTimer();
    quiz = null;
    db.quiz = null;
    save();
    nav.screen = 'result';
    renderResult(res);
  }

  function submitExam(auto) {
    var p = PAPERS[quiz.paper] || PAPERS.p190;
    var right = 0;
    var scoreSum = 0;
    var wrongIds = [];
    for (var i = 0; i < quiz.ids.length; i++) {
      var id = quiz.ids[i], q = byId(id), sel = quiz.answers[id];
      var pt = q.t === '判断' ? p.jp : (q.t === '单选' ? p.sp : p.mp);
      var ok = sel && isCorrect(q, sel);
      if (ok) { right++; scoreSum += pt; } else {
        wrongIds.push(id);
        if (!sel) { // 未作答也计错并进错题本
          var w = db.wrong[id] || { n: 0 };
          w.n = w.n + 1; w.t = Date.now();
          db.wrong[id] = w;
        }
      }
      if (sel) recordAnswer(q, sel, false);
    }
    var total = quiz.ids.length;
    var score = Math.round(scoreSum);
    var rec = {
      t: new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
      total: total, right: right, score: score, wrongList: wrongIds, paper: quiz.paper || 'p190'
    };
    db.exams.push(rec);
    save();
    stopTimer();
    var mode = auto ? 'exam-auto' : 'exam';
    quiz = null;
    db.quiz = null;
    save();
    nav.screen = 'result';
    renderResult({ total: total, right: right, wrong: total - right, rate: score, mode: mode, rec: rec });
  }

  function renderResult(res) {
    var titleText = res.mode === 'practice' ? '练习完成' : (res.mode === 'exam-auto' ? '时间到，已自动交卷' : '交卷完成');
    var color = res.rate >= 80 ? 'var(--ok)' : (res.rate >= 60 ? 'var(--accent)' : 'var(--bad)');
    $view.innerHTML =
      '<div class="card" style="margin-top:16px;text-align:center;padding:28px 18px">' +
        '<div class="muted small">' + titleText + '</div>' +
        '<div style="font-size:46px;font-weight:800;line-height:1.1;color:' + color + ';margin:10px 0 2px">' + res.rate + '</div>' +
        '<div class="muted">' + (res.mode === 'practice' ? '正确率 %' : '得分 / 100') + '</div>' +
        '<div class="row" style="justify-content:center;gap:26px;margin-top:20px">' +
          '<div><div class="muted tiny">答对</div><div style="font-weight:700">' + res.right + '</div></div>' +
          '<div><div class="muted tiny">答错</div><div style="font-weight:700;color:var(--bad)">' + res.wrong + '</div></div>' +
          '<div><div class="muted tiny">总题</div><div style="font-weight:700">' + res.total + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card flat">' +
        '<div class="h2">下一步</div>' +
        '<div class="muted" style="font-size:13px;line-height:1.7">' +
          (res.rate >= 85 ? '这一组已经很稳，换一个模块或直接做整套模考。'
            : res.rate >= 60 ? '把本组错题重做一遍，再回看对应章节的考点。'
            : '先别刷新题，回到考点精讲手册对应章节，把错题解析逐条看懂。') +
        '</div>' +
      '</div>' +
      '<button class="btn" data-act="again">再来一组（同条件）</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn ghost" data-act="go-wrong">去错题本</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn line" data-act="go-home">回到学习页</button>';
    setHeader('结果', '继续加油', true);
    updateTabVisible(true);
  }

  function updateTabVisible(show) {
    $tabbar.style.display = show ? 'flex' : 'none';
  }

  // ---------- 事件 ----------
  var lastPracticeIds = null;

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) {
      var tab = e.target.closest ? e.target.closest('.tab') : null;
      if (tab) { goTab(tab.getAttribute('data-tab')); }
      return;
    }
    var act = btn.getAttribute('data-act');
    var v = btn.getAttribute('data-v');

    if (act === 'go-back') { backAction(); return; }
    if (act === 'practice') { goTab('practice'); return; }
    if (act === 'exam') { goTab('exam'); return; }
    if (act === 'wrong') { goTab('wrong'); return; }
    if (act === 'stats') { nav.screen = 'tab'; goTab('stats'); return; }
    if (act === 'go-home') { nav.screen = 'tab'; goTab('home'); return; }
    if (act === 'go-wrong') { goTab('wrong'); return; }

    if (act === 'open-mod') { openMod(btn.getAttribute('data-mod')); return; }
    if (act === 'open-card') { openCard(btn.getAttribute('data-card')); return; }
    if (act === 'learn-continue') { learnContinue(); return; }
    if (act === 'learn-next') { learnNext(); return; }
    if (act === 'learn-prev') { learnPrev(); return; }
    if (act === 'reveal-ans') { revealAns(btn); return; }
    if (act === 'drill-mod') { drillMod(btn.getAttribute('data-mod')); return; }
    if (act === 'drill-k') {
      var dk = btn.getAttribute('data-k');
      var kIds = bankIdsByK(dk, 10);
      if (!kIds.length) { showToast('本模块暂无题目'); return; }
      var kName = { jichu: '职业与基础', yewu: '业务分析', xunlian: '智能训练', sheji: '智能系统设计', yunwei: '运维与测试', peixun: '培训与指导' }[dk] || '本模块';
      startQuiz({ ids: kIds, mode: 'practice', title: kName + ' · 10 题' });
      return;
    }

    if (act === 'pick-mod') { practiceSel.mod = v; renderPractice(); return; }
    if (act === 'pick-type') { practiceSel.type = v; renderPractice(); return; }
    if (act === 'pick-order') { practiceSel.order = v; renderPractice(); return; }
    if (act === 'pick-paper') { db.paper = v; save(); renderExam(); return; }

    if (act === 'resume-quiz') { resumeQuiz(); return; }
    if (act === 'drop-quiz') {
      showConfirm('放弃这次练习', '已作答的记录和错题不会删除，只是不再续做。确定？', function () {
        db.quiz = null; save();
        if (nav.tab === 'exam') renderExam(); else renderPractice();
      });
      return;
    }
    if (act === 'start-practice') {
      lastPracticeIds = filterIds();
      if (!lastPracticeIds.length) return;
      startQuiz({ ids: lastPracticeIds, mode: 'practice', title: '专项练习' });
      return;
    }
    if (act === 'start-rec') {
      var rec = recommend();
      if (!rec || !rec.count) return;
      lastPracticeIds = rec.ids;
      startQuiz({ ids: rec.ids, mode: 'practice', title: '今日推荐' });
      return;
    }
    if (act === 'start-exam') {
      var ids = buildExamSet(db.paper);
      startQuiz({ ids: ids, mode: 'exam', title: '模拟考试', limit: 90 * 60, paper: db.paper });
      return;
    }
    if (act === 'start-wrong') {
      var wids = wrongIdsSorted();
      if (!wids.length) return;
      startQuiz({ ids: wids, mode: 'practice', title: '错题重做' });
      return;
    }
    if (act === 'start-hard') {
      var hard = wrongIdsSorted().filter(function (id) { return (db.wrong[id].n || 1) >= 2; });
      if (!hard.length) return;
      startQuiz({ ids: hard, mode: 'practice', title: '顽固错题' });
      return;
    }
    if (act === 'repair') {
      var rid = parseInt(btn.getAttribute('data-id'), 10);
      if (!byId(rid)) return;
      startQuiz({ ids: [rid], mode: 'practice', title: '错题复习' });
      return;
    }
    if (act === 'pick-opt') { pickOpt(parseInt(btn.getAttribute('data-i'), 10)); return; }
    if (act === 'judge') { judgeNow(); return; }
    if (act === 'next-q') { nextQ(); return; }
    if (act === 'prev-q') { quiz.idx = Math.max(0, quiz.idx - 1); saveQuiz(); renderQuiz(); return; }
    if (act === 'submit-exam') {
      var unanswered = 0;
      for (var i = 0; i < quiz.ids.length; i++) { if (!quiz.answers[quiz.ids[i]]) unanswered++; }
      showConfirm('交卷确认', '还有 ' + unanswered + ' 题未作答，未答按错计。确定交卷？', function () { submitExam(false); });
      return;
    }
    if (act === 'again') {
      if (lastPracticeIds && lastPracticeIds.length) {
        startQuiz({ ids: lastPracticeIds, mode: 'practice', title: '专项练习' });
      } else {
        goTab('practice');
      }
      return;
    }
    if (act === 'save-date') {
      var inp = document.getElementById('examDate');
      db.examDate = inp ? inp.value : '';
      save();
      setHeader('我的', daysLeft() === null ? '未设置考试日期' : '距考试 ' + daysLeft() + ' 天');
      showToast('已保存');
      return;
    }
    if (act === 'clear-wrong') {
      showConfirm('清空错题本', '将删除全部错题记录，此操作不可恢复。', function () {
        db.wrong = {}; save(); renderWrong();
      });
      return;
    }
    if (act === 'reset-all') {
      showConfirm('清空全部记录', '将删除作答记录、错题、收藏和模考历史。', function () {
        localStorage.removeItem(STORE_KEY);
        db = { ans: {}, wrong: {}, fav: {}, exams: [], examDate: '', totalDone: 0, learn: {}, paper: 'p190' };
        save();
        goTab('learn');
      });
      return;
    }
  });

  function backAction() {
    if (nav.screen === 'card') {
      if (learnNav.mod) { renderLearnMod(learnNav.mod); } else { goTab('learn'); }
      return;
    }
    if (nav.screen === 'modlist') { goTab('learn'); return; }
    if (nav.screen === 'quiz') {
      showConfirm('退出练习', '当前作答不会保存进度，确定退出？', function () {
        stopTimer(); quiz = null; nav.screen = 'tab'; goTab('learn');
      });
    } else {
      nav.screen = 'tab';
      goTab('learn');
    }
  }

  // 返回按钮走统一事件委托（data-act="go-back"），此处不再重复绑定

  // 简易确认弹层（WebView 不弹原生对话框）
  function showConfirm(title, msg, cb) {
    var mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = '<div class="sheet"><h3>' + esc(title) + '</h3><div class="sub">' + esc(msg) + '</div>' +
      '<div class="row"><button class="btn line" data-c="0">取消</button><button class="btn" data-c="1">确定</button></div></div>';
    document.body.appendChild(mask);
    setTimeout(function () { mask.className = 'sheet-mask show'; }, 20);
    mask.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-c]');
      if (b) {
        var ok = b.getAttribute('data-c') === '1';
        document.body.removeChild(mask);
        if (ok && cb) cb();
      } else if (ev.target === mask) {
        document.body.removeChild(mask);
      }
    });
  }

  function showToast(text) {
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);' +
      'background:rgba(20,28,45,.92);color:#fff;padding:9px 18px;border-radius:999px;font-size:13px;z-index:60;';
    document.body.appendChild(t);
    setTimeout(function () { document.body.removeChild(t); }, 1600);
  }

  function goTab(tab) {
    stopTimer();
    flushJudge();
    quiz = null;
    if (tab === 'home') tab = 'learn';
    nav.tab = tab;
    setTabs(tab);
    updateTabVisible(true);
    if (tab === 'learn') renderLearn();
    else if (tab === 'practice') renderPractice();
    else if (tab === 'exam') renderExam();
    else if (tab === 'wrong') renderWrong();
    else if (tab === 'stats') renderStats();
    else if (tab === 'me') renderMe();
    $view.scrollTop = 0;
  }

  $view.addEventListener('scroll', function () {
    if ($view.scrollTop > 6) $topbar.classList.add('scrolled');
    else $topbar.classList.remove('scrolled');
  });

  window.addEventListener('resize', function () {});

  // 启动
  goTab('learn');
})();
