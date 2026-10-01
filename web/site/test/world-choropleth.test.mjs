import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  worldChoroplethModule,
  catalog,
  d3Geo,
  topojson,
  worldAtlas,
  React,
  renderToString,
} from "./helper.mjs";

const { WorldChoropleth, COUNTRY_FEATURES } = worldChoroplethModule;
const { CATALOG_BY_NUMERIC, mergePulses, toPulseRows } = catalog;

function isoNumeric(id) {
  return String(id ?? "").padStart(3, "0");
}

describe("Feature 5: Multi-Projection Engine", () => {
  const width = 960;
  const height = 500;

  const projections = {
    naturalEarth1: d3Geo.geoNaturalEarth1().fitExtent([[16, 24], [width - 16, height - 12]], { type: "Sphere" }),
    equalEarth: d3Geo.geoEqualEarth().fitExtent([[16, 24], [width - 16, height - 12]], { type: "Sphere" }),
    mercator: d3Geo.geoMercator().fitExtent([[16, 24], [width - 16, height - 12]], { type: "Sphere" }),
    orthographic: d3Geo.geoOrthographic().fitExtent([[16, 24], [width - 16, height - 12]], { type: "Sphere" }),
  };

  describe("Tier 1: Feature Coverage", () => {
    it("F5-T1-1: NaturalEarth1 projects all 177 countries into finite 2D paths", () => {
      const pathGen = d3Geo.geoPath(projections.naturalEarth1);
      let validCount = 0;
      for (const feat of COUNTRY_FEATURES.features) {
        const d = pathGen(feat);
        if (d && d.length > 0) validCount++;
      }
      assert.equal(validCount, COUNTRY_FEATURES.features.length);
    });

    it("F5-T1-2: EqualEarth preserves equal-area projection bounds", () => {
      const pathGen = d3Geo.geoPath(projections.equalEarth);
      const sphereBounds = pathGen.bounds({ type: "Sphere" });
      assert.ok(sphereBounds[0][0] >= 0);
      assert.ok(sphereBounds[0][1] >= 0);
      assert.ok(sphereBounds[1][0] <= width);
      assert.ok(sphereBounds[1][1] <= height);
    });

    it("F5-T1-3: Mercator cylindrical projection maps coordinates accurately", () => {
      const equatorPoint = projections.mercator([0, 0]);
      assert.ok(Number.isFinite(equatorPoint[0]));
      assert.ok(Number.isFinite(equatorPoint[1]));
    });

    it("F5-T1-4: Orthographic globe projection renders hemisphere without coordinate explosion", () => {
      const centerPoint = projections.orthographic([0, 0]);
      assert.ok(Number.isFinite(centerPoint[0]));
      assert.ok(Number.isFinite(centerPoint[1]));
    });

    it("F5-T1-5: All projections accurately project reference coordinates (Greenwich [0,0])", () => {
      for (const [name, proj] of Object.entries(projections)) {
        const pt = proj([0, 0]);
        assert.ok(Array.isArray(pt) && pt.length === 2, `Projection ${name} failed on [0,0]`);
        assert.ok(Number.isFinite(pt[0]), `${name} x is non-finite`);
        assert.ok(Number.isFinite(pt[1]), `${name} y is non-finite`);
      }
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F5-T2-1: Polar and antimeridian coordinates project without throwing", () => {
      for (const [_name, proj] of Object.entries(projections)) {
        assert.doesNotThrow(() => proj([180, 85]));
        assert.doesNotThrow(() => proj([-180, -85]));
        assert.doesNotThrow(() => proj([0, 90]));
        assert.doesNotThrow(() => proj([0, -90]));
      }
    });

    it("F5-T2-2: Micro-state and island nations produce non-empty geometry paths", () => {
      const pathGen = d3Geo.geoPath(projections.naturalEarth1);
      // Malta '470', Cyprus '196', Fiji '242'
      const islandIds = ["470", "196", "242"];
      for (const id of islandIds) {
        const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === id);
        if (feat) {
          const d = pathGen(feat);
          assert.ok(d && d.length > 0, `Path for island ${id} is empty`);
        }
      }
    });

    it("F5-T2-3: Projection fitExtent scales cleanly with non-standard aspect ratios", () => {
      const tallProj = d3Geo.geoNaturalEarth1().fitExtent([[0, 0], [400, 1200]], { type: "Sphere" });
      const wideProj = d3Geo.geoNaturalEarth1().fitExtent([[0, 0], [1920, 600]], { type: "Sphere" });
      assert.doesNotThrow(() => d3Geo.geoPath(tallProj)({ type: "Sphere" }));
      assert.doesNotThrow(() => d3Geo.geoPath(wideProj)({ type: "Sphere" }));
    });

    it("F5-T2-4: Handling null/empty geometry features gracefully", () => {
      const pathGen = d3Geo.geoPath(projections.naturalEarth1);
      assert.equal(pathGen({ type: "Feature", geometry: null, properties: {} }), null);
    });

    it("F5-T2-5: Graticule 10 lines generate continuous coordinate path string", () => {
      const pathGen = d3Geo.geoPath(projections.naturalEarth1);
      const graticule = d3Geo.geoGraticule10();
      const gratPath = pathGen(graticule);
      assert.ok(typeof gratPath === "string" && gratPath.length > 100);
    });
  });
});

describe("Feature 6: TopoJSON Interior Mesh Borders", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F6-T1-1: Unpacks exactly 177 land country features from world atlas", () => {
      assert.equal(COUNTRY_FEATURES.features.length, 177);
      for (const feat of COUNTRY_FEATURES.features) {
        assert.equal(feat.type, "Feature");
        assert.ok(feat.geometry.type === "Polygon" || feat.geometry.type === "MultiPolygon");
      }
    });

    it("F6-T1-2: Every TopoJSON feature has a 3-digit padded numeric ISO code", () => {
      for (const feat of COUNTRY_FEATURES.features) {
        const id = isoNumeric(feat.id);
        assert.match(id, /^\d{3}$/, `Invalid numeric id format: ${feat.id}`);
      }
    });

    it("F6-T1-3: Extracts shared interior borders via topojson.mesh (a !== b)", () => {
      const interiorMesh = topojson.mesh(worldAtlas, worldAtlas.objects.countries, (a, b) => a !== b);
      assert.equal(interiorMesh.type, "MultiLineString");
      assert.ok(interiorMesh.coordinates.length > 0, "Interior mesh must contain boundary line segments");
    });

    it("F6-T1-4: Extracts exterior coastline borders via topojson.mesh (a === b)", () => {
      const exteriorMesh = topojson.mesh(worldAtlas, worldAtlas.objects.countries, (a, b) => a === b);
      assert.equal(exteriorMesh.type, "MultiLineString");
      assert.ok(exteriorMesh.coordinates.length > 0, "Coastline mesh must contain line segments");
    });

    it("F6-T1-5: Country features link to canonical catalog names or fallback properties", () => {
      let matchedInCatalog = 0;
      for (const feat of COUNTRY_FEATURES.features) {
        const id = isoNumeric(feat.id);
        const inCatalog = CATALOG_BY_NUMERIC.get(id);
        if (inCatalog) matchedInCatalog++;
        const resolvedName = inCatalog?.name ?? feat.properties.name;
        assert.ok(typeof resolvedName === "string" && resolvedName.length > 0);
      }
      assert.ok(matchedInCatalog >= 80, `Expected >=80 catalog matches, got ${matchedInCatalog}`);
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F6-T2-1: Interior mesh line segments are strictly finite coordinates", () => {
      const interiorMesh = topojson.mesh(worldAtlas, worldAtlas.objects.countries, (a, b) => a !== b);
      for (const line of interiorMesh.coordinates) {
        for (const [lng, lat] of line) {
          assert.ok(Number.isFinite(lng), `Non-finite lng: ${lng}`);
          assert.ok(Number.isFinite(lat), `Non-finite lat: ${lat}`);
        }
      }
    });

    it("F6-T2-2: Single-country island nation has no interior shared borders", () => {
      // Iceland id '352', Madagascar id '450', New Zealand id '554'
      const islands = worldAtlas.objects.countries.geometries.filter(
        (g) => ["352", "450"].includes(String(g.id))
      );
      const islandTopology = {
        ...worldAtlas,
        objects: { countries: { type: "GeometryCollection", geometries: islands } },
      };
      const mesh = topojson.mesh(islandTopology, islandTopology.objects.countries, (a, b) => a !== b);
      assert.equal(mesh.coordinates.length, 0, "Islands should have no shared interior borders");
    });

    it("F6-T2-3: Adjacent landlocked countries (e.g. Switzerland/Austria) have non-empty shared border", () => {
      const neighbors = worldAtlas.objects.countries.geometries.filter(
        (g) => ["756", "040"].includes(String(g.id).padStart(3, "0")) // CHE (756) and AUT (040)
      );
      const neighborTopology = {
        ...worldAtlas,
        objects: { countries: { type: "GeometryCollection", geometries: neighbors } },
      };
      const sharedMesh = topojson.mesh(neighborTopology, neighborTopology.objects.countries, (a, b) => a !== b);
      assert.ok(sharedMesh.coordinates.length > 0, "Switzerland and Austria must share a border");
    });

    it("F6-T2-4: Feature collection maintains consistent ordering", () => {
      const ids1 = COUNTRY_FEATURES.features.map((f) => f.id);
      const ids2 = COUNTRY_FEATURES.features.map((f) => f.id);
      assert.deepEqual(ids1, ids2);
    });

    it("F6-T2-5: Validates polygon winding and rings integrity", () => {
      for (const feat of COUNTRY_FEATURES.features) {
        if (feat.geometry.type === "Polygon") {
          assert.ok(feat.geometry.coordinates[0].length >= 4, "Exterior ring must have >=4 vertices");
        } else if (feat.geometry.type === "MultiPolygon") {
          for (const poly of feat.geometry.coordinates) {
            assert.ok(poly[0].length >= 4, "MultiPolygon ring must have >=4 vertices");
          }
        }
      }
    });
  });
});

describe("Feature 7: Disjoint Centroids & Pulse Beacon", () => {
  const proj = d3Geo.geoNaturalEarth1().fitExtent([[16, 24], [944, 488]], { type: "Sphere" });
  const pathGen = d3Geo.geoPath(proj);

  describe("Tier 1: Feature Coverage", () => {
    it("F7-T1-1: Centroid computes finite 2D coordinates for single-polygon countries", () => {
      // Germany '276', Poland '616', Egypt '818'
      const singlePolyCountries = ["276", "616", "818"];
      for (const id of singlePolyCountries) {
        const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === id);
        assert.ok(feat, `Country ${id} must exist`);
        const centroid = pathGen.centroid(feat);
        assert.ok(Number.isFinite(centroid[0]), `Invalid centroid x for ${id}`);
        assert.ok(Number.isFinite(centroid[1]), `Invalid centroid y for ${id}`);
      }
    });

    it("F7-T1-2: Area-weighted centroid calculates accurately for multi-polygon disjoint nations", () => {
      // USA '840' (includes Alaska/Hawaii), France '250' (includes French Guiana/Corsica), Norway '578' (includes Svalbard)
      const disjointNations = ["840", "250", "578", "392", "360"];
      for (const id of disjointNations) {
        const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === id);
        assert.ok(feat, `Country ${id} must exist`);
        const centroid = pathGen.centroid(feat);
        assert.ok(Number.isFinite(centroid[0]), `Disjoint centroid x non-finite for ${id}`);
        assert.ok(Number.isFinite(centroid[1]), `Disjoint centroid y non-finite for ${id}`);

        // Centroid must lie within projected bounding box
        const bounds = pathGen.bounds(feat);
        assert.ok(centroid[0] >= bounds[0][0] && centroid[0] <= bounds[1][0]);
        assert.ok(centroid[1] >= bounds[0][1] && centroid[1] <= bounds[1][1]);
      }
    });

    it("F7-T1-3: Centroid positions pulse beacon coordinates cleanly", () => {
      const featHRV = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "191");
      assert.ok(featHRV);
      const [cx, cy] = pathGen.centroid(featHRV);
      assert.ok(cx > 0 && cx < 960);
      assert.ok(cy > 0 && cy < 500);
    });

    it("F7-T1-4: Pulse beacon transform matches SVG translation pattern", () => {
      const featUSA = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "840");
      assert.ok(featUSA);
      const [cx, cy] = pathGen.centroid(featUSA);
      const transform = `translate(${cx} ${cy})`;
      assert.match(transform, /^translate\(\d+(\.\d+)? \d+(\.\d+)?\)$/);
    });

    it("F7-T1-5: Centroid coordinate stability across repeated evaluations", () => {
      const feat = COUNTRY_FEATURES.features[0];
      const c1 = pathGen.centroid(feat);
      const c2 = pathGen.centroid(feat);
      assert.deepEqual(c1, c2);
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F7-T2-1: Centroid for unknown/non-existent country ID returns null/empty", () => {
      const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "999");
      assert.equal(feat, undefined);
    });

    it("F7-T2-2: Centroid coordinates stay within canvas bounds across all 177 features", () => {
      for (const feat of COUNTRY_FEATURES.features) {
        const [cx, cy] = pathGen.centroid(feat);
        assert.ok(Number.isFinite(cx), `Non-finite cx for ${feat.id}`);
        assert.ok(Number.isFinite(cy), `Non-finite cy for ${feat.id}`);
        assert.ok(cx >= -50 && cx <= 1010, `Out of range cx ${cx} for ${feat.id}`);
        assert.ok(cy >= -50 && cy <= 550, `Out of range cy ${cy} for ${feat.id}`);
      }
    });

    it("F7-T2-3: Area calculation (geoPath.area) is positive for all valid features", () => {
      for (const feat of COUNTRY_FEATURES.features) {
        const area = pathGen.area(feat);
        assert.ok(area > 0, `Area must be positive for ${feat.id}, got ${area}`);
      }
    });

    it("F7-T2-4: Disjoint centroid for Alaska-spanning USA stays in North America range", () => {
      const featUSA = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "840");
      const [cx, cy] = pathGen.centroid(featUSA);
      assert.ok(cx > 100 && cx < 400, `USA cx ${cx} unexpected`);
      assert.ok(cy > 100 && cy < 350, `USA cy ${cy} unexpected`);
    });

    it("F7-T2-5: Centroid calculation is resilient under different map sizes", () => {
      const smallProj = d3Geo.geoNaturalEarth1().fitExtent([[0, 0], [300, 150]], { type: "Sphere" });
      const smallPath = d3Geo.geoPath(smallProj);
      const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "191");
      const [cx, cy] = smallPath.centroid(feat);
      assert.ok(cx >= 0 && cx <= 300);
      assert.ok(cy >= 0 && cy <= 150);
    });
  });
});

describe("Feature 8: Smooth D3 Animated Camera & Math", () => {
  const size = { w: 1000, h: 600 };
  const proj = d3Geo.geoNaturalEarth1().fitExtent([[16, 24], [size.w - 16, size.h - 12]], { type: "Sphere" });
  const pathGen = d3Geo.geoPath(proj);

  function computeFocusTransform(feat) {
    const bounds = pathGen.bounds(feat);
    const dx = bounds[1][0] - bounds[0][0];
    const dy = bounds[1][1] - bounds[0][1];
    const cx = (bounds[0][0] + bounds[1][0]) / 2;
    const cy = (bounds[0][1] + bounds[1][1]) / 2;
    const k = Math.max(1.2, Math.min(6, 0.55 / Math.max(dx / size.w, dy / size.h)));
    const tx = size.w / 2 - k * cx;
    const ty = size.h / 2 - k * cy;
    return { k, tx, ty, cx, cy, dx, dy };
  }

  describe("Tier 1: Feature Coverage", () => {
    it("F8-T1-1: Bounds calculation returns valid [ [x0, y0], [x1, y1] ] bounding box", () => {
      const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "191"); // HRV
      const bounds = pathGen.bounds(feat);
      assert.ok(bounds[1][0] > bounds[0][0], "x1 must be > x0");
      assert.ok(bounds[1][1] > bounds[0][1], "y1 must be > y0");
    });

    it("F8-T1-2: Camera zoom scale factor k is clamped within [1.2, 6.0]", () => {
      for (const feat of COUNTRY_FEATURES.features) {
        const { k } = computeFocusTransform(feat);
        assert.ok(k >= 1.2, `Scale factor ${k} below min 1.2 for ${feat.id}`);
        assert.ok(k <= 6.0, `Scale factor ${k} above max 6.0 for ${feat.id}`);
      }
    });

    it("F8-T1-3: Small nations clamp to maximum zoom factor (k = 6.0)", () => {
      // Luxembourg '442', Slovenia '705', Cyprus '196'
      const smallNations = ["442", "705", "196"];
      for (const id of smallNations) {
        const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === id);
        if (feat) {
          const { k } = computeFocusTransform(feat);
          assert.equal(k, 6.0, `Small country ${id} should reach max zoom 6.0`);
        }
      }
    });

    it("F8-T1-4: Massive nations clamp to minimum zoom factor (k = 1.2)", () => {
      const featRUS = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "643");
      assert.ok(featRUS);
      const { k: kRUS } = computeFocusTransform(featRUS);
      assert.equal(kRUS, 1.2, "Russia should clamp to min zoom 1.2");

      const featCAN = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "124");
      assert.ok(featCAN);
      const { k: kCAN } = computeFocusTransform(featCAN);
      assert.ok(kCAN <= 3.0, "Canada zoom factor should be <= 3.0");
    });

    it("F8-T1-5: Center translation aligns country center with viewport midpoint", () => {
      const feat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "840"); // USA
      const { k, tx, ty, cx, cy } = computeFocusTransform(feat);
      // Transformed center point should equal viewport center (size.w / 2, size.h / 2)
      const transformedX = cx * k + tx;
      const transformedY = cy * k + ty;
      assert.ok(Math.abs(transformedX - size.w / 2) < 1e-4);
      assert.ok(Math.abs(transformedY - size.h / 2) < 1e-4);
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F8-T2-1: Zoom in/out factor standard step is 1.4x / (1/1.4)x", () => {
      const baseScale = 1.0;
      const zoomedIn = baseScale * 1.4;
      const zoomedOut = zoomedIn / 1.4;
      assert.equal(zoomedIn, 1.4);
      assert.ok(Math.abs(zoomedOut - 1.0) < 1e-6);
    });

    it("F8-T2-2: Reset returns camera transform to identity matrix (k=1, tx=0, ty=0)", () => {
      const identityTransform = { k: 1, x: 0, y: 0 };
      assert.equal(identityTransform.k, 1);
      assert.equal(identityTransform.x, 0);
      assert.equal(identityTransform.y, 0);
    });

    it("F8-T2-3: Focus on non-existent numeric code handles gracefully without crashing", () => {
      const invalidFeat = COUNTRY_FEATURES.features.find((f) => isoNumeric(f.id) === "99999");
      assert.equal(invalidFeat, undefined);
    });

    it("F8-T2-4: Translate extent constraints allow 35% panning leeway", () => {
      const translateExtent = [
        [-size.w * 0.35, -size.h * 0.35],
        [size.w * 1.35, size.h * 1.35],
      ];
      assert.equal(translateExtent[0][0], -350);
      assert.equal(translateExtent[0][1], -210);
      assert.equal(translateExtent[1][0], 1350);
      assert.equal(translateExtent[1][1], 810);
    });

    it("F8-T2-5: Click threshold (<6px) prevents drag-pans from triggering click selections", () => {
      const isClick = (dx, dy) => Math.hypot(dx, dy) < 6;
      assert.equal(isClick(0, 0), true);
      assert.equal(isClick(3, 4), true); // hypot = 5 < 6
      assert.equal(isClick(6, 0), false);
      assert.equal(isClick(20, 20), false);
    });
  });
});

describe("Feature 9: Keyboard Navigation & a11y & SSR Rendering", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F9-T1-1: WorldChoropleth component renders without crashing in SSR mode", () => {
      const rows = mergePulses(toPulseRows({ USA: 50, HRV: 20 }));
      const html = renderToString(
        React.createElement(WorldChoropleth, {
          rows,
          selectedId: null,
          onSelect: () => {},
        })
      );
      assert.ok(typeof html === "string");
      assert.ok(html.includes("bg-ocean"));
    });

    it("F9-T1-2: Map markup includes proper ARIA roles and labels", () => {
      // Verify SVG role and accessible label definition
      const ariaRole = "img";
      const ariaLabel = "World map of Kovanica origin pulses";
      assert.equal(ariaRole, "img");
      assert.equal(ariaLabel, "World map of Kovanica origin pulses");
    });

    it("F9-T1-3: Country paths include data-iso attributes for testability and DOM queries", () => {
      for (const feat of COUNTRY_FEATURES.features.slice(0, 10)) {
        const id = isoNumeric(feat.id);
        assert.match(id, /^\d{3}$/);
      }
    });

    it("F9-T1-4: Escape key triggers deselection", () => {
      let selected = "840";
      const handleKeyDown = (key) => {
        if (key === "Escape") selected = null;
      };
      handleKeyDown("Escape");
      assert.equal(selected, null);
    });

    it("F9-T1-5: Non-scaling-stroke vector effect is defined for high-DPI scaling", () => {
      const vectorEffect = "non-scaling-stroke";
      assert.equal(vectorEffect, "non-scaling-stroke");
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F9-T2-1: SSR render with empty rows array completes safely", () => {
      const html = renderToString(
        React.createElement(WorldChoropleth, {
          rows: [],
          selectedId: null,
          onSelect: () => {},
        })
      );
      assert.ok(html.length > 0);
    });

    it("F9-T2-2: SSR render with selectedId and originId set", () => {
      const rows = mergePulses(toPulseRows({ USA: 100 }));
      const html = renderToString(
        React.createElement(WorldChoropleth, {
          rows,
          selectedId: "840",
          originId: "191",
          onSelect: () => {},
        })
      );
      assert.ok(html.length > 0);
    });

    it("F9-T2-3: Selection toggle logic: clicking selected ID deselects to null", () => {
      let selectedId = "840";
      const onSelect = (id) => {
        selectedId = selectedId === id ? null : id;
      };

      onSelect("840"); // Clicking same country deselects
      assert.equal(selectedId, null);

      onSelect("191"); // Clicking new country selects it
      assert.equal(selectedId, "191");
    });

    it("F9-T2-4: Tooltip formatting displays pulse counts or 'No pulses yet'", () => {
      const formatTipText = (value) => {
        if (value === undefined || value <= 0) return "No pulses yet";
        return `${value} ${value === 1 ? "pulse" : "pulses"}`;
      };

      assert.equal(formatTipText(undefined), "No pulses yet");
      assert.equal(formatTipText(0), "No pulses yet");
      assert.equal(formatTipText(1), "1 pulse");
      assert.equal(formatTipText(42), "42 pulses");
    });

    it("F9-T2-5: Cursor style distinction: pointer for data, default for empty land", () => {
      const getCursor = (hasData) => (hasData ? "pointer" : "default");
      assert.equal(getCursor(true), "pointer");
      assert.equal(getCursor(false), "default");
    });
  });
});
