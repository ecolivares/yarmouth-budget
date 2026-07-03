/* Yarmouth Budget Explorer — front-end.
   Renders the embedded dataset (window.YB_DATA) and drives the chat,
   which talks to the same-origin /api/chat proxy (the key lives there). */
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

  // ---------- formatting helpers ----------
  function usd(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
    return "$" + Math.round(n);
  }
  function usdFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pct(n) { return (n * 100).toFixed(1) + "%"; }

  // ---------- hero stats ----------
  var fy27 = "2027", fy24 = "2024";
  var tot27 = S.totalGF[fy27];
  var levy24 = S.netLevy[fy24], levy27 = S.netLevy[fy27];
  var levyCAGR = Math.pow(levy27 / levy24, 1 / 3) - 1;

  var stats = [
    { val: usd(tot27), label: "FY27 General Fund", sub: "total town + school spending", accent: true },
    { val: pct(S.education[fy27] / tot27), label: "goes to schools", sub: usd(S.education[fy27]) + " of the budget" },
    { val: "+" + pct(levyCAGR), label: "tax levy growth / yr", sub: "FY24→FY27, faster than spending" },
    { val: usdFull(M.homeBillFY27), label: "on a " + usd(M.home) + " home", sub: "FY27 bill at $" + M.rateFY27 + "/$1,000" }
  ];
  document.getElementById("statRow").innerHTML = stats.map(function (s) {
    return '<div class="stat' + (s.accent ? ' accent' : '') + '">' +
      '<div class="val">' + s.val + '</div>' +
      '<div class="label">' + s.label + '</div>' +
      '<div class="sub">' + s.sub + '</div></div>';
  }).join("");

  document.getElementById("heroNote").innerHTML =
    "From FY24 to FY27 the General Fund grew " + usd(tot27 - S.totalGF[fy24]) +
    " (" + pct(tot27 / S.totalGF[fy24] - 1) + "), but the property-tax levy grew faster — " +
    "non-tax revenue is covering a shrinking share, so a rising portion falls on property taxes.";

  // ---------- mechanics ----------
  document.getElementById("mechLead").innerHTML =
    "<p>The town's taxable value for FY27 is <strong>" + usdFull(M.taxBaseFY27) + "</strong> and the rate is " +
    "<strong>$" + M.rateFY27 + " per $1,000</strong>. That fixes a simple conversion you can apply to any cut:</p>" +
    '<span class="factor">Every <b>' + usd(1e6) + '</b> cut from the budget lowers the rate about ' +
    "<b>$" + M.ratePerMillion + "</b> per $1,000 — roughly <b>−" + usdFull(M.homePerMillion) +
    "/year</b> on a " + usd(M.home) + " home.</span>";

  // ---------- composition ----------
  document.getElementById("gfTotal").textContent = usdFull(tot27);
  document.getElementById("homeLabel").textContent = usd(M.home);

  var parts = [
    { key: "edu", name: "Education (schools)", v: S.education[fy27] },
    { key: "muni", name: "Municipal (town)", v: S.municipal[fy27] },
    { key: "county", name: "County tax", v: S.county[fy27] }
  ];
  var segHTML = parts.map(function (p) {
    var w = (p.v / tot27 * 100);
    var label = w > 8 ? pct(p.v / tot27) : "";
    return '<div class="comp-seg ' + p.key + '" style="width:' + w + '%">' + label + '</div>';
  }).join("");
  var legHTML = parts.map(function (p) {
    return '<span><i class="swatch ' + p.key + '"></i>' + p.name + " — " + usd(p.v) + " (" + pct(p.v / tot27) + ")</span>";
  }).join("");
  document.getElementById("composition").innerHTML =
    '<div class="comp-bar">' + segHTML + '</div><div class="comp-legend">' + legHTML + '</div>';

  // ---------- horizontal bars (school + municipal) ----------
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

  // ---------- scenarios ----------
  var grid = document.getElementById("scenarioGrid");
  var groupSel = document.getElementById("filterGroup");
  var sortSel = document.getElementById("sortBy");
  var countEl = document.getElementById("scenarioCount");

  var groups = [];
  D.scenarios.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
  groups.forEach(function (g) {
    var o = document.createElement("option"); o.value = g; o.textContent = g; groupSel.appendChild(o);
  });

  function feasClass(f) {
    f = (f || "").toLowerCase();
    if (f.indexOf("verify") >= 0 || f.indexOf("aggressive") >= 0) return "verify";
    if (f.indexOf("caution") >= 0 || f.indexOf("constrained") >= 0 || f.indexOf("study") >= 0 ||
        f.indexOf("legal") >= 0 || f.indexOf("bargain") >= 0) return "caution";
    return "ok";
  }

  function renderScenarios() {
    var g = groupSel.value, sort = sortSel.value;
    var rows = D.scenarios.filter(function (s) { return !g || s.group === g; });
    rows.sort(function (a, b) {
      if (sort === "home") return b.home - a.home;
      if (sort === "alpha") return a.scenario.localeCompare(b.scenario);
      return a.group.localeCompare(b.group) || b.home - a.home;
    });
    countEl.textContent = rows.length + " of " + D.scenarios.length;
    grid.innerHTML = rows.map(function (s) {
      var typ = s.type === "revenue" ? "new revenue" : (s.type === "one-time" ? "one-time" : "annual cut");
      return '<div class="scenario">' +
        '<div class="grp">' + s.group + '</div>' +
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
    }).join("");
  }
  groupSel.addEventListener("change", renderScenarios);
  sortSel.addEventListener("change", renderScenarios);
  renderScenarios();

  document.getElementById("scenariosDisclaimer").textContent =
    'Feasibility flags are starting points, not legal advice. "one-time" items (deferrals, surplus) lower one ' +
    "year's bill but don't repeat. Figures use the FY27 draft conversion factor.";

  // ---------- chat ----------
  var chatWindow = document.getElementById("chatWindow");
  var form = document.getElementById("chatForm");
  var textEl = document.getElementById("chatText");
  var sendBtn = document.getElementById("sendBtn");
  var history = []; // {role, content}

  document.getElementById("introBubble").innerHTML =
    "Hi — I can help you understand the Yarmouth budget and test tax-cut ideas against the real numbers.<br><br>" +
    "Try a scenario card above, tap a suggestion below, or ask me anything like " +
    "<em>“how much would cutting $2 million save my house?”</em>";

  var suggestions = [
    "How much would a $2M cut save on my home?",
    "What are the three biggest levers to lower my taxes?",
    "Why can't we just cut the school budget?",
    "What would flat-funding everything at FY26 do?"
  ];
  var sugEl = document.getElementById("suggestions");
  sugEl.innerHTML = suggestions.map(function (q) {
    return '<button class="chip" data-q="' + q.replace(/"/g, "&quot;") + '">' + q + "</button>";
  }).join("");

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-q]");
    if (!btn) return;
    var q = btn.getAttribute("data-q");
    textEl.value = q;
    if (btn.classList.contains("chip") || btn.classList.contains("ask")) {
      document.getElementById("chat").scrollIntoView({ behavior: "smooth", block: "start" });
      submit();
    }
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

  // very small, safe markdown-ish renderer (bold + line breaks + escape)
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
              chatWindow.removeChild(bubble.parentNode); // drop this attempt's bubble; keep the user turn in history
              stream();                                   // retry with the same pending question
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
        if (!full) { bubble.innerHTML = render("(No response.)"); }
        history.push({ role: "assistant", content: full || "" });
        done();
      }
      return pump();
    }).catch(function (err) {
      bubble.classList.remove("thinking", "dot-flash");
      bubble.innerHTML = render("⚠️ " + err.message);
      // drop the failed user turn's expected reply so history stays valid
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
