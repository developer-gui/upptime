/**
 * assets/detail-ranges.js
 *
 * Client-side enhancer for Upptime detail pages (/history/[slug]).
 * Provides interactive time range selection: [ 7d | 14d | 30d | 60d | 180d | All ]
 *
 * Fetches static timeline JSON (api/{slug}/history-timeline.json) with 0 GitHub API
 * rate-limit risk and updates the chart, header, and average response metric dynamically.
 */

(function () {
  "use strict";

  const RANGES = [
    { key: "7d", label: "7d", days: 7, title: "7-day response time" },
    { key: "14d", label: "14d", days: 14, title: "14-day response time" },
    { key: "30d", label: "30d", days: 30, title: "30-day response time" },
    { key: "60d", label: "60d", days: 60, title: "60-day response time" },
    { key: "180d", label: "180d", days: 180, title: "180-day response time" },
    { key: "all", label: "All", days: null, title: "All-time response time" },
  ];

  let currentSlug = null;
  let allPoints = [];
  let activeRangeKey = "7d";
  let isInitializing = false;

  /**
   * Extracts the current slug from the window location pathname.
   * Format: /history/{slug}
   */
  function getSlugFromPath() {
    const match = window.location.pathname.match(/\/history\/([a-zA-Z0-9_\-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Finds the active Chart.js instance attached to the canvas element.
   */
  function findChartInstance(canvas) {
    if (!canvas) return null;

    // Chart.js v3+ helper
    if (window.Chart && typeof window.Chart.getChart === "function") {
      const c = window.Chart.getChart(canvas);
      if (c) return c;
    }

    // Chart.js v2 instances dictionary
    if (window.Chart && window.Chart.instances) {
      for (const key in window.Chart.instances) {
        const inst = window.Chart.instances[key];
        if (inst && (inst.canvas === canvas || inst.ctx?.canvas === canvas)) {
          return inst;
        }
      }
    }

    // Direct canvas property attachment
    for (const prop in canvas) {
      if (
        prop.startsWith("__chart") ||
        prop === "_chart" ||
        prop === "$chartjs" ||
        prop === "chart"
      ) {
        if (canvas[prop] && typeof canvas[prop].update === "function") {
          return canvas[prop];
        }
      }
    }

    return null;
  }

  /**
   * Fetches static timeline points for the given slug.
   */
  async function fetchTimeline(slug) {
    const candidateUrls = [
      `/api/${slug}/history-timeline.json`,
      `/assets/api/${slug}/history-timeline.json`,
      `../assets/api/${slug}/history-timeline.json`,
      `./assets/api/${slug}/history-timeline.json`,
      `../api/${slug}/history-timeline.json`,
      `./api/${slug}/history-timeline.json`,
    ];

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            return data;
          }
        }
      } catch (e) {
        // Continue to fallback
      }
    }

    return null;
  }

  /**
   * Updates the "Average response" stat on the top summary card.
   */
  function updateAverageMetric(avgMs) {
    const headings = document.querySelectorAll("h3, h4, h5, p, span, div");
    for (const el of headings) {
      if (el.textContent && el.textContent.trim().toLowerCase() === "average response") {
        const parent = el.closest("div") || el.parentElement;
        if (parent) {
          // Look for adjacent text node or paragraph with ms value
          const textEl = parent.querySelector("p, span, h2, h3, div:not(:first-child)");
          if (textEl && textEl !== el) {
            textEl.textContent = `${avgMs}ms`;
            return;
          }
        }
      }
    }
  }

  /**
   * Applies the selected time range filtering to the chart and UI.
   */
  function applyRange(rangeKey) {
    activeRangeKey = rangeKey;
    const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0];

    // 1. Update active button classes
    const buttons = document.querySelectorAll(".upptime-range-btn");
    buttons.forEach((btn) => {
      if (btn.dataset.range === rangeKey) {
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      }
    });

    // 2. Filter points based on days cutoff
    const now = Date.now();
    const cutoff = range.days ? now - range.days * 24 * 60 * 60 * 1000 : 0;
    const filtered = allPoints.filter(
      (p) => new Date(p.time).getTime() >= cutoff
    );

    // 3. Recalculate average
    const avg =
      filtered.length > 0
        ? Math.round(filtered.reduce((sum, p) => sum + p.ms, 0) / filtered.length)
        : 0;

    // 4. Update heading and subtext
    const headingEl = document.querySelector(".upptime-range-heading");
    if (headingEl) {
      headingEl.textContent = range.title;
    }

    const subtextEl = document.querySelector(".upptime-range-subtext");
    if (subtextEl) {
      subtextEl.textContent = `${filtered.length} checks recorded • Avg: ${avg}ms`;
    }

    // 5. Update average response metric in top card
    updateAverageMetric(avg);

    // 6. Update chart instance
    const canvas = document.querySelector("section canvas");
    const chart = findChartInstance(canvas);

    if (chart && chart.data) {
      chart.data.labels = filtered.map((p) =>
        new Date(p.time).toLocaleString()
      );
      if (chart.data.datasets && chart.data.datasets[0]) {
        chart.data.datasets[0].data = filtered.map((p) => p.ms);
      }
      chart.update();
    }
  }

  /**
   * Initializes the segmented control above the response-time chart.
   */
  async function initDetailRange() {
    const slug = getSlugFromPath();
    if (!slug) return;

    if (document.querySelector(".upptime-range-container")) {
      return; // Already mounted
    }

    const canvas = document.querySelector("section canvas");
    if (!canvas) {
      return; // Chart not rendered yet
    }

    const section = canvas.closest("section");
    if (!section) return;

    const existingHeading = section.querySelector("h2");
    if (!existingHeading) return;

    if (isInitializing) return;
    isInitializing = true;

    currentSlug = slug;

    // Load static timeline
    let points = await fetchTimeline(slug);

    // If static file not loaded, fallback to initial points from on-page chart
    if (!points || points.length === 0) {
      const chart = findChartInstance(canvas);
      if (chart && chart.data && chart.data.datasets && chart.data.datasets[0]) {
        const labels = chart.data.labels || [];
        const data = chart.data.datasets[0].data || [];
        points = labels.map((label, idx) => ({
          time: new Date(label).toISOString() || new Date().toISOString(),
          ms: data[idx] || 0,
        }));
      }
    }

    allPoints = points || [];

    // Construct container
    const container = document.createElement("div");
    container.className = "upptime-range-container";

    const headingGroup = document.createElement("div");
    headingGroup.className = "upptime-range-heading-group";

    const heading = document.createElement("h2");
    heading.className = "upptime-range-heading";
    heading.textContent = "7-day response time";

    const subtext = document.createElement("span");
    subtext.className = "upptime-range-subtext";
    subtext.textContent = `${allPoints.length} checks recorded`;

    headingGroup.appendChild(heading);
    headingGroup.appendChild(subtext);

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "upptime-range-buttons";
    buttonGroup.setAttribute("role", "group");
    buttonGroup.setAttribute("aria-label", "Time range filter");

    RANGES.forEach((range) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `upptime-range-btn ${range.key === activeRangeKey ? "active" : ""}`;
      btn.dataset.range = range.key;
      btn.textContent = range.label;
      btn.setAttribute("aria-pressed", range.key === activeRangeKey ? "true" : "false");
      btn.addEventListener("click", () => applyRange(range.key));
      buttonGroup.appendChild(btn);
    });

    container.appendChild(headingGroup);
    container.appendChild(buttonGroup);

    // Replace original <h2> with our enhanced interactive container
    existingHeading.replaceWith(container);

    // Initial calculation for default active range (7d)
    applyRange(activeRangeKey);

    isInitializing = false;
  }

  // Observe DOM for Sapper SPA page transitions
  const observer = new MutationObserver(() => {
    if (getSlugFromPath()) {
      initDetailRange();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Initial load checks
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDetailRange);
  } else {
    initDetailRange();
  }
})();
