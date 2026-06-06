/* disclaimer.js — Injects the persistent disclaimer on every page. */

(function () {
  var DISMISS_KEY = "pfe_disclaimer_dismissed";

  var DISCLAIMER_TEXT =
    "<strong>Educational information only — not investment advice.</strong> " +
    "This site describes how index rules work and how they may affect what passive funds hold. " +
    "It does not recommend any action, characterize any fund as appropriate or inappropriate for any investor, " +
    "or constitute investment, legal, tax, or financial advice. " +
    "Index membership rules, fund holdings, and market conditions change; verify all information against " +
    "current issuer and index provider publications before drawing conclusions. " +
    "Consult a qualified financial adviser or your plan administrator for guidance specific to your situation.";

  function injectInlineDisclaimer(containerSelector) {
    var containers = document.querySelectorAll(containerSelector || ".disclaimer-inline-target");
    containers.forEach(function (el) {
      var div = document.createElement("div");
      div.className = "disclaimer";
      div.setAttribute("role", "note");
      div.setAttribute("aria-label", "Disclaimer");
      div.innerHTML = "<p>" + DISCLAIMER_TEXT + "</p>";
      el.appendChild(div);
    });
  }

  function injectStickyDisclaimer() {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    var bar = document.createElement("div");
    bar.id = "sticky-disclaimer";
    bar.className = "disclaimer disclaimer--sticky";
    bar.setAttribute("role", "note");
    bar.setAttribute("aria-label", "Disclaimer");
    bar.innerHTML =
      "<p>" + DISCLAIMER_TEXT + "</p>" +
      '<button class="dismiss-btn" id="dismiss-disclaimer" aria-label="Dismiss disclaimer">Dismiss</button>';
    document.body.appendChild(bar);

    document.getElementById("dismiss-disclaimer").addEventListener("click", function () {
      bar.remove();
      document.body.classList.add("disclaimer-dismissed");
      sessionStorage.setItem(DISMISS_KEY, "1");
    });

    // Add bottom padding so sticky bar doesn't obscure content
    document.body.style.paddingBottom = "120px";
  }

  function init() {
    injectStickyDisclaimer();
    injectInlineDisclaimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
