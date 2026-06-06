/* tracker.js — Renders the Methodology & Event tracker timeline. */

(function () {
  "use strict";

  var BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (src.indexOf("tracker.js") > -1) {
        return src.replace(/js\/tracker\.js.*$/, "");
      }
    }
    return "/";
  })();

  var TYPE_META = {
    methodology_change: { icon: "📋", label: "Methodology change", cls: "timeline-dot--methodology" },
    listing:            { icon: "🏛",  label: "Exchange listing",   cls: "timeline-dot--listing" },
    ipo_filing:         { icon: "📄",  label: "IPO/SEC filing",     cls: "timeline-dot--listing" },
    eligibility_window: { icon: "⏱",  label: "Eligibility window", cls: "timeline-dot--eligibility" },
    lockup_expiry:      { icon: "🔓",  label: "Lockup expiry",      cls: "timeline-dot--lockup" },
    reconstitution:     { icon: "🔄",  label: "Reconstitution",     cls: "timeline-dot--reconstitution" },
  };

  function typeMeta(type) {
    return TYPE_META[type] || { icon: "•", label: type, cls: "" };
  }

  function renderEventItem(e) {
    var meta = typeMeta(e.type);
    var srcLink = e.source_url && e.source_url.startsWith("http")
      ? ' <a href="' + e.source_url + '" target="_blank" rel="noopener noreferrer" class="text-small">source ↗</a>'
      : (e.source_url ? ' <span class="text-small text-muted">(' + e.source_url + ')</span>' : "");
    var conf = e.confidence ? ' · <em class="text-small text-muted">' + e.confidence + "</em>" : "";
    var indexes = (e.affected_indexes || []).map(function (idx) {
      return '<span class="tag">' + idx + "</span>";
    }).join("");

    return (
      '<div class="timeline-item">' +
      '<div class="timeline-dot ' + meta.cls + '" aria-hidden="true">' + meta.icon + "</div>" +
      '<div class="timeline-content">' +
      '<div class="timeline-meta">' +
      '<span>' + e.date + "</span>" +
      '<span class="tag">' + meta.label + "</span>" +
      conf + srcLink +
      "</div>" +
      '<div class="timeline-title">' + e.title + "</div>" +
      '<div class="timeline-summary">' + e.summary + "</div>" +
      (indexes ? '<div class="tag-row" style="margin-top:.5rem">' + indexes + "</div>" : "") +
      "</div></div>"
    );
  }

  function renderMethodologyItem(m) {
    var srcLink = m.source_url && m.source_url.startsWith("http")
      ? ' <a href="' + m.source_url + '" target="_blank" rel="noopener noreferrer" class="text-small">source ↗</a>'
      : "";
    var conf = m.confidence ? ' · <em class="text-small text-muted">' + m.confidence + "</em>" : "";
    var changeDate = m.change_date || "standing policy";
    var affected = (m.affected_funds || []).map(function (t) {
      return '<span class="tag">' + t + "</span>";
    }).join("");

    var mechLines = "";
    if (m.mechanism && typeof m.mechanism === "object") {
      mechLines = "<ul>" + Object.entries(m.mechanism).map(function (kv) {
        return "<li><strong>" + kv[0].replace(/_/g, " ") + ":</strong> " + kv[1] + "</li>";
      }).join("") + "</ul>";
    }

    return (
      '<div class="timeline-item">' +
      '<div class="timeline-dot timeline-dot--methodology" aria-hidden="true">📋</div>' +
      '<div class="timeline-content">' +
      '<div class="timeline-meta">' +
      '<span>' + changeDate + "</span>" +
      '<span class="tag">Methodology</span>' +
      ' · <span class="tag">' + m.index + "</span>" +
      conf + srcLink +
      "</div>" +
      '<div class="timeline-title">' + m.index + " — " + m.summary + "</div>" +
      '<div class="timeline-summary">' + (mechLines || "") + "</div>" +
      (affected ? '<div class="tag-row" style="margin-top:.5rem">' + affected + "</div>" : "") +
      "</div></div>"
    );
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function filterByType(events, types) {
    if (!types.length) return events;
    return events.filter(function (e) { return types.indexOf(e.type) > -1; });
  }

  function handleFilters(allEvents, allMeth) {
    var filterBtns = document.querySelectorAll("[data-filter]");
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        filterBtns.forEach(function (b) { b.classList.remove("btn--primary"); b.classList.add("btn--ghost"); });
        btn.classList.remove("btn--ghost");
        btn.classList.add("btn--primary");

        var filterVal = btn.dataset.filter;
        var eventsEl  = document.getElementById("events-timeline");
        var methEl    = document.getElementById("methodology-timeline");

        if (filterVal === "all") {
          renderAll(eventsEl, methEl, allEvents, allMeth);
        } else if (filterVal === "methodology") {
          if (methEl) methEl.innerHTML = allMeth.map(renderMethodologyItem).join("");
          if (eventsEl) eventsEl.innerHTML = "";
        } else {
          var filtered = filterByType(allEvents, [filterVal]);
          if (eventsEl) eventsEl.innerHTML = filtered.length
            ? filtered.map(renderEventItem).join("")
            : '<div class="empty-state"><div class="empty-state__icon">📭</div><p>No events of this type yet.</p></div>';
          if (methEl) methEl.innerHTML = "";
        }
      });
    });
  }

  function renderAll(eventsEl, methEl, events, meth) {
    if (eventsEl) eventsEl.innerHTML = events.length
      ? events.map(renderEventItem).join("")
      : '<div class="empty-state"><div class="empty-state__icon">📭</div><p>No events yet.</p></div>';
    if (methEl) methEl.innerHTML = meth.length
      ? meth.map(renderMethodologyItem).join("")
      : '<div class="empty-state"><div class="empty-state__icon">📋</div><p>No methodology entries yet.</p></div>';
  }

  function init() {
    var eventsEl = document.getElementById("events-timeline");
    var methEl   = document.getElementById("methodology-timeline");
    var statusEl = document.getElementById("tracker-status");

    Promise.all([
      fetchJSON(BASE + "data/events.json"),
      fetchJSON(BASE + "data/methodology.json")
    ]).then(function (results) {
      var events = results[0].sort(function (a, b) { return b.date.localeCompare(a.date); });
      var meth   = results[1].sort(function (a, b) { return (b.change_date || "").localeCompare(a.change_date || ""); });

      if (statusEl) statusEl.textContent = events.length + " events · " + meth.length + " methodology entries";

      renderAll(eventsEl, methEl, events, meth);
      handleFilters(events, meth);
    }).catch(function (err) {
      console.error("Tracker load error:", err);
      if (statusEl) statusEl.textContent = "Error loading data.";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
