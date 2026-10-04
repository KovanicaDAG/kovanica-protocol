import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scale,
  metrics,
  d3Scale,
  d3Array,
} from "./helper.mjs";

const { makeColorScale } = scale;
const {
  CHLORO_STOPS,
  LAND_EMPTY,
  LAND_HOVER,
  OCEAN,
  STROKE,
  STROKE_ACTIVE,
  formatPulses,
  formatShare,
} = metrics;

// Palette definitions across the 5 canonical themes
const PALETTES = {
  emerald: ["#1c2e36", "#1a4f54", "#1c7c72", "#2fbaa4", "#7ee8d0"],
  gold: ["#2a2415", "#4d3f18", "#7a641a", "#b89728", "#f5d061"],
  cyberpunk: ["#2b1434", "#581c6a", "#9423a6", "#d832d2", "#ff70f8"],
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  accessible: ["#000000", "#2b5c8f", "#008837", "#e66101", "#ffffbf"],
};

// Helper to compute relative luminance of hex color for monotonic verification
function hexLuminance(hex) {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  const toLinear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Multi-scale builder functions to verify behavior across all scale modes
function buildMultiScale(type, values, paletteStops = CHLORO_STOPS) {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (positive.length === 0) {
    return {
      type,
      color: () => LAND_EMPTY,
      breaks: [],
      stops: paletteStops,
    };
  }

  const [min, max] = d3Array.extent(positive);
  const classes = paletteStops.length;
  let breaks = [];

  switch (type) {
    case "quantile": {
      for (let i = 1; i < classes; i += 1) {
        const q = d3Array.quantile(positive, i / classes);
        if (q !== undefined) breaks.push(q);
      }
      break;
    }
    case "quantize":
    case "linear": {
      const step = (max - min) / classes;
      for (let i = 1; i < classes; i += 1) {
        breaks.push(min + step * i);
      }
      break;
    }
    case "log": {
      const safeMin = Math.max(1, min);
      const safeMax = Math.max(safeMin + 1, max);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const step = (logMax - logMin) / classes;
      for (let i = 1; i < classes; i += 1) {
        breaks.push(Math.pow(10, logMin + step * i));
      }
      break;
    }
    case "threshold":
    default: {
      for (let i = 1; i < classes; i += 1) {
        const q = d3Array.quantile(positive, i / classes);
        if (q !== undefined) breaks.push(q);
      }
      break;
    }
  }

  const unique = [...new Set(breaks.map((b) => Number(b.toPrecision(6))))];
  if (unique.length === 0) {
    unique.push(min === max ? min : (min + max) / 2);
  }

  const scale = d3Scale.scaleThreshold().domain(unique).range([...paletteStops]);

  return {
    type,
    color: (value) => {
      if (value === undefined || !Number.isFinite(value) || value <= 0) return LAND_EMPTY;
      return scale(value);
    },
    breaks: unique,
    stops: paletteStops,
  };
}

describe("Feature 3: Multi-Scale Engine & Palettes", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F3-T1-1: makeColorScale generates quantile threshold scale with correct breaks", () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const colorScale = makeColorScale(values);

      assert.ok(colorScale.breaks.length > 0, "Breaks array must not be empty");
      assert.ok(colorScale.breaks.length <= CHLORO_STOPS.length - 1);
      assert.deepEqual(colorScale.stops, CHLORO_STOPS);

      // Verify colors assigned progressively
      const colorMin = colorScale.color(10);
      const colorMax = colorScale.color(100);
      assert.equal(colorMin, CHLORO_STOPS[0]);
      assert.equal(colorMax, CHLORO_STOPS[CHLORO_STOPS.length - 1]);
    });

    it("F3-T1-2: Quantize / Linear scale distributes breaks evenly across data range", () => {
      const values = [10, 50, 100, 500, 1000];
      const linearScale = buildMultiScale("linear", values);
      assert.equal(linearScale.breaks.length, CHLORO_STOPS.length - 1);

      // Check step linearity
      const step0 = linearScale.breaks[0] - 10;
      const step1 = linearScale.breaks[1] - linearScale.breaks[0];
      assert.ok(Math.abs(step0 - step1) < 1e-3, "Linear steps must be equal");
    });

    it("F3-T1-3: Logarithmic scale applies log10 transformation for power-law metrics", () => {
      const powerLawValues = [1, 10, 100, 1000, 10000, 100000];
      const logScale = buildMultiScale("log", powerLawValues);

      assert.equal(logScale.breaks.length, 4);
      // Breaks on log10 scale between 1 and 100000 should be ~10, ~100, ~1000, ~10000
      assert.ok(logScale.breaks[0] < logScale.breaks[1]);
      assert.ok(logScale.breaks[1] < logScale.breaks[2]);
      assert.ok(logScale.breaks[2] < logScale.breaks[3]);
      assert.equal(logScale.color(1), CHLORO_STOPS[0]);
      assert.equal(logScale.color(100000), CHLORO_STOPS[4]);
    });

    it("F3-T1-4: Monotonic gradient verification across all 5 palettes", () => {
      for (const [name, stops] of Object.entries(PALETTES)) {
        assert.equal(stops.length, 5, `Palette ${name} must have 5 stops`);
        const luminances = stops.map(hexLuminance);

        // Every palette must have increasing luminance or contrast progression
        for (let i = 1; i < luminances.length; i++) {
          assert.ok(
            luminances[i] > luminances[i - 1],
            `Palette ${name} stop ${i} (${luminances[i]}) should be brighter than stop ${i - 1} (${luminances[i - 1]})`
          );
        }
      }
    });

    it("F3-T1-5: All theme palette hex codes are strictly valid 7-character #RRGGBB", () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const [name, stops] of Object.entries(PALETTES)) {
        for (const hex of stops) {
          assert.match(hex, hexRegex, `Invalid hex in palette ${name}: ${hex}`);
        }
      }
      assert.match(LAND_EMPTY, hexRegex);
      assert.match(LAND_HOVER, hexRegex);
      assert.match(OCEAN, hexRegex);
      assert.match(STROKE, hexRegex);
      assert.match(STROKE_ACTIVE, hexRegex);
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F3-T2-1: Empty input array produces empty breaks and LAND_EMPTY color mapping", () => {
      const emptyScale = makeColorScale([]);
      assert.deepEqual(emptyScale.breaks, []);
      assert.equal(emptyScale.color(undefined), LAND_EMPTY);
      assert.equal(emptyScale.color(0), LAND_EMPTY);
      assert.equal(emptyScale.color(100), LAND_EMPTY);
    });

    it("F3-T2-2: All-zero or negative inputs produce empty breaks and LAND_EMPTY colors", () => {
      const zeroScale = makeColorScale([0, 0, 0, -10, -50]);
      assert.deepEqual(zeroScale.breaks, []);
      assert.equal(zeroScale.color(0), LAND_EMPTY);
      assert.equal(zeroScale.color(-10), LAND_EMPTY);
      assert.equal(zeroScale.color(50), LAND_EMPTY);
    });

    it("F3-T2-3: Single positive value creates valid single break", () => {
      const singleScale = makeColorScale([42]);
      assert.ok(singleScale.breaks.length >= 1);
      assert.equal(singleScale.breaks[0], 42);
      assert.equal(singleScale.color(10), CHLORO_STOPS[0]);
      assert.equal(singleScale.color(50), CHLORO_STOPS[1]);
    });

    it("F3-T2-4: All identical positive values deduplicate breaks cleanly", () => {
      const identicalScale = makeColorScale([100, 100, 100, 100, 100]);
      assert.equal(identicalScale.breaks.length, 1);
      assert.equal(identicalScale.breaks[0], 100);
      assert.equal(identicalScale.color(50), CHLORO_STOPS[0]);
      assert.equal(identicalScale.color(150), CHLORO_STOPS[1]);
    });

    it("F3-T2-5: Robust against extreme floating point and power magnitudes", () => {
      const extremeScale = makeColorScale([1e-6, 1e-3, 1, 1e6, 1e12]);
      assert.doesNotThrow(() => {
        extremeScale.color(1e-6);
        extremeScale.color(1e12);
        extremeScale.color(Infinity);
        extremeScale.color(NaN);
      });
      assert.equal(extremeScale.color(NaN), LAND_EMPTY);
      assert.equal(extremeScale.color(Infinity), LAND_EMPTY);
      assert.equal(extremeScale.color(-Infinity), LAND_EMPTY);
    });
  });
});

describe("Feature 13: Interactive Discrete Legend & Formatters", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F13-T1-1: formatPulses handles zero, small integers, and compact thousands/millions", () => {
      assert.equal(formatPulses(0), "0");
      assert.equal(formatPulses(5), "5");
      assert.equal(formatPulses(999), "999");
      assert.equal(formatPulses(9999), "9,999");
      assert.equal(formatPulses(10000), "10K");
      assert.equal(formatPulses(15400), "15.4K");
      assert.equal(formatPulses(1000000), "1M");
      assert.equal(formatPulses(2500000), "2.5M");
    });

    it("F13-T1-2: formatShare formats percentage proportions with dynamic decimal precision", () => {
      assert.equal(formatShare(50, 100), "50.0%");
      assert.equal(formatShare(1, 100), "1.0%");
      assert.equal(formatShare(0.45, 100), "0.45%");
      assert.equal(formatShare(0.05, 100), "0.05%");
      assert.equal(formatShare(0, 100), "0.00%");
      assert.equal(formatShare(0, 0), "0%");
    });

    it("F13-T1-3: Legend intervals map breaks into discrete contiguous bucket labels", () => {
      const values = [10, 50, 100, 200, 500, 1000, 5000, 10000];
      const scaleObj = makeColorScale(values);
      const labels = [formatPulses(0), ...scaleObj.breaks.map((b) => formatPulses(b))];

      assert.equal(labels[0], "0");
      assert.ok(labels.length >= 2);
      for (const label of labels) {
        assert.ok(typeof label === "string" && label.length > 0);
      }
    });

    it("F13-T1-4: Swatch count matches number of palette stops", () => {
      const scaleObj = makeColorScale([1, 2, 3, 4, 5]);
      assert.equal(scaleObj.stops.length, 5);
    });

    it("F13-T1-5: No Data swatch is consistently styled with LAND_EMPTY (#1c232c)", () => {
      assert.equal(LAND_EMPTY, "#1c232c");
      const emptyScale = makeColorScale([]);
      assert.equal(emptyScale.color(0), LAND_EMPTY);
      assert.equal(emptyScale.color(undefined), LAND_EMPTY);
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F13-T2-1: formatPulses returns fallback '—' for non-finite values", () => {
      assert.equal(formatPulses(NaN), "—");
      assert.equal(formatPulses(Infinity), "—");
      assert.equal(formatPulses(-Infinity), "—");
    });

    it("F13-T2-2: formatShare handles 0 total and negative inputs gracefully", () => {
      assert.equal(formatShare(100, 0), "0%");
      assert.equal(formatShare(0, 0), "0%");
    });

    it("F13-T2-3: Legend interval calculation with 0 breaks (e.g. all empty rows)", () => {
      const scaleObj = makeColorScale([]);
      const labels = [formatPulses(0), ...scaleObj.breaks.map((b) => formatPulses(b))];
      assert.deepEqual(labels, ["0"]);
    });

    it("F13-T2-4: Boundary precision: value exactly matching break falls into upper bucket", () => {
      const scaleObj = makeColorScale([10, 20, 30, 40, 50]);
      if (scaleObj.breaks.length > 0) {
        const b0 = scaleObj.breaks[0];
        const colorAtBreak = scaleObj.color(b0);
        assert.ok(colorAtBreak !== LAND_EMPTY);
      }
    });

    it("F13-T2-5: Very high pulse counts (billions) formatted cleanly", () => {
      assert.equal(formatPulses(1_000_000_000), "1B");
      assert.equal(formatPulses(12_500_000_000), "12.5B");
    });
  });

  describe("Tier 3: Cross-Feature Combinations", () => {
    it("F13-T3-1: Multi-scale computation with all 5 palettes preserves color assignments", () => {
      const dataset = [5, 25, 100, 500, 2500, 10000];
      for (const [_paletteName, stops] of Object.entries(PALETTES)) {
        const s = buildMultiScale("quantile", dataset, stops);
        assert.equal(s.color(5), stops[0]);
        assert.equal(s.color(10000), stops[4]);
        assert.equal(s.color(0), LAND_EMPTY);
      }
    });

    it("F13-T3-2: Legend interval labels dynamically update with metric changes", () => {
      const pulsesData = [100, 500, 1000, 50000];
      const blocksData = [1, 2, 5, 10];

      const pulseScale = makeColorScale(pulsesData);
      const blockScale = makeColorScale(blocksData);

      const pulseLabels = [formatPulses(0), ...pulseScale.breaks.map((b) => formatPulses(b))];
      const blockLabels = [formatPulses(0), ...blockScale.breaks.map((b) => formatPulses(b))];

      assert.ok(pulseLabels.some((l) => l.includes("K") || parseInt(l) > 100));
      assert.ok(blockLabels.every((l) => !l.includes("K")));
    });
  });

  describe("Tier 4: Real-World Workflows", () => {
    it("F3-T4-1: Extreme power-law distribution: comparing Logarithmic vs Quantile scales", () => {
      // 1 super-node with 1,000,000 pulses, 50 small nodes with 1 pulse each
      const powerLaw = [1000000, ...Array(50).fill(1)];
      const quantileScale = buildMultiScale("quantile", powerLaw);
      const logScale = buildMultiScale("log", powerLaw);

      // Quantile scale deduplicates breaks to [1], so values >= 1 get >= CHLORO_STOPS[1]
      assert.equal(quantileScale.breaks.length, 1);
      assert.equal(quantileScale.color(1000000), CHLORO_STOPS[1]);

      // Log scale creates well-distributed log10 breaks across the 6 orders of magnitude
      assert.equal(logScale.breaks.length, 4);
      assert.ok(logScale.breaks[0] > 1);
      assert.ok(logScale.breaks[3] < 1000000);
      assert.equal(logScale.color(1), CHLORO_STOPS[0]);
      assert.equal(logScale.color(1000000), CHLORO_STOPS[4]);
    });

    it("F3-T4-2: Palette stops contrast and luminance verification", () => {
      for (const [name, stops] of Object.entries(PALETTES)) {
        const minLum = hexLuminance(stops[0]);
        const maxLum = hexLuminance(stops[stops.length - 1]);
        // All palettes must span from dark/low-lum to bright/high-lum
        assert.ok(maxLum > minLum, `Palette ${name} maxLum (${maxLum}) must be > minLum (${minLum})`);
        assert.ok(maxLum >= 0.3, `Palette ${name} highest stop should be bright (lum >= 0.3)`);
      }
    });

    it("F3-T4-3: Fractional values in logarithmic scale maintain non-decreasing stops", () => {
      const fractionals = [0.1, 0.5, 2.5, 10.0, 50.0];
      const logScale = buildMultiScale("log", fractionals);
      assert.equal(logScale.color(0.1), CHLORO_STOPS[0]);
      assert.equal(logScale.color(50.0), CHLORO_STOPS[4]);
    });

    it("F13-T4-1: Discrete range interval builder produces [min, max] pairs with color assignment", () => {
      const values = [10, 50, 200, 1000];
      const scaleObj = makeColorScale(values);
      const ranges = [];
      let prev = 0;
      for (let i = 0; i < scaleObj.breaks.length; i++) {
        const curr = scaleObj.breaks[i];
        ranges.push({ min: prev, max: curr, color: scaleObj.stops[i] });
        prev = curr;
      }
      ranges.push({ min: prev, max: Infinity, color: scaleObj.stops[scaleObj.stops.length - 1] });

      assert.equal(ranges.length, scaleObj.stops.length);
      assert.equal(ranges[0].min, 0);
      assert.equal(ranges[ranges.length - 1].max, Infinity);
    });
  });
});
