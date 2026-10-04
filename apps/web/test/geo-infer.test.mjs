import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  infer,
  catalog,
} from "./helper.mjs";

const { inferOrigin } = infer;
const { CATALOG_BY_ISO3, mergePulses, toPulseRows, totals, rankOf } = catalog;

describe("Feature 4: Origin Inference Synchronization", () => {
  // Store global references to restore after mocking
  const originalIntl = globalThis.Intl;
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    globalThis.Intl = originalIntl;
    if (originalNavigator !== undefined) {
      globalThis.navigator = originalNavigator;
    } else {
      delete globalThis.navigator;
    }
  });

  function mockEnvironment({ timeZone, language, throwIntl = false }) {
    if (throwIntl) {
      globalThis.Intl = {
        DateTimeFormat: () => {
          throw new Error("Intl access disabled for privacy");
        },
      };
    } else if (timeZone !== undefined) {
      globalThis.Intl = {
        DateTimeFormat: () => ({
          resolvedOptions: () => ({ timeZone }),
        }),
      };
    }

    if (language !== undefined) {
      globalThis.navigator = { language };
    }
  }

  describe("Tier 1: Feature Coverage", () => {
    it("F4-T1-1: Resolves European IANA timezones to canonical catalog origins", () => {
      const zones = [
        { tz: "Europe/Zagreb", expectedIso3: "HRV", expectedName: "Croatia" },
        { tz: "Europe/Berlin", expectedIso3: "DEU", expectedName: "Germany" },
        { tz: "Europe/Paris", expectedIso3: "FRA", expectedName: "France" },
        { tz: "Europe/London", expectedIso3: "GBR", expectedName: "United Kingdom" },
        { tz: "Europe/Rome", expectedIso3: "ITA", expectedName: "Italy" },
        { tz: "Europe/Madrid", expectedIso3: "ESP", expectedName: "Spain" },
        { tz: "Europe/Stockholm", expectedIso3: "SWE", expectedName: "Sweden" },
        { tz: "Europe/Warsaw", expectedIso3: "POL", expectedName: "Poland" },
      ];

      for (const { tz, expectedIso3, expectedName } of zones) {
        mockEnvironment({ timeZone: tz });
        const origin = inferOrigin();
        assert.ok(origin, `Failed to infer origin for timezone ${tz}`);
        assert.equal(origin.iso3, expectedIso3);
        assert.equal(origin.name, expectedName);
      }
    });

    it("F4-T1-2: Resolves Americas IANA timezones to canonical catalog origins", () => {
      const zones = [
        { tz: "America/New_York", expectedIso3: "USA", expectedName: "United States" },
        { tz: "America/Los_Angeles", expectedIso3: "USA", expectedName: "United States" },
        { tz: "America/Toronto", expectedIso3: "CAN", expectedName: "Canada" },
        { tz: "America/Sao_Paulo", expectedIso3: "BRA", expectedName: "Brazil" },
        { tz: "America/Mexico_City", expectedIso3: "MEX", expectedName: "Mexico" },
        { tz: "America/Buenos_Aires", expectedIso3: "ARG", expectedName: "Argentina" },
        { tz: "America/Bogota", expectedIso3: "COL", expectedName: "Colombia" },
        { tz: "America/Santiago", expectedIso3: "CHL", expectedName: "Chile" },
      ];

      for (const { tz, expectedIso3, expectedName } of zones) {
        mockEnvironment({ timeZone: tz });
        const origin = inferOrigin();
        assert.ok(origin, `Failed to infer origin for timezone ${tz}`);
        assert.equal(origin.iso3, expectedIso3);
        assert.equal(origin.name, expectedName);
      }
    });

    it("F4-T1-3: Resolves Asia-Pacific IANA timezones to canonical catalog origins", () => {
      const zones = [
        { tz: "Asia/Tokyo", expectedIso3: "JPN", expectedName: "Japan" },
        { tz: "Asia/Seoul", expectedIso3: "KOR", expectedName: "South Korea" },
        { tz: "Asia/Kolkata", expectedIso3: "IND", expectedName: "India" },
        { tz: "Asia/Shanghai", expectedIso3: "CHN", expectedName: "China" },
        { tz: "Asia/Singapore", expectedIso3: "MYS", expectedName: "Malaysia" },
        { tz: "Australia/Sydney", expectedIso3: "AUS", expectedName: "Australia" },
        { tz: "Pacific/Auckland", expectedIso3: "NZL", expectedName: "New Zealand" },
        { tz: "Asia/Jakarta", expectedIso3: "IDN", expectedName: "Indonesia" },
      ];

      for (const { tz, expectedIso3, expectedName } of zones) {
        mockEnvironment({ timeZone: tz });
        const origin = inferOrigin();
        assert.ok(origin, `Failed to infer origin for timezone ${tz}`);
        assert.equal(origin.iso3, expectedIso3);
        assert.equal(origin.name, expectedName);
      }
    });

    it("F4-T1-4: Resolves Middle East & Africa IANA timezones to canonical origins", () => {
      const zones = [
        { tz: "Africa/Cairo", expectedIso3: "EGY", expectedName: "Egypt" },
        { tz: "Africa/Lagos", expectedIso3: "NGA", expectedName: "Nigeria" },
        { tz: "Africa/Johannesburg", expectedIso3: "ZAF", expectedName: "South Africa" },
        { tz: "Africa/Nairobi", expectedIso3: "KEN", expectedName: "Kenya" },
        { tz: "Asia/Dubai", expectedIso3: "ARE", expectedName: "United Arab Emirates" },
        { tz: "Asia/Riyadh", expectedIso3: "SAU", expectedName: "Saudi Arabia" },
        { tz: "Asia/Jerusalem", expectedIso3: "ISR", expectedName: "Israel" },
        { tz: "Africa/Casablanca", expectedIso3: "MAR", expectedName: "Morocco" },
      ];

      for (const { tz, expectedIso3, expectedName } of zones) {
        mockEnvironment({ timeZone: tz });
        const origin = inferOrigin();
        assert.ok(origin, `Failed to infer origin for timezone ${tz}`);
        assert.equal(origin.iso3, expectedIso3);
        assert.equal(origin.name, expectedName);
      }
    });

    it("F4-T1-5: Canonical catalog alignment: every inferred origin exists in CATALOG_BY_ISO3", () => {
      const testZones = [
        "Europe/Zagreb",
        "America/Chicago",
        "Asia/Taipei",
        "Australia/Melbourne",
        "Europe/Helsinki",
      ];
      for (const tz of testZones) {
        mockEnvironment({ timeZone: tz });
        const origin = inferOrigin();
        assert.ok(origin);
        const catalogEntry = CATALOG_BY_ISO3.get(origin.iso3);
        assert.ok(catalogEntry, `Origin ${origin.iso3} must exist in CATALOG_BY_ISO3`);
        assert.equal(catalogEntry.name, origin.name);
      }
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F4-T2-1: Falls back to navigator.language when timezone is generic/unknown", () => {
      mockEnvironment({ timeZone: "UTC", language: "hr-HR" });
      const origin = inferOrigin();
      assert.ok(origin);
      assert.equal(origin.iso3, "HRV");
      assert.equal(origin.name, "Croatia");
    });

    it("F4-T2-2: Falls back to navigator.language when Intl.DateTimeFormat throws", () => {
      mockEnvironment({ throwIntl: true, language: "en-US" });
      const origin = inferOrigin();
      assert.ok(origin);
      assert.equal(origin.iso3, "USA");
      assert.equal(origin.name, "United States");
    });

    it("F4-T2-3: Handles ambiguous and alias timezone identifiers consistently", () => {
      // Kyiv vs Kiev
      mockEnvironment({ timeZone: "Europe/Kyiv" });
      assert.equal(inferOrigin()?.iso3, "UKR");
      mockEnvironment({ timeZone: "Europe/Kiev" });
      assert.equal(inferOrigin()?.iso3, "UKR");

      // Kolkata vs Calcutta
      mockEnvironment({ timeZone: "Asia/Kolkata" });
      assert.equal(inferOrigin()?.iso3, "IND");
      mockEnvironment({ timeZone: "Asia/Calcutta" });
      assert.equal(inferOrigin()?.iso3, "IND");

      // Buenos Aires variations
      mockEnvironment({ timeZone: "America/Buenos_Aires" });
      assert.equal(inferOrigin()?.iso3, "ARG");
      mockEnvironment({ timeZone: "America/Argentina/Buenos_Aires" });
      assert.equal(inferOrigin()?.iso3, "ARG");
    });

    it("F4-T2-4: Returns null gracefully when both timezone and locale are unknown", () => {
      mockEnvironment({ timeZone: "Etc/Unknown", language: "xx-YY" });
      const origin = inferOrigin();
      assert.equal(origin, null);
    });

    it("F4-T2-5: Returns null gracefully when navigator is undefined in headless SSR environment", () => {
      globalThis.Intl = {
        DateTimeFormat: () => ({
          resolvedOptions: () => ({ timeZone: "Unknown/Timezone" }),
        }),
      };
      delete globalThis.navigator;

      const origin = inferOrigin();
      assert.equal(origin, null);
    });

    it("F4-T2-6: Handles browser locales with lowercase or diverse formatting", () => {
      mockEnvironment({ timeZone: "UTC", language: "de-de" });
      assert.equal(inferOrigin()?.iso3, "DEU");

      mockEnvironment({ timeZone: "UTC", language: "ja-JP" });
      assert.equal(inferOrigin()?.iso3, "JPN");

      mockEnvironment({ timeZone: "UTC", language: "pt-BR" });
      assert.equal(inferOrigin()?.iso3, "BRA");

      mockEnvironment({ timeZone: "UTC", language: "zh-CN" });
      assert.equal(inferOrigin()?.iso3, "CHN");

      mockEnvironment({ timeZone: "UTC", language: "zh-TW" });
      assert.equal(inferOrigin()?.iso3, "TWN");

      mockEnvironment({ timeZone: "UTC", language: "ar-EG" });
      assert.equal(inferOrigin()?.iso3, "EGY");
    });

    it("F4-T2-7: Resolves Nordic, Baltic, and Balkan specialized timezones", () => {
      const specialized = [
        { tz: "Atlantic/Reykjavik", expectedIso3: "ISL" },
        { tz: "Europe/Tallinn", expectedIso3: "EST" },
        { tz: "Europe/Riga", expectedIso3: "LVA" },
        { tz: "Europe/Vilnius", expectedIso3: "LTU" },
        { tz: "Europe/Sarajevo", expectedIso3: "BIH" },
        { tz: "Europe/Skopje", expectedIso3: "MKD" },
        { tz: "Europe/Ljubljana", expectedIso3: "SVN" },
      ];
      for (const { tz, expectedIso3 } of specialized) {
        mockEnvironment({ timeZone: tz });
        assert.equal(inferOrigin()?.iso3, expectedIso3, `Failed on ${tz}`);
      }
    });

    it("F4-T2-8: Resolves Central American and Caribbean timezones", () => {
      const centralAmericas = [
        { tz: "America/Costa_Rica", expectedIso3: "CRI" },
        { tz: "America/Guatemala", expectedIso3: "GTM" },
        { tz: "America/Panama", expectedIso3: "PAN" },
        { tz: "America/Puerto_Rico", expectedIso3: "USA" },
      ];
      for (const { tz, expectedIso3 } of centralAmericas) {
        mockEnvironment({ timeZone: tz });
        assert.equal(inferOrigin()?.iso3, expectedIso3, `Failed on ${tz}`);
      }
    });
  });

  describe("Tier 3: Cross-Feature Combinations", () => {
    it("F4-T3-1: Inferred origin triggers catalog numeric lookup and country selection", () => {
      mockEnvironment({ timeZone: "Europe/Zagreb" });
      const origin = inferOrigin();
      assert.ok(origin);

      const catalogMeta = CATALOG_BY_ISO3.get(origin.iso3);
      assert.ok(catalogMeta);
      assert.equal(catalogMeta.isoNumeric, "191");
      assert.equal(catalogMeta.region, "Europe");
    });

    it("F4-T3-2: Inferred origin records pulse and recalculates leaderboard ranking", () => {
      mockEnvironment({ timeZone: "Europe/Berlin" });
      const origin = inferOrigin();
      assert.ok(origin);

      // Initial state
      const initialPulses = { USA: 100, DEU: 50, HRV: 20 };
      let rows = mergePulses(toPulseRows(initialPulses));
      assert.equal(rankOf(rows, "DEU"), 2);

      // User pulses their origin (DEU + 60)
      const updatedPulses = { ...initialPulses, DEU: initialPulses.DEU + 60 };
      rows = mergePulses(toPulseRows(updatedPulses));
      assert.equal(rankOf(rows, "DEU"), 1); // DEU now has 110, overtaking USA
      assert.equal(totals(rows), 230);
    });
  });

  describe("Tier 4: Real-World Workflows", () => {
    it("F4-T4-1: Workflow: Visitor lands from Zagreb, infers HRV, pulses origin, updates global DAG", () => {
      mockEnvironment({ timeZone: "Europe/Zagreb" });
      const origin = inferOrigin();
      assert.ok(origin);
      assert.equal(origin.iso3, "HRV");
      assert.equal(origin.name, "Croatia");

      // Verify CountryMeta
      const meta = CATALOG_BY_ISO3.get(origin.iso3);
      assert.equal(meta?.isoNumeric, "191");
      assert.equal(meta?.region, "Europe");

      // Verify pulse aggregation
      const pulseRows = toPulseRows({ HRV: 1 });
      const merged = mergePulses(pulseRows);
      const hrvRow = merged.find((r) => r.iso3 === "HRV");
      assert.equal(hrvRow?.pulses, 1);
      assert.equal(totals(merged), 1);
    });

    it("F4-T4-2: Workflow: Privacy-focused visitor masks timezone, falls back to pt-BR locale", () => {
      mockEnvironment({ timeZone: "UTC", language: "pt-BR" });
      const origin = inferOrigin();
      assert.ok(origin);
      assert.equal(origin.iso3, "BRA");
      assert.equal(origin.name, "Brazil");

      const meta = CATALOG_BY_ISO3.get(origin.iso3);
      assert.equal(meta?.isoNumeric, "076");
      assert.equal(meta?.region, "Americas");
    });
  });
});
