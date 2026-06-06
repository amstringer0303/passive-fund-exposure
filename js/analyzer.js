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
    // Resolve /data/ relative to site root, not the current page path
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
    funds: [],          // loaded from funds.json
    events: [],         // loaded from events.json
    selected: new Set() // tickers the user has chosen
  };

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

  // ─── Exposure badge ───────────────────────────────────────────────────────

  var TIER_META = {
    direct:          { label: "Direct — Nasdaq-100",     cls: "exposure-badge--direct",   icon: "⚡" },
    likely:          { label: "Likely exposure",          cls: "exposure-badge--likely",   icon: "⚠" },
    different_timing:{ label: "Different timing",         cls: "exposure-badge--diff",     icon: "⏱" },
    indirect:        { label: "Indirect (fund-of-funds)", cls: "exposure-badge--indirect", icon: "↩" },
    low:             { label: "Low / zero",               cls: "exposure-badge--low",      icon: "○" },
  };

  function badgeHTML(tier) {
    var meta = TIER_META[tier] || TIER_META["low"];
    return '<span class="exposure-badge ' + meta.cls + '">' + meta.icon + " " + meta.label + "</span>";
  }

  // ─── Card rendering ───────────────────────────────────────────────────────

  function row(label, value, extraClass) {
    return (
      '<div class="fund-card__row">' +
      '<span class="fund-card__label">' + label + "</span>" +
      '<span class="fund-card__value' + (extraClass ? " " + extraClass : "") + '">' + value + "</span>" +
      "</div>"
    );
  }

  function renderHorizonEvents(fund) {
    var evts = eventsForFund(fund);
    if (!evts.length) return "";
    var items = evts.slice(0, 4).map(function (e) {
      var conf = e.confidence ? ' <span class="text-muted text-small">(' + e.confidence + ")</span>" : "";
      return "<li><strong>" + e.date + "</strong> — " + e.title + conf + "</li>";
    }).join("");
    return (
      '<div class="fund-card__section">' +
      "<h4>On the Horizon</h4><ul>" + items + "</ul></div>"
    );
  }

  function renderTradeoffs(fund) {
    if (!fund.tradeoffs) return "";
    return (
      '<div class="fund-card__section">' +
      "<h4>Tradeoffs to understand</h4>" +
      "<p>" + fund.tradeoffs + "</p></div>"
    );
  }

  function renderQuestions(fund) {
    if (!fund.questions_to_ask || !fund.questions_to_ask.length) return "";
    var items = fund.questions_to_ask.map(function (q) { return "<li>" + q + "</li>"; }).join("");
    return (
      '<div class="fund-card__section">' +
      "<h4>Questions to ask your plan administrator or adviser</h4>" +
      "<ul>" + items + "</ul></div>"
    );
  }

  function renderFundCard(fund) {
    var indexStr = fund.tracks_index || "Fund-of-funds (see underlying)";
    var weightStr = fund.weighting || "—";
    var top10 = fund.top10_weight_pct != null
      ? fund.top10_weight_pct + "%"
      : '<span class="data-status data-status--todo">unverified — see source</span>';
    var asOf = fund.as_of
      ? '<span class="text-small text-muted">as of ' + fund.as_of + "</span>"
      : "";
    var srcLink = fund.source_url && fund.source_url.startsWith("http")
      ? ' <a href="' + fund.source_url + '" target="_blank" rel="noopener noreferrer" class="text-small">issuer page ↗</a>'
      : "";

    return (
      '<article class="fund-card" data-ticker="' + fund.ticker + '">' +
      '<div class="fund-card__header">' +
      '<div><div class="fund-card__ticker">' + fund.ticker + "</div>" +
      '<div class="fund-card__name">' + fund.name + "</div></div>" +
      badgeHTML(fund.exposure_tier) +
      "</div>" +
      '<div class="fund-card__body">' +
      row("Tracks", indexStr) +
      row("Weighting", weightStr) +
      row("Top-10 weight", top10 + " " + asOf) +
      row("Provider", fund.index_provider || "—") +
      "</div>" +
      '<div class="fund-card__body" style="padding-top:0">' +
      "<p>" + fund.exposure_note + "</p>" +
      srcLink +
      "</div>" +
      renderHorizonEvents(fund) +
      renderTradeoffs(fund) +
      renderQuestions(fund) +
      "</article>"
    );
  }

  function renderUnknownCard(ticker) {
    return (
      '<article class="fund-card" data-ticker="' + ticker + '">' +
      '<div class="fund-card__header">' +
      '<div><div class="fund-card__ticker">' + ticker + "</div>" +
      '<div class="fund-card__name">Not in curated universe</div></div>' +
      '<span class="exposure-badge exposure-badge--low">? Unknown</span>' +
      "</div>" +
      '<div class="fund-card__body">' +
      "<p>This ticker isn’t in the curated fund universe. " +
      "Check the fund’s prospectus or issuer website to determine which index it tracks, " +
      "then compare against the methodology information in the Tracker.</p></div></article>"
    );
  }

  // ─── Portfolio roll-up ────────────────────────────────────────────────────

  function renderRollup(selectedFunds) {
    if (selectedFunds.length < 2) return "";
    var direct   = selectedFunds.filter(function (f) { return f.exposure_tier === "direct"; });
    var likely   = selectedFunds.filter(function (f) { return f.exposure_tier === "likely"; });
    var diffTime = selectedFunds.filter(function (f) { return f.exposure_tier === "different_timing"; });
    var indirect = selectedFunds.filter(function (f) { return f.exposure_tier === "indirect"; });

    var overlaps = [];
    var nasdaq100Funds = selectedFunds.filter(function (f) { return f.tracks_index === "Nasdaq-100"; });
    var sp500Funds = selectedFunds.filter(function (f) { return f.tracks_index === "S&P 500"; });
    if (nasdaq100Funds.length > 1) {
      overlaps.push("Multiple Nasdaq-100 funds: " + nasdaq100Funds.map(function (f) { return f.ticker; }).join(", ") + " — these track the same index.");
    }
    if (sp500Funds.length > 1) {
      overlaps.push("Multiple S&P 500 funds: " + sp500Funds.map(function (f) { return f.ticker; }).join(", ") + " — these track the same index.");
    }

    return (
      '<div class="rollup-card">' +
      "<h2>Portfolio Overview</h2>" +
      '<div class="rollup-grid">' +
      '<div class="rollup-stat"><div class="rollup-stat__num">' + selectedFunds.length + '</div><div class="rollup-stat__label">Funds analyzed</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num">' + direct.length + '</div><div class="rollup-stat__label">Direct Nasdaq-100 exposure</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num">' + likely.length + '</div><div class="rollup-stat__label">Likely exposure (growth/tech)</div></div>' +
      '<div class="rollup-stat"><div class="rollup-stat__num">' + diffTime.length + '</div><div class="rollup-stat__label">Different-timing (S&P / total-mkt)</div></div>' +
      "</div>" +
      (overlaps.length ? '<div style="margin-top:1rem"><h3 style="color:#c7d9f5;font-size:.95rem">Overlapping index exposure</h3><ul style="color:#e0eaff;font-size:.88rem">' + overlaps.map(function (o) { return "<li>" + o + "</li>"; }).join("") + "</ul></div>" : "") +
      "</div>"
    );
  }

  // ─── Update the analysis output ───────────────────────────────────────────

  function updateAnalysis() {
    var outputEl = document.getElementById("analyzer-output");
    if (!outputEl) return;

    var tickers = Array.from(state.selected);
    if (!tickers.length) {
      outputEl.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🔍</div><p>Select funds above or paste tickers to see the analysis.</p></div>';
      return;
    }

    var known   = [];
    var unknown = [];
    tickers.forEach(function (t) {
      var f = findFund(t);
      f ? known.push(f) : unknown.push(t);
    });

    var html = "";
    if (known.length) {
      html += renderRollup(known);
      html += '<div class="fund-grid">';
      known.forEach(function (f) { html += renderFundCard(f); });
      html += "</div>";
    }
    if (unknown.length) {
      html += '<div class="fund-grid" style="margin-top:1rem">';
      unknown.forEach(function (t) { html += renderUnknownCard(t); });
      html += "</div>";
    }

    outputEl.innerHTML = html;
  }

  // ─── Input handling ───────────────────────────────────────────────────────

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

  function buildFundChips() {
    var container = document.getElementById("fund-chips");
    if (!container) return;
    container.innerHTML = "";
    state.funds.forEach(function (fund) {
      var label = document.createElement("label");
      label.className = "fund-chip";
      label.title = fund.name;

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = fund.ticker;
      cb.addEventListener("change", function () {
        toggleTicker(fund.ticker);
        label.classList.toggle("selected", cb.checked);
        updateAnalysis();
      });

      label.appendChild(cb);
      label.appendChild(document.createTextNode(fund.ticker));
      container.appendChild(label);
    });
  }

  function handlePasteInput() {
    var ta = document.getElementById("ticker-paste");
    if (!ta) return;
    ta.addEventListener("input", function () {
      var tickers = parseTickers(ta.value);
      // Sync with chip state
      var chipCbs = document.querySelectorAll("#fund-chips input[type=checkbox]");
      chipCbs.forEach(function (cb) {
        cb.checked = tickers.indexOf(cb.value) > -1;
        cb.closest("label").classList.toggle("selected", cb.checked);
      });
      state.selected = new Set(tickers);
      updateAnalysis();
    });
  }

  function handleFileUpload() {
    var input = document.getElementById("file-upload");
    var zone  = document.getElementById("upload-zone");
    if (!input || !zone) return;

    zone.addEventListener("click", function () { input.click(); });
    zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("drag-over"); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      zone.classList.remove("drag-over");
      var file = e.dataTransfer.files[0];
      if (file) readFile(file);
    });
    input.addEventListener("change", function () {
      if (input.files[0]) readFile(input.files[0]);
    });

    function readFile(file) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var tickers = parseTickers(e.target.result);
        var ta = document.getElementById("ticker-paste");
        if (ta) ta.value = tickers.join(", ");
        state.selected = new Set(tickers);
        updateAnalysis();
        zone.textContent = "✓ Loaded " + file.name + " — " + tickers.length + " ticker(s) found";
      };
      reader.readAsText(file);
    }
  }

  function handleClear() {
    var btn = document.getElementById("btn-clear");
    if (!btn) return;
    btn.addEventListener("click", function () {
      state.selected.clear();
      var ta = document.getElementById("ticker-paste");
      if (ta) ta.value = "";
      document.querySelectorAll("#fund-chips input[type=checkbox]").forEach(function (cb) {
        cb.checked = false;
        cb.closest("label").classList.remove("selected");
      });
      var zone = document.getElementById("upload-zone");
      if (zone) zone.textContent = "Drop a CSV or fund-menu text file here, or click to browse";
      updateAnalysis();
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function showError(msg) {
    var el = document.getElementById("analyzer-output");
    if (el) el.innerHTML = '<div class="empty-state"><div class="empty-state__icon">⚠️</div><p>' + msg + "</p></div>";
  }

  function init() {
    var statusEl = document.getElementById("load-status");
    if (statusEl) statusEl.textContent = "Loading fund data…";

    loadData()
      .then(function () {
        if (statusEl) statusEl.textContent = state.funds.length + " funds loaded.";
        buildFundChips();
        handlePasteInput();
        handleFileUpload();
        handleClear();
        updateAnalysis();
      })
      .catch(function (err) {
        console.error("Analyzer load error:", err);
        if (statusEl) statusEl.textContent = "Error loading data.";
        showError("Could not load fund data. If you’re viewing this locally via file://, open it from a local server or GitHub Pages instead.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
