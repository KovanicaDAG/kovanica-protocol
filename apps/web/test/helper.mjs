import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as d3Geo from "d3-geo";
import * as d3Scale from "d3-scale";
import * as d3Array from "d3-array";
import * as topojson from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json" with { type: "json" };
import React from "react";
import { renderToString } from "react-dom/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, "../src");

export const jiti = createJiti(import.meta.url, {
  alias: {
    "@": srcPath,
  },
  transform: (opts) => {
    const res = ts.transpileModule(opts.source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    return { code: res.outputText };
  },
});

// Load Geo Libs
export const catalog = jiti("../src/lib/geo/catalog.ts");
export const scale = jiti("../src/lib/geo/scale.ts");
export const metrics = jiti("../src/lib/geo/metrics.ts");
export const infer = jiti("../src/lib/geo/infer-origin.ts");

// Load UI Components
export const worldChoroplethModule = jiti("../src/components/map/world-choropleth.tsx");
export const legendModule = jiti("../src/components/map/legend.tsx");
export const zoomControlsModule = jiti("../src/components/map/zoom-controls.tsx");
export const rankingModule = jiti("../src/components/map/ranking.tsx");
export const countryPanelModule = jiti("../src/components/map/country-panel.tsx");
export const originDagModule = jiti("../src/components/map/origin-dag.tsx");
export const regionBarsModule = jiti("../src/components/map/region-bars.tsx");
export const metricSwitcherModule = jiti("../src/components/map/metric-switcher.tsx");

export {
  d3Geo,
  d3Scale,
  d3Array,
  topojson,
  worldAtlas,
  React,
  renderToString,
};
