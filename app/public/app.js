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
  document.getElementById("homeLabel").textContent = usd(M.home);

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

  // ============ SCENARIOS EXPLORER ============
  var state = { side: "cut", target: "all", impact: "all" };
  var scenBody = document.getElementById("scenBody");
  var targetChips = document.getElementById("targetChips");
  var viewNote = document.getElementById("viewNote");

  var TIERS = [
    { key: "high", title: "High impact", desc: "over $100 a year on a $500k home" },
    { key: "moderate", title: "Moderate impact", desc: "roughly $30–100 a year" },
    { key: "small", title: "Small impact", desc: "under $30 a year — symbolic more than material" }
  ];
  var TARGET_LABEL = { schools: "Schools", municipal: "Town", both: "Town + Schools", revenue: "Revenue" };
  var TARGET_CLASS = { schools: "t-edu", municipal: "t-muni", both: "t-both", revenue: "t-rev" };

  function feasClass(f) {
    f = (f || "").toLowerCase();
    if (f.indexOf("verify") >= 0 || f.indexOf("aggressive") >= 0) return "verify";
    if (f.indexOf("caution") >= 0 || f.indexOf("constrained") >= 0 || f.indexOf("study") >= 0 ||
        f.indexOf("legal") >= 0 || f.indexOf("bargain") >= 0) return "caution";
    return "ok";
  }

  function card(s) {
    var typ = s.type === "revenue" ? "new revenue/yr" : (s.type === "one-time" ? "one-time" : "annual cut");
    return '<div class="scenario">' +
      '<div class="scen-top">' +
        '<span class="tbadge ' + TARGET_CLASS[s.target] + '">' + TARGET_LABEL[s.target] + '</span>' +
        (s.type === "one-time" ? '<span class="tbadge t-once">one-time</span>' : '') +
      '</div>' +
      '<div class="title">' + s.scenario + '</div>' +
      '<div class="nums">' +
        '<div class="n save"><b>−$' + s.home + '</b><span class="cap">/home/yr</span></div>' +
        '<div class="n"><b>' + usd(s.annual) + '</b><span class="cap">' + typ + '</span></div>' +
        '<div class="n"><b>−$' + s.rate.toFixed(2) + '</b><span class="cap">rate /$1k</span></div>' +
      '</div>' +
      '<span class="badge ' + feasClass(s.feasibility) + '">' + s.feasibility + '</span>' +
      '<div class="note">' + s.note + '</div>' +
      '<button class="ask" data-q="Evaluate this idea in detail: ' +
        s.scenario.replace(/"/g, "&quot;") + '">Ask about this →</button>' +
    '</div>';
  }

  function renderScenarios() {
    // toggle target row visibility (revenue has no target split)
    targetChips.style.display = state.side === "revenue" ? "none" : "";

    var rows = D.scenarios.filter(function (s) {
      if (s.side !== state.side) return false;
      if (state.side === "cut" && state.target !== "all" && s.target !== state.target) return false;
      if (state.impact !== "all" && s.impact !== state.impact) return false;
      return true;
    });

    // contextual note
    viewNote.innerHTML = noteFor(state, rows.length);

    if (!rows.length) {
      scenBody.innerHTML = '<p class="empty">No modeled scenarios match this filter. Try widening it, or ask a custom idea in <strong>Ask the budget</strong>.</p>';
      return;
    }

    var html = "";
    TIERS.forEach(function (tier) {
      if (state.impact !== "all" && state.impact !== tier.key) return;
      var group = rows.filter(function (s) { return s.impact === tier.key; })
                      .sort(function (a, b) { return b.home - a.home; });
      if (!group.length) return;
      html += '<div class="tier">' +
        '<div class="tier-head"><span class="tier-title">' + tier.title + '</span>' +
        '<span class="tier-desc">' + tier.desc + '</span>' +
        '<span class="tier-count">' + group.length + '</span></div>' +
        '<div class="scenario-grid">' + group.map(card).join("") + '</div></div>';
    });
    scenBody.innerHTML = html;
  }

  function noteFor(st, n) {
    if (st.side === "revenue") {
      return "Revenue grows the pie without cutting services — but these are estimates that need study, " +
        "and (unlike surplus draws) they're recurring. Every dollar raised lowers the levy dollar-for-dollar.";
    }
    if (st.target === "schools") {
      return "Only a couple of discrete school cuts are modeled here — yet schools are <strong>67% of the budget</strong> " +
        "and ~83% staff pay, so the real school lever is staffing/compensation, not programs. See the " +
        "<em>Town + Schools</em> compensation scenario, or ask a custom school idea in <strong>Ask the budget</strong>.";
    }
    if (st.target === "municipal") {
      return "The town (municipal) budget is only ~30% of spending, so even deep town cuts move the bill modestly. " +
        "The biggest single town levers are capital reserves and across-the-board operating trims.";
    }
    return "";
  }

  function wireChips(container, keyName) {
    container.addEventListener("click", function (e) {
      var b = e.target.closest(".fchip"); if (!b) return;
      container.querySelectorAll(".fchip").forEach(function (c) { c.classList.remove("active"); });
      b.classList.add("active");
      state[keyName] = b.dataset[keyName];
      renderScenarios();
    });
  }
  wireChips(targetChips, "target");
  wireChips(document.getElementById("impactChips"), "impact");

  document.getElementById("sideSeg").addEventListener("click", function (e) {
    var b = e.target.closest(".seg"); if (!b) return;
    this.querySelectorAll(".seg").forEach(function (c) { c.classList.remove("active"); });
    b.classList.add("active");
    state.side = b.dataset.side;
    renderScenarios();
  });

  document.getElementById("scenariosDisclaimer").textContent =
    'Feasibility flags are starting points, not legal advice. "one-time" items (deferrals, surplus) lower one ' +
    "year's bill but don't repeat. Figures use the FY27 draft conversion factor.";

  renderScenarios();

  // ============ CHAT ============
  var chatWindow = document.getElementById("chatWindow");
  var form = document.getElementById("chatForm");
  var textEl = document.getElementById("chatText");
  var sendBtn = document.getElementById("sendBtn");
  var history = [];

  document.getElementById("introBubble").innerHTML =
    "Hi — I can help you understand the Yarmouth budget and test tax-cut ideas against the real numbers.<br><br>" +
    "Try a scenario's “Ask about this”, tap a suggestion below, or ask me anything like " +
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

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-q]");
    if (!btn) return;
    var q = btn.getAttribute("data-q");
    showTab("chat");
    textEl.value = q;
    submit();
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
