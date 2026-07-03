// Yarmouth Budget Explorer — chat proxy (Vercel Edge Function).
//
// Holds the Anthropic API key server-side and streams responses back to the
// browser, so the key is never exposed. Cost guardrails (always on):
//   - fixed model + capped max_tokens
//   - capped conversation length + per-message size
// Optional, via env vars:
//   - ACCESS_WORD ............. require a shared word before chatting
//   - UPSTASH_REDIS_REST_URL/TOKEN .. durable per-IP rate limiting
// The real hard ceiling is a monthly spend cap set in the Anthropic console.

import { BUDGET } from "./_budget-data.js";

export const config = { runtime: "edge" };

// ---- tunables (env-overridable) ----
const MODEL = globalThis.process?.env?.CHAT_MODEL || "claude-sonnet-5";
const MAX_TOKENS = int(globalThis.process?.env?.MAX_TOKENS, 1500);
const MAX_TURNS = int(globalThis.process?.env?.MAX_TURNS, 16);   // messages kept
const MAX_MSG_CHARS = int(globalThis.process?.env?.MAX_MSG_CHARS, 4000);
const RL_LIMIT = int(globalThis.process?.env?.RL_LIMIT, 20);     // requests
const RL_WINDOW_SEC = int(globalThis.process?.env?.RL_WINDOW_SEC, 600); // per 10 min

function int(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);

  var key = globalThis.process?.env?.ANTHROPIC_API_KEY;
  if (!key) return json({ error: { message: "Server not configured: missing ANTHROPIC_API_KEY." } }, 500);

  var body;
  try { body = await req.json(); } catch (e) { return json({ error: { message: "Bad JSON" } }, 400); }

  // ---- access word (optional) ----
  var word = globalThis.process?.env?.ACCESS_WORD;
  if (word && String(body.access || "").trim() !== word) {
    return json({ error: { message: "This tool requires an access word." } }, 403);
  }

  // ---- rate limit (optional, durable via Upstash) ----
  var ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  try {
    if (await rateLimited(ip)) {
      return json({ error: { message: "Rate limit exceeded. Please wait a minute." } }, 429);
    }
  } catch (e) { /* never let the limiter take the endpoint down */ }

  // ---- sanitize + cap the conversation ----
  var msgs = Array.isArray(body.messages) ? body.messages : [];
  msgs = msgs
    .filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"; })
    .slice(-MAX_TURNS)
    .map(function (m) { return { role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }; });
  // must start on a user turn and be non-empty
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return json({ error: { message: "No message." } }, 400);

  // ---- call Anthropic (streaming) ----
  var upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Sonnet 5 runs adaptive thinking when `thinking` is omitted, which would
        // consume the max_tokens budget before the answer finishes. This is a
        // short grounded Q&A — turn thinking off so the whole budget is the reply.
        thinking: { type: "disabled" },
        system: systemPrompt(),
        messages: msgs,
        stream: true
      })
    });
  } catch (e) {
    return json({ error: { message: "Upstream request failed." } }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    var detail = "";
    try { detail = await upstream.text(); } catch (e) {}
    return json({ error: { message: "Assistant error", detail: detail.slice(0, 400) } }, upstream.status || 502);
  }

  // pass the SSE stream straight through to the browser
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}

// ---------- helpers ----------
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" }
  });
}

async function rateLimited(ip) {
  var url = globalThis.process?.env?.UPSTASH_REDIS_REST_URL;
  var tok = globalThis.process?.env?.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return false; // no durable store configured — rely on caps + console spend limit
  var bucket = Math.floor(Date.now() / 1000 / RL_WINDOW_SEC);
  var k = "yb:rl:" + ip + ":" + bucket;
  var r = await fetch(url + "/incr/" + encodeURIComponent(k), { headers: { Authorization: "Bearer " + tok } });
  var d = await r.json();
  if (d.result === 1) {
    await fetch(url + "/expire/" + encodeURIComponent(k) + "/" + RL_WINDOW_SEC, { headers: { Authorization: "Bearer " + tok } });
  }
  return d.result > RL_LIMIT;
}

function systemPrompt() {
  var S = BUDGET.summary, M = BUDGET.mechanics;
  var facts = {
    fiscalYears: S.years,
    generalFund_FY27: S.totalGF["2027"],
    composition_FY27: {
      education: S.education["2027"],
      municipal: S.municipal["2027"],
      county: S.county["2027"]
    },
    netTaxLevy: { FY24: S.netLevy["2024"], FY27: S.netLevy["2027"] },
    taxRatePer1000: S.rate,
    taxBase: S.taxBase,
    mechanics: {
      fy27_tax_base: M.taxBaseFY27,
      fy26_rate_per_1000: S.rate["2026"],
      fy27_rate_per_1000: M.rateFY27,
      standard_home: M.home,
      standard_home_fy26_bill: Math.round(S.rate["2026"] * M.home / 1000),
      standard_home_fy27_draft_bill: M.homeBillFY27,
      fy27_draft_increase_on_standard_home: Math.round((M.rateFY27 - S.rate["2026"]) * M.home / 1000),
      dollars_per_rate_point: "each $1,000,000 cut ≈ −$" + M.ratePerMillion + "/$1,000 rate ≈ −$" + M.homePerMillion + "/yr on a $" + M.home + " home"
    },
    schoolFunctions_FY27: BUDGET.school,
    municipalCategories: BUDGET.categories,
    modeledScenarios: BUDGET.scenarios
  };

  return [
    "You are the Yarmouth Budget Assistant, a neutral, numerate helper for residents of Yarmouth, Maine who want to understand the town & school budget and explore property-tax-cut scenarios.",
    "",
    "You have the validated budget dataset below (FY2024 approved through FY2027 draft). Ground EVERY number in it. Do not invent line items or figures. If something isn't in the data, say so plainly.",
    "",
    "=== DATASET (JSON) ===",
    JSON.stringify(facts),
    "=== END DATASET ===",
    "",
    "KEY FACTS TO ANCHOR ON:",
    "- FY27 General Fund is ~$65.6M: ~67% education, ~30% municipal, ~3% county tax (county is a pass-through the town cannot set).",
    "- The property-tax LEVY is growing ~7.5%/yr, faster than spending, because non-tax revenue covers a shrinking share.",
    "- REVALUATION TRAP: the rate dropped from $25.67 (FY25) to $14.55 (FY26) because the taxable base ~doubled — that was NOT a tax cut. Always compare the levy (dollars raised), never the rate, across FY25→FY26.",
    "- ~83% of the school budget is salaries + benefits, so real school savings mean staffing/compensation, not supplies.",
    "- CONVERSION FACTOR: every $1,000,000 cut ≈ −$" + M.ratePerMillion + " on the rate ≈ −$" + M.homePerMillion + "/year on a $" + M.home + " home.",
    "- ANCHOR THE BILL ON THE INCREASE: a $" + M.home + " home pays ~$" + Math.round(S.rate["2026"] * M.home / 1000) + "/yr this year (FY26, rate $" + S.rate["2026"] + "). The FY27 DRAFT raises it to ~$" + M.homeBillFY27 + " (rate $" + M.rateFY27 + ") — about +$" + Math.round((M.rateFY27 - S.rate["2026"]) * M.home / 1000) + "/yr. Frame cuts as reducing that increase; note that erasing the whole school+town increase only gets the bill back to roughly today's level.",
    "- WHY IT ROSE (not irresponsibility): the FY24→FY27 increase is overwhelmingly contractual wages, benefit-market inflation (health/dental, retirement, FICA), state-mandated special education, and a shrinking share of non-tax revenue — not new discretionary spending. If asked whether the increase was wasteful/irresponsible, explain the structural drivers neutrally and let the numbers speak; do not editorialize or advocate.",
    "",
    "HOW TO ANSWER:",
    "1. When someone proposes a cut, first estimate the annual dollars (use a modeled scenario if it matches, or the dataset lines), then convert to rate impact and per-home savings with the conversion factor. Show the chain: dollars → rate → per-home.",
    "2. Be honest about magnitude. Most 'easy' targets are small; schools are the only big lever. Don't oversell savings.",
    "3. Surface feasibility catches (legal mandates, Title IX, state-aid clawbacks, one-time vs recurring, revaluation) when relevant — the scenarios include feasibility notes; use them.",
    "4. Distinguish one-time moves (deferrals, surplus draws) from recurring cuts.",
    "5. Keep answers concise and conversational — a few short paragraphs, plain language for residents. Use **bold** for the key numbers. No tables unless asked.",
    "6. Remind users, when it matters, that FY27 is a DRAFT and figures should be checked against the official budget book.",
    "7. Stay on the Yarmouth budget. If asked something unrelated, gently redirect.",
    "8. You are non-partisan: present the math and tradeoffs; don't advocate for or against any cut."
  ].join("\n");
}
