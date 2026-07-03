/* Yarmouth Budget Explorer — front-end.
   Renders the embedded dataset (window.YB_DATA), drives tabs + the scenario
   explorer, and runs the chat against the same-origin /api/chat proxy. */
(function () {
  "use strict";
  var D = window.YB_DATA;
  if (!D) { console.error("YB_DATA missing"); return; }

  // access word (only used if the server sets ACCESS_WORD): from ?access= or saved
  window.__YB_ACCESS = (function () {
    try {
      var u = new URLSearchParams(location.search).get("access");
      if (u) { localStorage.setItem("yb_access", u); return u; }
      return localStorage.getItem("yb_access") || undefined;
    } catch (e) { return undefined; }
  })();

  var S = D.summary, M = D.mechanics;

  // ---------- formatting ----------
  function usd(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
    return "$" + Math.round(n);
  }
  function usdFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pct(n) { return (n * 100).toFixed(1) + "%"; }

  // ---------- tabs ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var panels = {
    overview: document.getElementById("panel-overview"),
    scenarios: document.getElementById("panel-scenarios"),
    chat: document.getElementById("panel-chat")
  };
  function showTab(name) {
    tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    Object.keys(panels).forEach(function (k) { panels[k].classList.toggle("active", k === name); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.tab); }); });

  // ---------- hero stats ----------
  var fy27 = "2027", fy24 = "2024";
  var tot27 = S.totalGF[fy27];
  var levyCAGR = Math.pow(S.netLevy[fy27] / S.netLevy[fy24], 1 / 3) - 1;

  var stats = [
    { val: usd(tot27), label: "FY27 General Fund", sub: "town + school spending", accent: true },
    { val: pct(S.education[fy27] / tot27), label: "goes to schools", sub: usd(S.education[fy27]) },
    { val: "+" + pct(levyCAGR), label: "tax levy growth / yr", sub: "faster than spending" },
    { val: usdFull(M.homeBillFY27), label: "bill on a " + usd(M.home) + " home", sub: "at $" + M.rateFY27 + "/$1,000" }
  ];
  document.getElementById("statRow").innerHTML = stats.map(function (s) {
    return '<div class="stat' + (s.accent ? ' accent' : '') + '">' +
      '<div class="val">' + s.val + '</div>' +
      '<div class="label">' + s.label + '</div>' +
      '<div class="sub">' + s.sub + '</div></div>';
  }).join("");

  // ---------- overview: note + mechanics + composition ----------
  document.getElementById("heroNote").innerHTML =
    "From FY24 to FY27 the General Fund grew " + usd(tot27 - S.totalGF[fy24]) +
    " (" + pct(tot27 / S.totalGF[fy24] - 1) + "), but the property-tax levy grew faster — " +
    "non-tax revenue is covering a shrinking share, so a rising portion falls on property taxes.";

  document.getElementById("mechLead").innerHTML =
    "<p>The town's taxable value for FY27 is <strong>" + usdFull(M.taxBaseFY27) + "</strong> and the rate is " +
    "<strong>$" + M.rateFY27 + " per $1,000</strong>. That fixes a simple conversion you can apply to any cut:</p>" +
    '<span class="factor">Every <b>' + usd(1e6) + '</b> cut from the budget lowers the rate about ' +
    "<b>$" + M.ratePerMillion + "</b> per $1,000 — roughly <b>−" + usdFull(M.homePerMillion) +
    "/year</b> on a " + usd(M.home) + " home.</span>";

  document.getElementById("gfTotal").textContent = usdFull(tot27);

  var parts = [
    { key: "edu", name: "Education (schools)", v: S.education[fy27] },
    { key: "muni", name: "Municipal (town)", v: S.municipal[fy27] },
    { key: "county", name: "County tax", v: S.county[fy27] }
  ];
  document.getElementById("composition").innerHTML =
    '<div class="comp-bar">' + parts.map(function (p) {
      var w = (p.v / tot27 * 100);
      return '<div class="comp-seg ' + p.key + '" style="width:' + w + '%">' + (w > 8 ? pct(p.v / tot27) : "") + '</div>';
    }).join("") + '</div><div class="comp-legend">' + parts.map(function (p) {
      return '<span><i class="swatch ' + p.key + '"></i>' + p.name + " — " + usd(p.v) + " (" + pct(p.v / tot27) + ")</span>";
    }).join("") + '</div>';

  function renderBars(el, rows, colorVar, topN) {
    rows = rows.slice(0, topN);
    var max = Math.max.apply(null, rows.map(function (r) { return r.fy27; }));
    el.innerHTML = rows.map(function (r) {
      var w = (r.fy27 / max * 100);
      return '<div class="bar-row"><span class="bname" title="' + r.name + '">' + r.name + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + w + '%;background:var(' + colorVar + ')"></span></span>' +
        '<span class="bval">' + usd(r.fy27) + '</span></div>';
    }).join("");
  }
  renderBars(document.getElementById("schoolBars"), D.school, "--edu", 8);
  renderBars(document.getElementById("muniBars"), D.categories, "--muni", 6);

  // ============ BUILD YOUR OWN CUTS ============
  var B = D.builder, A = B.anchor;
  var perDollarHome = M.home / M.taxBaseFY27;         // $ off the home bill per $1 cut
  var perDollarRate = 1000 / M.taxBaseFY27;           // rate Δ per $1 cut

  function feasClass(f) {
    f = (f || "").toLowerCase();
    if (f.indexOf("verify") >= 0) return "verify";
    if (f.indexOf("caution") >= 0 || f.indexOf("constrained") >= 0 || f.indexOf("bargain") >= 0) return "caution";
    return "ok";
  }
  var GROUPS = [
    { key: "small", title: "The stuff people assume is “the waste”",
      sub: "small discretionary lines and subsidies" },
    { key: "amenity", title: "Amenities & services",
      sub: "visible programs residents actually use" },
    { key: "lever", title: "Pay & one-time moves",
      sub: "bigger levers — a raise freeze, deferring capital, spending savings" }
  ];

  var bState = { goal: "freeze", school: 0, town: 0 };

  document.getElementById("builderIntro").innerHTML =
    "The typical " + usd(M.home) + " home pays <strong>" + usdFull(A.fy26Bill) + "</strong> in property tax this year (FY26). " +
    "The draft FY27 budget raises that to <strong>" + usdFull(A.fy27Bill) + "</strong> — about <strong>+$" + A.increase + "</strong>. " +
    "Your job: cut the budget and watch your bill. Every toggle updates instantly — no cost, nothing sent anywhere.";

  document.getElementById("builderDisclaimer").innerHTML =
    B.staffing.note + " Items are curated not to overlap, so the running total doesn't double-count. " +
    "One-time moves (★) lower one year's bill but return the next.";

  // ---- build the controls ----
  var body = document.getElementById("builderBody");
  var html = "";
  GROUPS.forEach(function (g) {
    var opts = B.options.filter(function (o) { return o.group === g.key; });
    html += '<div class="bgroup"><div class="bgroup-head"><span class="bg-title">' + g.title +
      '</span><span class="bg-sub">' + g.sub + '</span></div>';
    opts.forEach(function (o) {
      html += '<label class="opt"><input type="checkbox" class="opt-cb" data-annual="' + o.annual +
        '" data-home="' + o.home + '" data-onetime="' + (o.oneTime ? 1 : 0) + '" data-label="' +
        o.label.replace(/"/g, "&quot;") + '" data-cost="' + o.cost.replace(/"/g, "&quot;") + '">' +
        '<span class="opt-main"><span class="opt-label">' + o.label +
        (o.oneTime ? ' <span class="once">★ one-time</span>' : '') +
        ' <span class="badge ' + feasClass(o.feasibility) + '">' + o.feasibility + '</span></span>' +
        '<span class="opt-cost">' + o.cost + '</span></span>' +
        '<span class="opt-home">−$' + o.home + '</span></label>';
    });
    html += '</div>';
  });

  // staffing sliders
  html += '<div class="bgroup levers"><div class="bgroup-head"><span class="bg-title">The real levers — staffing</span>' +
    '<span class="bg-sub">where the big money actually is (~83% of schools is people)</span></div>';
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

  // ---- recompute ----
  var readout = document.getElementById("readout");
  var cutlist = document.getElementById("cutlist");

  function goalReduction() {
    if (bState.goal === "freeze") return A.increase;
    if (bState.goal === "0") return 0;
    return parseInt(bState.goal, 10);
  }

  function recompute() {
    var recDollars = 0, oneDollars = 0, picked = [];
    document.querySelectorAll(".opt-cb").forEach(function (cb) {
      if (!cb.checked) return;
      var annual = +cb.dataset.annual, one = cb.dataset.onetime === "1";
      if (one) oneDollars += annual; else recDollars += annual;
      picked.push({ label: cb.dataset.label, home: +cb.dataset.home, one: one, cost: cb.dataset.cost });
    });
    // staffing sliders (recurring)
    ["school", "town"].forEach(function (key) {
      var n = bState[key];
      if (n > 0) {
        var d = n * B.staffing.perPosition;
        recDollars += d;
        picked.push({
          label: B.staffing[key].label + " — " + n + " position" + (n > 1 ? "s" : ""),
          home: Math.round(d * perDollarHome), one: false, cost: B.staffing[key].cost
        });
      }
    });

    var totalDollars = recDollars + oneDollars;
    var recHome = recDollars * perDollarHome;
    var oneHome = oneDollars * perDollarHome;
    var totalHome = recHome + oneHome;
    var newBill = A.fy27Bill - totalHome;
    var vs26 = newBill - A.fy26Bill;

    // ---- readout ----
    var goalRed = goalReduction();
    var metGoal = goalRed > 0 && totalHome >= goalRed - 0.5;
    var pctToGoal = goalRed > 0 ? Math.min(100, totalHome / goalRed * 100) : 0;

    readout.innerHTML =
      '<div class="ro-top">' +
        '<div class="ro-bill"><span class="ro-num">' + usdFull(Math.round(newBill)) + '</span>' +
          '<span class="ro-cap">your projected FY27 bill</span></div>' +
        '<div class="ro-stats">' +
          '<div><b class="save">−' + usdFull(Math.round(totalHome)) + '</b><span>off your bill</span></div>' +
          '<div><b>' + usd(totalDollars) + '</b><span>cut from budget</span></div>' +
          '<div><b class="' + (vs26 > 0 ? "" : "save") + '">' + (vs26 >= 0 ? "+" : "−") + usdFull(Math.abs(Math.round(vs26))) +
            '</b><span>vs this year</span></div>' +
        '</div>' +
      '</div>' +
      billBar(newBill) +
      (goalRed > 0
        ? '<div class="ro-goal ' + (metGoal ? "met" : "") + '">' +
            '<div class="goal-track"><div class="goal-fill" style="width:' + pctToGoal.toFixed(0) + '%"></div></div>' +
            '<div class="goal-text">' + (metGoal
              ? "🎯 Goal met — you've cut $" + Math.round(totalHome) + " off the bill."
              : "Found <strong>$" + Math.round(totalHome) + "</strong> of your <strong>$" + goalRed + "</strong> goal.") +
            '</div></div>'
        : "") +
      (oneHome > 0.5
        ? '<div class="ro-note">⚠️ ' + usdFull(Math.round(oneHome)) + ' of this is <strong>one-time</strong> ' +
          '(deferrals / surplus) and returns next year. Recurring cut: −' + usdFull(Math.round(recHome)) + '.</div>'
        : "");

    // ---- what you're cutting ----
    if (!picked.length) {
      cutlist.innerHTML = '<div class="cut-empty">Nothing cut yet. Start toggling above — notice how far the ' +
        '“easy” stuff gets you before you have to touch teachers, police, or fire.</div>';
    } else {
      picked.sort(function (a, b) { return b.home - a.home; });
      cutlist.innerHTML = '<div class="cut-head">What you\'re cutting — and what it costs</div>' +
        picked.map(function (p) {
          return '<div class="cut-item"><span class="ci-home">−$' + p.home + '</span>' +
            '<span class="ci-body"><span class="ci-label">' + p.label +
            (p.one ? ' <span class="once">★</span>' : '') + '</span>' +
            '<span class="ci-cost">' + p.cost + '</span></span></div>';
        }).join("");
    }
  }

  function billBar(newBill) {
    var lo = 6000, hi = A.fy27Bill + 75;
    function pos(x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); }
    var youPct = pos(newBill), draftPct = pos(A.fy27Bill), todayPct = pos(A.fy26Bill);
    return '<div class="bar-wrap">' +
      '<div class="bill-bar">' +
        '<div class="bb-fill" style="left:' + youPct + '%;width:' + Math.max(0, draftPct - youPct) + '%"></div>' +
        '<div class="bb-tick today" style="left:' + todayPct + '%"><span>this year $' + A.fy26Bill + '</span></div>' +
        '<div class="bb-tick draft" style="left:' + draftPct + '%"><span>draft $' + A.fy27Bill + '</span></div>' +
        '<div class="bb-you" style="left:' + youPct + '%"></div>' +
      '</div></div>';
  }

  // ---- wiring ----
  document.querySelector(".goalbar").addEventListener("click", function (e) {
    var b = e.target.closest(".gchip"); if (!b) return;
    this.querySelectorAll(".gchip").forEach(function (c) { c.classList.remove("active"); });
    b.classList.add("active");
    bState.goal = b.dataset.goal;
    recompute();
  });
  body.addEventListener("change", function (e) {
    if (e.target.classList.contains("opt-cb")) recompute();
  });
  body.addEventListener("input", function (e) {
    if (!e.target.classList.contains("staff-range")) return;
    var key = e.target.dataset.key, n = +e.target.value;
    bState[key] = n;
    var d = n * B.staffing.perPosition;
    document.getElementById("val-" + key).textContent =
      n + " position" + (n === 1 ? "" : "s") + " · −" + usdFull(Math.round(d * perDollarHome));
    recompute();
  });

  recompute();

  // ============ CHAT ============
  var chatWindow = document.getElementById("chatWindow");
  var form = document.getElementById("chatForm");
  var textEl = document.getElementById("chatText");
  var sendBtn = document.getElementById("sendBtn");
  var history = [];

  document.getElementById("introBubble").innerHTML =
    "Hi — I can help you understand the Yarmouth budget and test tax-cut ideas against the real numbers.<br><br>" +
    "Tap a suggestion below (it just fills the box — you decide when to send), or ask me anything like " +
    "<em>“how much would cutting $2 million save my house?”</em>";

  var suggestions = [
    "How much would a $2M cut save on my home?",
    "What are the three biggest levers to lower my taxes?",
    "Why can't we just cut the school budget?",
    "What would flat-funding everything at FY26 do?"
  ];
  document.getElementById("suggestions").innerHTML = suggestions.map(function (q) {
    return '<button class="chip-btn" data-q="' + q.replace(/"/g, "&quot;") + '">' + q + "</button>";
  }).join("");

  // Suggestion chips only PREFILL the box — they never auto-send, so a click
  // never spends tokens. The user must deliberately press Send.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-q]");
    if (!btn) return;
    showTab("chat");
    textEl.value = btn.getAttribute("data-q");
    textEl.focus();
    textEl.dispatchEvent(new Event("input"));
  });

  textEl.addEventListener("input", function () {
    textEl.style.height = "auto";
    textEl.style.height = Math.min(textEl.scrollHeight, 160) + "px";
  });
  textEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });

  function addMsg(role, initial) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + role;
    var b = document.createElement("div");
    b.className = "bubble";
    if (initial) b.innerHTML = initial;
    wrap.appendChild(b);
    chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return b;
  }

  function render(text) {
    var esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    esc = esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    esc = esc.replace(/\n/g, "<br>");
    return esc;
  }

  var busy = false;
  function submit() {
    if (busy) return;
    var q = textEl.value.trim();
    if (!q) return;
    addMsg("user", render(q));
    history.push({ role: "user", content: q });
    textEl.value = ""; textEl.style.height = "auto";
    stream();
  }

  function stream() {
    busy = true; sendBtn.disabled = true;
    var bubble = addMsg("assistant", '<span class="thinking dot-flash">Thinking</span>');
    var full = "";

    fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history, access: window.__YB_ACCESS || undefined })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          if (res.status === 403 && (t || "").toLowerCase().indexOf("access") >= 0) {
            var w = window.prompt("This tool needs an access word (ask the town for it):", "");
            if (w) {
              try { localStorage.setItem("yb_access", w.trim()); } catch (e) {}
              window.__YB_ACCESS = w.trim();
              busy = false; sendBtn.disabled = false;
              chatWindow.removeChild(bubble.parentNode);
              stream();
              return;
            }
          }
          throw new Error(friendlyError(res.status, t));
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
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
        history.push({ role: "assistant", content: full || "" });
        done();
      }
      return pump();
    }).catch(function (err) {
      bubble.classList.remove("thinking", "dot-flash");
      bubble.innerHTML = render("⚠️ " + err.message);
      done();
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
