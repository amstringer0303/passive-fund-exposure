/* analyzer.js — Client-side Exposure Analyzer.
 *
 * PRIVACY: All fund lookup and analysis happens entirely in this browser tab.
 * No user-selected fund list, uploaded file contents, or typed tickers are
 * transmitted to any server. The only network requests made are:
 *   - /data/funds.json   (static site asset, same origin)
 *   - /data/events.json  (static site asset, same origin)
 */

(function () {
  "use strict";

  var BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (src.indexOf("analyzer.js") > -1) {
        return src.replace(/js\/analyzer\.js.*$/, "");
      }
    }
    return "/";
  })();

  var state = {
    funds:    [],
    events:   [],
    selected: new Set()
  };

  // ─── Tier metadata ────────────────────────────────────────────────────────

  var TIER_META = {
    direct:           { label: "Direct — Nasdaq-100",     cls: "exposure-badge--direct",   icon: "⚡" },
    likely:           { label: "Likely exposure",          cls: "exposure-badge--likely",   icon: "⚠" },
    different_timing: { label: "Different timeline",       cls: "exposure-badge--diff",     icon: "⏱" },
    indirect:         { label: "Indirect (fund-of-funds)", cls: "exposure-badge--indirect", icon: "↩" },
    low:              { label: "Low / zero",               cls: "exposure-badge--low",      icon: "○" },
  };

  var TIER_GROUPS = [
    { tier: "direct",           icon: "⚡", label: "Direct — Nasdaq-100 fast-entry" },
    { tier: "likely",           icon: "⚠", label: "Likely — Large-cap growth & tech" },
    { tier: "different_timing", icon: "⏱", label: "Different timeline — S&P 500 / total market" },
    { tier: "indirect",         icon: "↩", label: "Indirect — Target-date & fund-of-funds" },
    { tier: "low",              icon: "○", label: "Low / zero — International & bonds" },
  ];

  var QUICK_STARTS = [
    { label: "Vanguard core",  tickers: ["QQQ", "VOO", "VTI", "VFORX"] },
    { label: "Growth tilt",    tickers: ["QQQ", "VUG", "IWF"] },
    { label: "Fidelity plan",  tickers: ["QQQ", "FTEC", "FFFHX"] },
    { label: "S&P 500 only",   tickers: ["VOO", "IVV", "SPY"] },
  ];

  // ─── Data loading ─────────────────────────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
  }

  function loadData() {
    return Promise.all([
      fetchJSON(BASE + "data/funds.json"),
      fetchJSON(BASE + "data/events.json")
    ]).then(function (results) {
      state.funds  = results[0].filter(function (f) { return !f._comment; });
      state.events = results[1];
    });
  }

  // ─── Fund lookup ──────────────────────────────────────────────────────────

  function findFund(ticker) {
    var t = ticker.toUpperCase().trim();
    return state.funds.find(function (f) { return f.ticker === t; }) || null;
  }

  function eventsForFund(fund) {
    if (!fund) return [];
    return state.events.filter(function (e) {
      if (!e.affected_indexes || !e.affected_indexes.length) return false;
      return e.affected_indexes.some(function (idx) {
        return fund.tracks_index && fund.tracks_index.toLowerCase().indexOf(idx.toLowerCase()) > -1;
      });
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  // ─── Badge ────────────────────────────────────────────────────────────────

  function badgeHTML(tier) {
    var meta = TIER_META[tier] || TIER_META["low"];
    return '<span class="exposure-badge ' + meta.cls + '">' + meta.icon + " " + meta.label + "</span>";
  }

  // ─── Card rendering ───────────────────────────────────────────────────────

  function renderHorizonEvents(fund) {
    var evts = eventsForFund(fund);
    if (!evts.length) return "";
    var items = evts.slice(0, 3).map(function (e) {
      var conf = e.confidence ? ' <span class="conf-tag">(' + e.confidence + ")</span>" : "";
      return "<li><strong>" + e.date + "</strong> — " + e.title + conf + "</li>";
    }).join("");
    return (
      '<div class="fund-card__horizon">' +
      '<p class="card-section-label">On the horizon</p>' +
      "<ul>" + items + "</ul>" +
      "</div>"
    );
  }

  function renderQuestions(fund) {
    if (!fund.questions_to_ask || !fund.questions_to_ask.length) return "";
    var items = fund.questions_to_ask.slice(0, 2).map(function (q) {
      return "<li>" + q + "</li>";
    }).join("");
    return (
      '<div class="fund-card__questions">' +
      '<p class="card-section-label">Questions to ask your plan administrator</p>' +
      "<ul>" + items + "</ul>" +
      "</div>"
    );
  }

  function renderFundCard(fund) {
    var indexStr = fund.tracks_index || "Fund-of-funds (see underlying)";
    var srcLink  = fund.source_url && fund.source_url.startsWith("http")
      ? '<a href="' + fund.source_url + '" target="_blank" rel="noopener noreferrer" class="card-src-link">issuer page ↗</a>'
      : "";

    return (
      '<article class="fund-card" data-ticker="' + fund.ticker + '">' +

      '<div class="fund-card__header">' +
        '<div>' +
          '<div class="fund-card__ticker">' + fund.ticker + '</div>' +
          '<div class="fund-card__name">' + fund.name + '</div>' +
        '</div>' +
        badgeHTML(fund.exposure_tier) +
      '</div>' +

      '<div class="fund-card__lead">' + fund.exposure_note + '</div>' +

      renderHorizonEvents(fund) +
      renderQuestions(fund) +

      '<details class="fund-card__details">' +
        '<summary>Technical details</summary>' +
        '<div class="fund-card__detail-rows">' +
          '<div class="fund-card__row"><span class="fund-card__label">Tracks</span><span class="fund-card__value">' + indexStr + '</span></div>' +
          '<div class="fund-card__row"><span class="fund-card__label">Weighting</span><span class="fund-card__value">' + (fund.weighting || "—") + '</span></div>' +
          '<div class="fund-card__row"><span class="fund-card__label">Provider</span><span class="fund-card__value">' + (fund.index_provider || "—") + '</span></div>' +
        '</div>' +
        (srcLink ? '<p style="margin:.6rem 0 0">' + srcLink + '</p>' : '') +
      '</details>' +

      '</article>'
    );
  }

  function renderUnknownCard(ticker) {
    return (
      '<article class="fund-card" data-ticker="' + ticker + '">' +
      '<div class="fund-card__header">' +
        '<div><div class="fund-card__ticker">' + ticker + '</div>' +
        '<div class="fund-card__name">Not in curated universe</div></div>' +
        '<span class="exposure-badge exposure-badge--low">? Unknown</span>' +
      '</div>' +
      '<div class="fund-card__lead">This ticker isn\'t in the curated fund universe. ' +
      'Check the fund\'s prospectus or issuer website to find which index it tracks, ' +
      'then compare against the <a href="../tracker/">Tracker</a> for methodology details.</div>' +
      '</article>'
    );
  }

  // ─── Portfolio rollup ─────────────────────────────────────────────────────

  function renderRollup(funds) {
    if (funds.length < 2) return "";

    var direct   = funds.filter(function (f) { return f.exposure_tier === "direct"; });
    var likely   = funds.filter(function (f) { return f.exposure_tier === "likely"; });
    var diffTime = funds.filter(function (f) { return f.exposure_tier === "different_timing"; });

    var overlaps = [];
    var byIndex = {};
    funds.forEach(function (f) {
      if (!f.tracks_index) return;
      byIndex[f.tracks_index] = byIndex[f.tracks_index] || [];
      byIndex[f.tracks_index].push(f.ticker);
    });
    Object.keys(byIndex).forEach(function (idx) {
      if (byIndex[idx].length > 1) {
        overlaps.push(byIndex[idx].join(" + ") + " both track " + idx + " — same underlying index.");
      }
    });

    var statsHtml =
      '<div class="rollup-stat"><div class="rollup-stat__num">' + funds.length + '</div><div class="rollup-stat__label">Funds selected</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num rollup-stat__num--hot">' + direct.length + '</div><div class="rollup-stat__label">Direct Nasdaq-100</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num rollup-stat__num--amber">' + likely.length + '</div><div class="rollup-stat__label">Likely exposure</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num rollup-stat__num--teal">' + diffTime.length + '</div><div class="rollup-stat__label">Different timeline</div></div>';

    var overlapHtml = overlaps.length
      ? '<div class="rollup-overlaps"><p class="card-section-label" style="color:#a0bdb6">Duplicate index exposure</p><ul>' +
        overlaps.map(function (o) { return "<li>" + o + "</li>"; }).join("") +
        "</ul></div>"
      : "";

    return (
      '<div class="rollup-card">' +
        '<p class="rollup-card__label">Portfolio snapshot</p>' +
        '<div class="rollup-grid">' + statsHtml + '</div>' +
        overlapHtml +
      '</div>'
    );
  }

  // ─── Output rendering ─────────────────────────────────────────────────────

  function updateAnalysis() {
    var outputEl = document.getElementById("analyzer-output");
    if (!outputEl) return;

    var tickers = Array.from(state.selected);
    if (!tickers.length) {
      outputEl.innerHTML =
        '<div class="analyzer-empty">' +
        '<div class="analyzer-empty__icon" aria-hidden="true"><i class="bi bi-arrow-left-circle"></i></div>' +
        '<p class="analyzer-empty__head">Select funds from the left panel</p>' +
        '<p class="text-small text-muted">Each card shows the index tracked, whether the May 2026 fast-entry rule applies, upcoming events, and questions to ask your plan administrator.</p>' +
        '</div>';
      return;
    }

    var known   = [];
    var unknown = [];
    tickers.forEach(function (t) {
      var f = findFund(t);
      f ? known.push(f) : unknown.push(t);
    });

    var html = renderRollup(known);

    if (known.length) {
      html += '<div class="fund-grid">';
      known.forEach(function (f) { html += renderFundCard(f); });
      html += '</div>';
    }
    if (unknown.length) {
      html += '<div class="fund-grid" style="margin-top:1rem">';
      unknown.forEach(function (t) { html += renderUnknownCard(t); });
      html += '</div>';
    }

    outputEl.innerHTML = html;
  }

  // ─── Input: chips ─────────────────────────────────────────────────────────

  function buildFundChips() {
    var container = document.getElementById("fund-chips");
    if (!container) return;
    container.innerHTML = "";

    TIER_GROUPS.forEach(function (group) {
      var fundsInGroup = state.funds.filter(function (f) { return f.exposure_tier === group.tier; });
      if (!fundsInGroup.length) return;

      var groupDiv = document.createElement("div");
      groupDiv.className = "fund-group";

      var labelEl = document.createElement("p");
      labelEl.className = "fund-group__label";
      labelEl.textContent = group.icon + " " + group.label;
      groupDiv.appendChild(labelEl);

      var chipsDiv = document.createElement("div");
      chipsDiv.className = "fund-group__chips";

      fundsInGroup.forEach(function (fund) {
        var lbl = document.createElement("label");
        lbl.className = "fund-chip";
        lbl.title = fund.name;

        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = fund.ticker;
        cb.addEventListener("change", function () {
          toggleTicker(fund.ticker);
          lbl.classList.toggle("selected", cb.checked);
          syncQuickStartButtons();
          updateAnalysis();
        });

        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(fund.ticker));
        chipsDiv.appendChild(lbl);
      });

      groupDiv.appendChild(chipsDiv);
      container.appendChild(groupDiv);
    });
  }

  // ─── Input: quick-start combos ────────────────────────────────────────────

  function syncQuickStartButtons() {
    document.querySelectorAll(".btn--quick").forEach(function (btn) {
      var tickers = JSON.parse(btn.dataset.tickers);
      var allSelected = tickers.every(function (t) { return state.selected.has(t); });
      btn.classList.toggle("active", allSelected);
    });
  }

  function handleQuickSelect() {
    var container = document.getElementById("quick-starts");
    if (!container) return;

    QUICK_STARTS.forEach(function (combo) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn--quick";
      btn.textContent = combo.label;
      btn.dataset.tickers = JSON.stringify(combo.tickers);

      btn.addEventListener("click", function () {
        var allSelected = combo.tickers.every(function (t) { return state.selected.has(t); });
        if (allSelected) {
          combo.tickers.forEach(function (t) { state.selected.delete(t); });
        } else {
          combo.tickers.forEach(function (t) { state.selected.add(t); });
        }
        syncChipState();
        syncQuickStartButtons();
        updateAnalysis();
      });

      container.appendChild(btn);
    });
  }

  // ─── Input: paste ─────────────────────────────────────────────────────────

  function parseTickers(text) {
    return text
      .split(/[\s,;\n\t]+/)
      .map(function (t) { return t.trim().toUpperCase(); })
      .filter(function (t) { return /^[A-Z]{1,6}$/.test(t); });
  }

  function toggleTicker(ticker) {
    if (state.selected.has(ticker)) {
      state.selected.delete(ticker);
    } else {
      state.selected.add(ticker);
    }
  }

  function syncChipState() {
    document.querySelectorAll("#fund-chips input[type=checkbox]").forEach(function (cb) {
      cb.checked = state.selected.has(cb.value);
      cb.closest("label").classList.toggle("selected", cb.checked);
    });
  }

  function handlePasteInput() {
    var ta = document.getElementById("ticker-paste");
    if (!ta) return;
    ta.addEventListener("input", function () {
      var tickers = parseTickers(ta.value);
      state.selected = new Set(tickers);
      syncChipState();
      syncQuickStartButtons();
      updateAnalysis();
    });
  }

  function handleClear() {
    var btn = document.getElementById("btn-clear");
    if (!btn) return;
    btn.addEventListener("click", function () {
      state.selected.clear();
      var ta = document.getElementById("ticker-paste");
      if (ta) ta.value = "";
      syncChipState();
      syncQuickStartButtons();
      updateAnalysis();
    });
  }

  // ─── Error state ──────────────────────────────────────────────────────────

  function showError(msg) {
    var el = document.getElementById("analyzer-output");
    if (el) el.innerHTML = '<div class="analyzer-empty"><div class="analyzer-empty__icon">⚠️</div><p class="analyzer-empty__head">Could not load fund data</p><p class="text-small text-muted">' + msg + "</p></div>";
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    var statusEl = document.getElementById("load-status");
    if (statusEl) statusEl.textContent = "Loading…";

    loadData()
      .then(function () {
        if (statusEl) statusEl.textContent = state.funds.length + " funds";
        buildFundChips();
        handleQuickSelect();
        handlePasteInput();
        handleClear();
        updateAnalysis();
      })
      .catch(function (err) {
        console.error("Analyzer load error:", err);
        if (statusEl) statusEl.textContent = "Error loading data.";
        showError("If you're viewing this locally via file://, open it from a local server or GitHub Pages instead.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
