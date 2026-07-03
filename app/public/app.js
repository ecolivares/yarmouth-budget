/* Yarmouth Budget Explorer — front-end.
   Renders the embedded dataset (window.YB_DATA): a multi-year "budget at a glance"
   view, an interactive cut-builder, and a chat against the /api/chat proxy. */
(function () {
  "use strict";
  var D = window.YB_DATA;
  if (!D) { console.error("YB_DATA missing"); return; }

  window.__YB_ACCESS = (function () {
    try {
      var u = new URLSearchParams(location.search).get("access");
      if (u) { localStorage.setItem("yb_access", u); return u; }
      return localStorage.getItem("yb_access") || undefined;
    } catch (e) { return undefined; }
  })();

  var S = D.summary, M = D.mechanics, B = D.builder, A = B.anchor;
  var BASE = M.taxBaseFY27;
  var YEARS = ["2024", "2025", "2026", "2027"];
  var FYLAB = { "2024": "FY24", "2025": "FY25", "2026": "FY26", "2027": "FY27" };

  // ---------- formatting ----------
  function usd(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
    return "$" + Math.round(n);
  }
  function usdFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pct(n) { return (n * 100).toFixed(1) + "%"; }
  function signed(n) { return (n >= 0 ? "+" : "−") + usd(Math.abs(n)); }

  // ---------- tabs ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var panels = { overview: document.getElementById("panel-overview"), build: document.getElementById("panel-build") };
  function showTab(name) {
    tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    Object.keys(panels).forEach(function (k) { panels[k].classList.toggle("active", k === name); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.tab); }); });

  // ---------- summary strip (FY2026 — the budget residents are paying now) ----------
  var f26 = "2026";
  var gf26 = S.totalGF[f26];
  var levyCAGR = Math.pow(S.netLevy["2027"] / S.netLevy["2024"], 1 / 3) - 1;
  var bill26 = Math.round(S.rate[f26] * M.home / 1000);
  var stats = [
    { val: usd(gf26), label: "FY2026 General Fund", sub: "town + school spending", accent: true },
    { val: pct(S.education[f26] / gf26), label: "goes to schools", sub: usd(S.education[f26]) },
    { val: "$" + S.rate[f26], label: "FY2026 mill rate", sub: usdFull(bill26) + " on a $500k home" },
    { val: "+" + pct(levyCAGR), label: "tax levy growth / yr", sub: "FY24 → FY27" }
  ];
  document.getElementById("statRow").innerHTML = stats.map(function (s) {
    return '<div class="stat' + (s.accent ? ' accent' : '') + '"><div class="val">' + s.val +
      '</div><div class="label">' + s.label + '</div><div class="sub">' + s.sub + '</div></div>';
  }).join("");

  // =================== BUDGET AT A GLANCE ===================
  var CATS = [
    { key: "edu", name: "Schools", ser: S.education, cls: "edu" },
    { key: "muni", name: "Town", ser: S.municipal, cls: "muni" },
    { key: "county", name: "County", ser: S.county, cls: "county" }
  ];
  var maxTotal = Math.max.apply(null, YEARS.map(function (y) { return S.totalGF[y]; }));

  // --- stacked bars per year + legend ---
  var legend = CATS.map(function (c) {
    return '<span><i class="swatch ' + c.cls + '"></i>' + c.name + " — " + usd(c.ser["2027"]) + " in FY27</span>";
  }).join("");
  var rows = YEARS.map(function (y) {
    var tot = S.totalGF[y];
    var segs = CATS.map(function (c) {
      var share = c.ser[y] / tot * 100;
      return '<span class="ys-seg ' + c.cls + '" style="width:' + share + '%" title="' + c.name + " " +
        FYLAB[y] + ": " + usd(c.ser[y]) + '"></span>';
    }).join("");
    return '<div class="ys-row"><span class="ys-year">' + FYLAB[y] + '</span>' +
      '<span class="ys-track"><span class="ys-bar" style="width:' + (tot / maxTotal * 100) + '%">' + segs + '</span></span>' +
      '<span class="ys-total">' + usd(tot) + '</span></div>';
  }).join("");
  document.getElementById("yearStack").innerHTML =
    '<div class="comp-legend">' + legend + '</div><div class="ystack">' + rows + '</div>';

  // --- what changed each year (matrix) ---
  var transitions = [["2024", "2025"], ["2025", "2026"], ["2026", "2027"]];
  var mHead = '<div class="cm-row cm-head"><span class="cm-cat"></span>' +
    transitions.map(function (t) { return '<span class="cm-cell">' + FYLAB[t[0]] + "→" + FYLAB[t[1]] + '</span>'; }).join("") + '</div>';
  var mRows = CATS.concat([{ key: "total", name: "Total budget", ser: S.totalGF, cls: "total" }]).map(function (c) {
    var cells = transitions.map(function (t) {
      var d = c.ser[t[1]] - c.ser[t[0]];
      var p = d / c.ser[t[0]] * 100;
      return '<span class="cm-cell"><b>' + signed(d) + '</b><span class="cm-pct">' + (p >= 0 ? "+" : "") + p.toFixed(1) + '%</span></span>';
    }).join("");
    var sw = c.cls === "total" ? "" : '<i class="swatch ' + c.cls + '"></i>';
    return '<div class="cm-row' + (c.cls === "total" ? " cm-total" : "") + '"><span class="cm-cat">' + sw + c.name + '</span>' + cells + '</div>';
  }).join("");
  document.getElementById("changeMatrix").innerHTML = '<div class="cmatrix">' + mHead + mRows + '</div>';

  // --- levy trend (single series, one axis) ---
  var maxLevy = Math.max.apply(null, YEARS.map(function (y) { return S.netLevy[y]; }));
  document.getElementById("levyTrend").innerHTML = '<div class="ystack levy">' + YEARS.map(function (y, i) {
    var v = S.netLevy[y];
    var yo = i > 0 ? (v / S.netLevy[YEARS[i - 1]] - 1) : null;
    return '<div class="ys-row"><span class="ys-year">' + FYLAB[y] + '</span>' +
      '<span class="ys-track"><span class="ys-bar levy" style="width:' + (v / maxLevy * 100) + '%"></span></span>' +
      '<span class="ys-total">' + usd(v) + (yo !== null ? ' <span class="ys-yo">+' + (yo * 100).toFixed(1) + '%</span>' : '') + '</span></div>';
  }).join("") + '</div>';

  // --- rate row (labeled, NOT co-plotted — the reval makes a shared axis misleading) ---
  document.getElementById("rateRow").innerHTML =
    '<div class="raterow"><span class="rr-label">Mill rate $/$1,000</span>' +
    YEARS.map(function (y, i) {
      var reval = (y === "2026") ? ' <span class="rr-reval">↓ revaluation</span>' : "";
      return '<span class="rr-item"><b>$' + S.rate[y] + '</b><span class="rr-yr">' + FYLAB[y] + reval + '</span></span>';
    }).join("") + '</div>';

  // --- where the growth is coming from (FY24→FY27 change) ---
  var growth = [{ name: "Schools (whole budget)", d: S.education["2027"] - S.education["2024"], hero: true }]
    .concat(D.categories.map(function (c) { return { name: c.name, d: c.fy27 - c.fy24 }; }));
  var maxG = Math.max.apply(null, growth.map(function (g) { return g.d; }));
  document.getElementById("growthAreas").innerHTML = '<div class="bars">' + growth.map(function (g) {
    return '<div class="bar-row' + (g.hero ? " hero" : "") + '"><span class="bname" title="' + g.name + '">' + g.name + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + Math.max(2, g.d / maxG * 100) + '%;background:var(' + (g.hero ? "--edu" : "--muni") + ')"></span></span>' +
      '<span class="bval">+' + usd(g.d) + '</span></div>';
  }).join("") + '</div>';

  // =================== BUILD YOUR OWN CUTS ===================
  var GROUPS = [
    { key: "small", title: "The stuff people assume is “the waste”", sub: "small discretionary lines & subsidies" },
    { key: "amenity", title: "Amenities & services", sub: "visible programs residents actually use" },
    { key: "lever", title: "Pay & one-time moves", sub: "bigger levers — a raise freeze, deferring capital, spending savings" }
  ];
  function feasClass(f) {
    f = (f || "").toLowerCase();
    if (f.indexOf("verify") >= 0) return "verify";
    if (f.indexOf("caution") >= 0 || f.indexOf("constrained") >= 0 || f.indexOf("bargain") >= 0) return "caution";
    return "ok";
  }

  var bState = { school: 0, town: 0, homeValue: M.home };
  function factor() { return bState.homeValue / BASE; }
  function homeFor(dollars) { return Math.round(dollars * factor()); }

  document.getElementById("builderIntro").innerHTML =
    "We're working on the <strong>FY2027 budget</strong> — the one still up for debate. " +
    "Check the cuts you'd make and drag the staffing sliders, then watch the impact on the budget, the tax rate, " +
    "and your bill. Everything updates instantly, nothing is sent anywhere, and it costs nothing.";

  document.getElementById("builderDisclaimer").innerHTML =
    B.staffing.note + " Items are curated not to overlap, so the running total doesn't double-count. " +
    "One-time moves (★) lower one year's bill but return the next.";

  // ---- build controls ----
  var body = document.getElementById("builderBody");
  var html = "";
  GROUPS.forEach(function (g) {
    var opts = B.options.filter(function (o) { return o.group === g.key; });
    html += '<div class="bgroup"><div class="bgroup-head"><span class="bg-titles"><span class="bg-title">' + g.title +
      '</span><span class="bg-sub">' + g.sub + '</span></span><span class="bg-savings">saves&nbsp;/&nbsp;yr</span></div>';
    opts.forEach(function (o) {
      html += '<label class="opt"><input type="checkbox" class="opt-cb" data-annual="' + o.annual +
        '" data-onetime="' + (o.oneTime ? 1 : 0) + '" data-label="' + o.label.replace(/"/g, "&quot;") +
        '" data-cost="' + o.cost.replace(/"/g, "&quot;") + '">' +
        '<span class="opt-main"><span class="opt-label">' + o.label +
        (o.oneTime ? ' <span class="once">★ one-time</span>' : '') +
        ' <span class="badge ' + feasClass(o.feasibility) + '">' + o.feasibility + '</span></span>' +
        '<span class="opt-cost">' + o.cost + '</span></span>' +
        '<span class="opt-home" data-annual="' + o.annual + '">−' + usdFull(homeFor(o.annual)) + '</span></label>';
    });
    html += '</div>';
  });
  // staffing levers
  html += '<div class="bgroup levers"><div class="bgroup-head"><span class="bg-titles">' +
    '<span class="bg-title">The real levers — staffing</span>' +
    '<span class="bg-sub">where the big money actually is (~83% of schools is people)</span></span>' +
    '<span class="bg-savings">saves&nbsp;/&nbsp;yr</span></div>' +
    '<p class="lever-impact">This is where cuts get real. About <strong>' + usdFull(B.staffing.perPosition) +
    '</strong> ≈ one position, so ~$1M is roughly a dozen staff. For scale, a dozen teaching cuts across a ' +
    'district Yarmouth\'s size can push <strong>average class sizes up by 2–4 students</strong> and end ' +
    'electives, reading support, or special-ed aides — the exact effect depends on grade and school. ' +
    '<span class="fine-inline">(Illustrative estimate — the dataset has payroll totals, not headcount.)</span></p>';
  html += sliderHTML("school", B.staffing.school);
  html += sliderHTML("town", B.staffing.town);
  html += '</div>';
  body.innerHTML = html;

  function sliderHTML(key, cfg) {
    return '<div class="slider"><div class="slider-top"><span class="opt-label">' + cfg.label +
      '</span><span class="slider-val" id="val-' + key + '">0 positions · −$0</span></div>' +
      '<input type="range" class="staff-range" id="range-' + key + '" data-key="' + key +
      '" min="0" max="' + cfg.maxPositions + '" value="0">' +
      '<span class="opt-cost">' + cfg.cost + '</span></div>';
  }

  var readout = document.getElementById("readout");
  var cutlist = document.getElementById("cutlist");

  function anchorBills() {
    var b26 = Math.round(S.rate["2026"] * bState.homeValue / 1000);
    var b27 = Math.round(S.rate["2027"] * bState.homeValue / 1000);
    return { b26: b26, b27: b27, inc: b27 - b26 };
  }
  function recompute() {
    var recD = 0, oneD = 0, picked = [];
    document.querySelectorAll(".opt-cb").forEach(function (cb) {
      if (!cb.checked) return;
      var annual = +cb.dataset.annual, one = cb.dataset.onetime === "1";
      if (one) oneD += annual; else recD += annual;
      picked.push({ label: cb.dataset.label, annual: annual, one: one, cost: cb.dataset.cost });
    });
    ["school", "town"].forEach(function (key) {
      var n = bState[key];
      if (n > 0) {
        var d = n * B.staffing.perPosition; recD += d;
        picked.push({ label: B.staffing[key].label + " — " + n + " position" + (n > 1 ? "s" : ""),
          annual: d, one: false, cost: B.staffing[key].cost });
      }
    });

    var totalD = recD + oneD;
    var recHome = recD * factor(), oneHome = oneD * factor(), totalHome = recHome + oneHome;
    var bills = anchorBills();
    var newBill = bills.b27 - totalHome;
    var vs26 = newBill - bills.b26;

    readout.innerHTML =
      '<div class="ro-context">This year (FY26): <strong>' + usdFull(bills.b26) + '</strong> · ' +
        'FY2027 draft: <strong>' + usdFull(bills.b27) + '</strong> <span class="ro-inc">(+' + usdFull(bills.inc) + ')</span></div>' +
      '<div class="ro-top">' +
        '<div class="ro-bill"><span class="ro-num">' + usdFull(Math.round(newBill)) + '</span>' +
          '<span class="ro-cap">your projected FY27 bill after these cuts</span></div>' +
        '<div class="ro-stats">' +
          '<div><b class="save">−' + usdFull(Math.round(totalHome)) + '</b><span>off your bill</span></div>' +
          '<div><b>' + usd(totalD) + '</b><span>cut from budget</span></div>' +
          '<div><b class="' + (vs26 > 0 ? "" : "save") + '">' + (vs26 >= 0 ? "+" : "−") + usdFull(Math.abs(Math.round(vs26))) +
            '</b><span>vs this year</span></div>' +
        '</div></div>' +
      billBar(newBill, bills) +
      (oneHome > 0.5
        ? '<div class="ro-note">⚠️ ' + usdFull(Math.round(oneHome)) + ' of this is <strong>one-time</strong> ' +
          '(deferrals / surplus) and returns next year. Recurring cut: −' + usdFull(Math.round(recHome)) + '.</div>'
        : "");

    if (!picked.length) {
      cutlist.innerHTML = '<div class="cut-empty">Nothing cut yet. Start checking boxes above — notice how far the ' +
        '“easy” stuff gets you before you have to touch teachers, police, or fire.</div>';
    } else {
      picked.forEach(function (p) { p.home = homeFor(p.annual); });
      picked.sort(function (a, b) { return b.home - a.home; });
      cutlist.innerHTML = '<div class="cut-head">What you\'re cutting — and what it costs</div>' +
        picked.map(function (p) {
          return '<div class="cut-item"><span class="ci-home">−$' + p.home + '</span>' +
            '<span class="ci-body"><span class="ci-label">' + p.label + (p.one ? ' <span class="once">★</span>' : '') +
            '</span><span class="ci-cost">' + p.cost + '</span></span></div>';
        }).join("");
    }
  }

  function billBar(newBill, bills) {
    var lo = Math.round(bills.b27 * 0.74), hi = bills.b27 + Math.round(bills.b27 * 0.015);
    function pos(x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); }
    var youP = pos(newBill), draftP = pos(bills.b27), todayP = pos(bills.b26);
    return '<div class="bar-wrap"><div class="bill-bar">' +
      '<div class="bb-fill" style="left:' + youP + '%;width:' + Math.max(0, draftP - youP) + '%"></div>' +
      '<div class="bb-ref today" style="left:' + todayP + '%"><span>this year<br>' + usdFull(bills.b26) + '</span></div>' +
      '<div class="bb-ref draft" style="left:' + draftP + '%"><span>draft<br>' + usdFull(bills.b27) + '</span></div>' +
      '<div class="bb-you" style="left:' + youP + '%"><span class="bb-youlab">' + usdFull(Math.round(newBill)) + '</span></div>' +
      '</div><div class="bar-cap">Your projected bill (the dot) slides left as you cut. The dashed marks are fixed reference points — they\'re not draggable.</div></div>';
  }

  // ---- home value input ----
  var homeInput = document.getElementById("homeValue");
  function refreshHomeLabels() {
    document.querySelectorAll(".opt-home").forEach(function (el) {
      el.textContent = "−" + usdFull(homeFor(+el.dataset.annual));
    });
    ["school", "town"].forEach(function (key) {
      var n = bState[key], d = n * B.staffing.perPosition;
      document.getElementById("val-" + key).textContent =
        n + " position" + (n === 1 ? "" : "s") + " · −" + usdFull(homeFor(d));
    });
  }
  function parseHome(str) { var n = parseInt((str || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; }
  homeInput.addEventListener("input", function () {
    var n = parseHome(homeInput.value);
    bState.homeValue = n > 0 ? n : M.home;
    refreshHomeLabels(); recompute();
  });
  homeInput.addEventListener("blur", function () {
    var n = parseHome(homeInput.value);
    homeInput.value = (n > 0 ? n : M.home).toLocaleString("en-US");
    bState.homeValue = n > 0 ? n : M.home;
    refreshHomeLabels(); recompute();
  });

  // ---- wiring ----
  body.addEventListener("change", function (e) { if (e.target.classList.contains("opt-cb")) recompute(); });
  body.addEventListener("input", function (e) {
    if (!e.target.classList.contains("staff-range")) return;
    var key = e.target.dataset.key; bState[key] = +e.target.value;
    var d = bState[key] * B.staffing.perPosition;
    document.getElementById("val-" + key).textContent =
      bState[key] + " position" + (bState[key] === 1 ? "" : "s") + " · −" + usdFull(homeFor(d));
    recompute();
  });

  recompute();

  // =================== CHAT ===================
  var chatWindow = document.getElementById("chatWindow");
  var form = document.getElementById("chatForm");
  var textEl = document.getElementById("chatText");
  var sendBtn = document.getElementById("sendBtn");
  var chatHistory = [];

  document.getElementById("introBubble").innerHTML =
    "Hi — ask me anything about the Yarmouth budget or a tax-cut idea, and I'll answer with the real numbers. " +
    "For example: <em>“how much would cutting $2 million save my house?”</em> or " +
    "<em>“why did the budget go up so much?”</em><br><br>Type your question below to start.";

  textEl.addEventListener("input", function () {
    textEl.style.height = "auto"; textEl.style.height = Math.min(textEl.scrollHeight, 160) + "px";
  });
  textEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });

  function addMsg(role, initial) {
    var wrap = document.createElement("div"); wrap.className = "msg " + role;
    var b = document.createElement("div"); b.className = "bubble";
    if (initial) b.innerHTML = initial;
    wrap.appendChild(b); chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight; return b;
  }
  function render(text) {
    var esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    esc = esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
    return esc;
  }

  var busy = false;
  function submit() {
    if (busy) return;
    var q = textEl.value.trim(); if (!q) return;
    addMsg("user", render(q)); chatHistory.push({ role: "user", content: q });
    textEl.value = ""; textEl.style.height = "auto"; stream();
  }

  function stream() {
    busy = true; sendBtn.disabled = true;
    var bubble = addMsg("assistant", '<span class="thinking dot-flash">Thinking</span>');
    var full = "";
    fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: chatHistory, access: window.__YB_ACCESS || undefined })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          if (res.status === 403 && (t || "").toLowerCase().indexOf("access") >= 0) {
            var w = window.prompt("This tool needs an access word (ask the town for it):", "");
            if (w) {
              try { localStorage.setItem("yb_access", w.trim()); } catch (e) {}
              window.__YB_ACCESS = w.trim();
              busy = false; sendBtn.disabled = false;
              chatWindow.removeChild(bubble.parentNode); stream(); return;
            }
          }
          throw new Error(friendlyError(res.status, t));
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n"); buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (!line || line.indexOf("data:") !== 0) return;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              var ev = JSON.parse(payload);
              if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
                full += ev.delta.text;
                bubble.classList.remove("thinking", "dot-flash");
                bubble.innerHTML = render(full);
                chatWindow.scrollTop = chatWindow.scrollHeight;
              } else if (ev.type === "error") {
                throw new Error(ev.error && ev.error.message || "stream error");
              }
            } catch (err) { /* ignore keep-alive / partial */ }
          });
          return pump();
        });
      }
      function finish() {
        if (!full) bubble.innerHTML = render("(No response.)");
        chatHistory.push({ role: "assistant", content: full || "" }); done();
      }
      return pump();
    }).catch(function (err) {
      bubble.classList.remove("thinking", "dot-flash");
      bubble.innerHTML = render("⚠️ " + err.message); done();
    });
  }
  function friendlyError(status, body) {
    if (status === 429) return "The tool is busy right now (rate limit). Please wait a minute and try again.";
    if (status === 401 || status === 403) {
      if ((body || "").toLowerCase().indexOf("access") >= 0) return "This tool needs an access word. Ask the town for it, then reload.";
      return "The tool isn't configured correctly (auth). Please let the site owner know.";
    }
    if (status >= 500) return "The budget assistant is temporarily unavailable. Please try again shortly.";
    return "Something went wrong (" + status + "). Please try again.";
  }
  function done() { busy = false; sendBtn.disabled = false; textEl.focus(); }
})();
