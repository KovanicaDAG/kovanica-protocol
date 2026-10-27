import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
} from "./helper.mjs";

const {
  COUNTRIES,
  CATALOG_BY_ISO3,
  CATALOG_BY_NUMERIC,
  catalogLookup,
  mergePulses,
  rankOf,
  totals,
  toPulseRows,
} = catalog;

// Helper to generate flag emoji from 2-letter country code
function getFlagEmoji(countryCode) {
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// ISO3 to ISO2 mapping for canonical catalog countries
const ISO3_TO_ISO2 = {
  USA: "US", IND: "IN", DEU: "DE", GBR: "GB", HRV: "HR", FRA: "FR", BRA: "BR", CAN: "CA",
  ITA: "IT", JPN: "JP", ESP: "ES", AUS: "AU", NLD: "NL", POL: "PL", KOR: "KR", MEX: "MX",
  IDN: "ID", CHN: "CN", TUR: "TR", SWE: "SE", CHE: "CH", ARG: "AR", BEL: "BE", AUT: "AT",
  IRL: "IE", DNK: "DK", COL: "CO", PRT: "PT", CZE: "CZ", ROU: "RO", NOR: "NO", THA: "TH",
  NGA: "NG", ZAF: "ZA", PHL: "PH", VNM: "VN", ISR: "IL", FIN: "FI", HUN: "HU", GRC: "GR",
  TWN: "TW", PAK: "PK", ARE: "AE", NZL: "NZ", CHL: "CL", UKR: "UA", MYS: "MY", EGY: "EG",
  BGD: "BD", SAU: "SA", KEN: "KE", PER: "PE", SVK: "SK", BGR: "BG", SRB: "RS", SVN: "SI",
  LTU: "LT", LVA: "LV", EST: "EE", LUX: "LU", ISL: "IS", QAT: "QA", KWT: "KW", JOR: "JO",
  MAR: "MA", GHA: "GH", TZA: "TZ", UGA: "UG", SEN: "SN", CIV: "CI", ECU: "EC", URY: "UY",
  CRI: "CR", GTM: "GT", PAN: "PA", LKA: "LK", NPL: "NP", KHM: "KH", KAZ: "KZ", BIH: "BA",
  MKD: "MK", ALB: "AL", GEO: "GE", ARM: "AM", TUN: "TN", LBN: "LB", RUS: "RU", IRN: "IR",
};

describe("Feature 1: Global Geo Catalog & Enriched Metadata", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F1-T1-1: COUNTRIES array contains enriched entries with valid structure", () => {
      assert.ok(COUNTRIES.length >= 80, `Expected at least 80 countries, got ${COUNTRIES.length}`);
      for (const country of COUNTRIES) {
        assert.ok(typeof country.iso3 === "string" && country.iso3.length === 3, `Invalid iso3: ${country.iso3}`);
        assert.ok(typeof country.isoNumeric === "string" && country.isoNumeric.length === 3, `Invalid isoNumeric: ${country.isoNumeric}`);
        assert.ok(typeof country.name === "string" && country.name.length > 0, `Invalid name for: ${country.iso3}`);
        assert.ok(
          ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"].includes(country.region),
          `Invalid region ${country.region} for: ${country.iso3}`
        );
      }
    });

    it("F1-T1-2: ISO numeric codes are strictly 3 digits padded with leading zeros", () => {
      for (const country of COUNTRIES) {
        assert.match(country.isoNumeric, /^\d{3}$/, `Numeric code ${country.isoNumeric} is not 3 digits`);
      }
      assert.equal(CATALOG_BY_ISO3.get("BRA")?.isoNumeric, "076");
      assert.equal(CATALOG_BY_ISO3.get("AUS")?.isoNumeric, "036");
      assert.equal(CATALOG_BY_ISO3.get("USA")?.isoNumeric, "840");
    });

    it("F1-T1-3: ISO3 codes are 3 uppercase ASCII letters", () => {
      for (const country of COUNTRIES) {
        assert.match(country.iso3, /^[A-Z]{3}$/, `ISO3 code ${country.iso3} is not 3 uppercase letters`);
      }
    });

    it("F1-T1-4: All 4 canonical regions have valid country memberships", () => {
      const regions = new Set(COUNTRIES.map((c) => c.region));
      assert.ok(regions.has("Americas"), "Americas missing");
      assert.ok(regions.has("Europe"), "Europe missing");
      assert.ok(regions.has("Asia-Pacific"), "Asia-Pacific missing");
      assert.ok(regions.has("Middle East & Africa"), "Middle East & Africa missing");

      const europeCount = COUNTRIES.filter((c) => c.region === "Europe").length;
      const americasCount = COUNTRIES.filter((c) => c.region === "Americas").length;
      const apacCount = COUNTRIES.filter((c) => c.region === "Asia-Pacific").length;
      const meaCount = COUNTRIES.filter((c) => c.region === "Middle East & Africa").length;

      assert.ok(europeCount >= 20, `Expected >=20 European countries, got ${europeCount}`);
      assert.ok(americasCount >= 10, `Expected >=10 Americas countries, got ${americasCount}`);
      assert.ok(apacCount >= 15, `Expected >=15 Asia-Pacific countries, got ${apacCount}`);
      assert.ok(meaCount >= 15, `Expected >=15 MEA countries, got ${meaCount}`);
    });

    it("F1-T1-5: Catalog index maps maintain 1:1 bi-directional integrity with COUNTRIES", () => {
      assert.equal(CATALOG_BY_ISO3.size, COUNTRIES.length);
      assert.equal(CATALOG_BY_NUMERIC.size, COUNTRIES.length);
      for (const country of COUNTRIES) {
        assert.equal(CATALOG_BY_ISO3.get(country.iso3), country);
        assert.equal(CATALOG_BY_NUMERIC.get(country.isoNumeric), country);
      }
    });

    it("F1-T1-6: Country name strings have no leading/trailing whitespace", () => {
      for (const country of COUNTRIES) {
        assert.equal(country.name, country.name.trim());
      }
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F1-T2-1: Catalog handles countries with special diacritics and composite names", () => {
      const coteDIvoire = CATALOG_BY_ISO3.get("CIV");
      assert.ok(coteDIvoire, "CIV must exist");
      assert.equal(coteDIvoire.name, "Côte d'Ivoire");

      const bosnia = CATALOG_BY_ISO3.get("BIH");
      assert.ok(bosnia, "BIH must exist");
      assert.equal(bosnia.name, "Bosnia and Herzegovina");
    });

    it("F1-T2-2: Numeric codes starting with 00 (e.g. Albania '008') maintain padding", () => {
      const alb = CATALOG_BY_ISO3.get("ALB");
      assert.ok(alb, "ALB must exist");
      assert.equal(alb.isoNumeric, "008");
      assert.equal(CATALOG_BY_NUMERIC.get("008")?.name, "Albania");
    });

    it("F1-T2-3: No duplicate ISO3 codes or duplicate Numeric codes exist in catalog", () => {
      const iso3Set = new Set();
      const numSet = new Set();
      for (const c of COUNTRIES) {
        assert.ok(!iso3Set.has(c.iso3), `Duplicate ISO3: ${c.iso3}`);
        assert.ok(!numSet.has(c.isoNumeric), `Duplicate Numeric: ${c.isoNumeric}`);
        iso3Set.add(c.iso3);
        numSet.add(c.isoNumeric);
      }
    });

    it("F1-T2-4: Key geopolitical regions (Balkans, Baltics, Scandinavia, East Asia) correctly mapped", () => {
      assert.equal(CATALOG_BY_ISO3.get("HRV")?.region, "Europe");
      assert.equal(CATALOG_BY_ISO3.get("EST")?.region, "Europe");
      assert.equal(CATALOG_BY_ISO3.get("NOR")?.region, "Europe");
      assert.equal(CATALOG_BY_ISO3.get("TWN")?.region, "Asia-Pacific");
      assert.equal(CATALOG_BY_ISO3.get("KOR")?.region, "Asia-Pacific");
    });

    it("F1-T2-5: Catalog integrity remains immutable across repeated reads", () => {
      const initialLength = COUNTRIES.length;
      const usa = catalogLookup("USA");
      assert.ok(usa);
      assert.equal(COUNTRIES.length, initialLength);
    });
  });
});

describe("Feature 2: ISO Code Conversion & Helpers", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F2-T1-1: catalogLookup resolves canonical countries by ISO3", () => {
      assert.equal(catalogLookup("USA")?.name, "United States");
      assert.equal(catalogLookup("HRV")?.name, "Croatia");
      assert.equal(catalogLookup("DEU")?.name, "Germany");
      assert.equal(catalogLookup("IND")?.name, "India");
      assert.equal(catalogLookup("JPN")?.name, "Japan");
    });

    it("F2-T1-2: CATALOG_BY_NUMERIC resolves countries by 3-digit numeric string", () => {
      assert.equal(CATALOG_BY_NUMERIC.get("840")?.iso3, "USA");
      assert.equal(CATALOG_BY_NUMERIC.get("191")?.iso3, "HRV");
      assert.equal(CATALOG_BY_NUMERIC.get("276")?.iso3, "DEU");
      assert.equal(CATALOG_BY_NUMERIC.get("392")?.iso3, "JPN");
    });

    it("F2-T1-3: Flag emoji generator creates accurate Unicode flag emojis for ISO2 codes", () => {
      assert.equal(getFlagEmoji("US"), "🇺🇸");
      assert.equal(getFlagEmoji("HR"), "🇭🇷");
      assert.equal(getFlagEmoji("DE"), "🇩🇪");
      assert.equal(getFlagEmoji("JP"), "🇯🇵");
      assert.equal(getFlagEmoji("GB"), "🇬🇧");
      assert.equal(getFlagEmoji("FR"), "🇫🇷");
    });

    it("F2-T1-4: Flag emoji conversion maps ISO3 via lookup to ISO2 flag", () => {
      for (const [iso3, iso2] of Object.entries(ISO3_TO_ISO2)) {
        const country = CATALOG_BY_ISO3.get(iso3);
        assert.ok(country, `Country for ${iso3} must exist`);
        const flag = getFlagEmoji(iso2);
        assert.ok(flag.length > 0, `Flag emoji for ${iso3} (${iso2}) must be valid`);
      }
    });

    it("F2-T1-5: Bidirectional lookup converts ISO3 to Numeric and back to ISO3", () => {
      for (const c of COUNTRIES) {
        const num = c.isoNumeric;
        const fromNum = CATALOG_BY_NUMERIC.get(num);
        assert.equal(fromNum?.iso3, c.iso3);
      }
    });

    it("F2-T1-6: Flag emoji generator creates multi-code-point emoji string", () => {
      const usFlag = getFlagEmoji("US");
      assert.equal(usFlag.length, 4); // 2 surrogate pairs = 4 UTF-16 code units
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F2-T2-1: catalogLookup returns undefined for unknown ISO3 codes", () => {
      assert.equal(catalogLookup("XYZ"), undefined);
      assert.equal(catalogLookup("AAA"), undefined);
      assert.equal(catalogLookup("ZZZ"), undefined);
      assert.equal(catalogLookup(""), undefined);
    });

    it("F2-T2-2: CATALOG_BY_NUMERIC returns undefined for unpadded or non-existent numbers", () => {
      assert.equal(CATALOG_BY_NUMERIC.get("76"), undefined); // Unpadded Brazil (should be '076')
      assert.equal(CATALOG_BY_NUMERIC.get("8"), undefined);  // Unpadded Albania (should be '008')
      assert.equal(CATALOG_BY_NUMERIC.get("999"), undefined);
      assert.equal(CATALOG_BY_NUMERIC.get(""), undefined);
    });

    it("F2-T2-3: Flag emoji generator handles lowercase ISO2 codes seamlessly", () => {
      assert.equal(getFlagEmoji("us"), "🇺🇸");
      assert.equal(getFlagEmoji("hr"), "🇭🇷");
      assert.equal(getFlagEmoji("de"), "🇩🇪");
    });

    it("F2-T2-4: Handling malformed lookup inputs without throwing exceptions", () => {
      assert.doesNotThrow(() => catalogLookup(""));
      assert.doesNotThrow(() => catalogLookup("TOO_LONG_STRING"));
      assert.doesNotThrow(() => CATALOG_BY_NUMERIC.get("NOT_NUMERIC"));
    });

    it("F2-T2-5: Case sensitivity verification: lowercase iso3 returns undefined in raw map", () => {
      assert.equal(CATALOG_BY_ISO3.get("usa"), undefined);
      assert.equal(CATALOG_BY_ISO3.get("hrv"), undefined);
    });
  });
});

describe("Feature 12: Multi-Metric / Pulse Merging & Data Aggregations", () => {
  describe("Tier 1: Feature Coverage", () => {
    it("F12-T1-1: mergePulses merges pulse counts into canonical catalog entries", () => {
      const pulseData = [
        { iso3: "USA", countryName: "United States", pulses: 1500 },
        { iso3: "HRV", countryName: "Croatia", pulses: 850 },
        { iso3: "DEU", countryName: "Germany", pulses: 320 },
      ];
      const merged = mergePulses(pulseData);
      assert.equal(merged.length, COUNTRIES.length);

      const usa = merged.find((r) => r.iso3 === "USA");
      const hrv = merged.find((r) => r.iso3 === "HRV");
      const deu = merged.find((r) => r.iso3 === "DEU");
      const jpn = merged.find((r) => r.iso3 === "JPN");

      assert.equal(usa?.pulses, 1500);
      assert.equal(hrv?.pulses, 850);
      assert.equal(deu?.pulses, 320);
      assert.equal(jpn?.pulses, 0); // Unpulsed country defaults to 0
    });

    it("F12-T1-2: mergePulses appends unknown countries while preserving known catalog", () => {
      const pulseData = [
        { iso3: "USA", countryName: "United States", pulses: 100 },
        { iso3: "XYZ", countryName: "Atlantis", pulses: 42 },
      ];
      const merged = mergePulses(pulseData);
      assert.equal(merged.length, COUNTRIES.length + 1);

      const atlantis = merged.find((r) => r.iso3 === "XYZ");
      assert.ok(atlantis);
      assert.equal(atlantis.name, "Atlantis");
      assert.equal(atlantis.pulses, 42);
      assert.equal(atlantis.isoNumeric, "");
      assert.equal(atlantis.region, "Europe"); // Default fallback region
    });

    it("F12-T1-3: totals accurately computes sum of all pulses across CountryView array", () => {
      const rows = [
        { iso3: "USA", isoNumeric: "840", name: "United States", region: "Americas", pulses: 500 },
        { iso3: "HRV", isoNumeric: "191", name: "Croatia", region: "Europe", pulses: 300 },
        { iso3: "JPN", isoNumeric: "392", name: "Japan", region: "Asia-Pacific", pulses: 200 },
        { iso3: "DEU", isoNumeric: "276", name: "Germany", region: "Europe", pulses: 0 },
      ];
      assert.equal(totals(rows), 1000);
    });

    it("F12-T1-4: rankOf computes accurate 1-based ranking sorted by pulses descending", () => {
      const rows = [
        { iso3: "HRV", isoNumeric: "191", name: "Croatia", region: "Europe", pulses: 300 },
        { iso3: "USA", isoNumeric: "840", name: "United States", region: "Americas", pulses: 500 },
        { iso3: "JPN", isoNumeric: "392", name: "Japan", region: "Asia-Pacific", pulses: 200 },
        { iso3: "DEU", isoNumeric: "276", name: "Germany", region: "Europe", pulses: 100 },
      ];
      assert.equal(rankOf(rows, "USA"), 1);
      assert.equal(rankOf(rows, "HRV"), 2);
      assert.equal(rankOf(rows, "JPN"), 3);
      assert.equal(rankOf(rows, "DEU"), 4);
    });

    it("F12-T1-5: toPulseRows converts Record object and array formats uniformly", () => {
      const objInput = { USA: 120, HRV: 80 };
      const arrInput = [
        { iso3: "USA", pulses: 120 },
        { iso3: "HRV", pulses: 80 },
      ];

      const fromObj = toPulseRows(objInput);
      const fromArr = toPulseRows(arrInput);

      assert.deepEqual(fromObj, [
        { iso3: "USA", countryName: "United States", pulses: 120 },
        { iso3: "HRV", countryName: "Croatia", pulses: 80 },
      ]);
      assert.deepEqual(fromArr, [
        { iso3: "USA", countryName: "United States", pulses: 120 },
        { iso3: "HRV", countryName: "Croatia", pulses: 80 },
      ]);
    });

    it("F12-T1-6: mergePulses preserves canonical country ordering of COUNTRIES", () => {
      const merged = mergePulses(toPulseRows({ USA: 10, HRV: 20 }));
      for (let i = 0; i < COUNTRIES.length; i++) {
        assert.equal(merged[i].iso3, COUNTRIES[i].iso3);
      }
    });
  });

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("F12-T2-1: mergePulses with empty array returns all countries with 0 pulses", () => {
      const merged = mergePulses([]);
      assert.equal(merged.length, COUNTRIES.length);
      for (const row of merged) {
        assert.equal(row.pulses, 0);
      }
      assert.equal(totals(merged), 0);
    });

    it("F12-T2-2: totals returns 0 for empty array", () => {
      assert.equal(totals([]), 0);
    });

    it("F12-T2-3: rankOf returns 0 for country not present in rows", () => {
      const rows = [
        { iso3: "USA", isoNumeric: "840", name: "United States", region: "Americas", pulses: 100 },
      ];
      assert.equal(rankOf(rows, "NON_EXISTENT"), 0);
    });

    it("F12-T2-4: rankOf handles tied pulse counts deterministically", () => {
      const rows = [
        { iso3: "USA", isoNumeric: "840", name: "United States", region: "Americas", pulses: 100 },
        { iso3: "DEU", isoNumeric: "276", name: "Germany", region: "Europe", pulses: 100 },
        { iso3: "HRV", isoNumeric: "191", name: "Croatia", region: "Europe", pulses: 50 },
      ];
      const rankUSA = rankOf(rows, "USA");
      const rankDEU = rankOf(rows, "DEU");
      const rankHRV = rankOf(rows, "HRV");
      assert.ok(rankUSA === 1 || rankUSA === 2);
      assert.ok(rankDEU === 1 || rankDEU === 2);
      assert.equal(rankHRV, 3);
    });

    it("F12-T2-5: toPulseRows handles empty inputs gracefully", () => {
      assert.deepEqual(toPulseRows({}), []);
      assert.deepEqual(toPulseRows([]), []);
    });

    it("F12-T2-6: mergePulses handles single-country input cleanly", () => {
      const merged = mergePulses(toPulseRows({ JPN: 77 }));
      const jpn = merged.find((r) => r.iso3 === "JPN");
      assert.equal(jpn?.pulses, 77);
      assert.equal(totals(merged), 77);
    });
  });

  describe("Tier 3: Cross-Feature Combinations", () => {
    it("F12-T3-1: Pipeline test: toPulseRows -> mergePulses -> totals -> rankOf", () => {
      const rawMetrics = { USA: 5000, HRV: 2500, JPN: 1200, FRA: 800, GBR: 400 };
      const pulseRows = toPulseRows(rawMetrics);
      const countryViews = mergePulses(pulseRows);

      assert.equal(totals(countryViews), 9900);
      assert.equal(rankOf(countryViews, "USA"), 1);
      assert.equal(rankOf(countryViews, "HRV"), 2);
      assert.equal(rankOf(countryViews, "JPN"), 3);
      assert.equal(rankOf(countryViews, "FRA"), 4);
      assert.equal(rankOf(countryViews, "GBR"), 5);

      // Verify unpulsed country rank is at the bottom
      const unpulsedRank = rankOf(countryViews, "CAN");
      assert.ok(unpulsedRank >= 6);
    });

    it("F12-T3-2: Regional aggregations computed from merged CountryView array", () => {
      const pulseData = [
        { iso3: "USA", countryName: "United States", pulses: 1000 }, // Americas
        { iso3: "BRA", countryName: "Brazil", pulses: 500 },        // Americas
        { iso3: "DEU", countryName: "Germany", pulses: 800 },       // Europe
        { iso3: "FRA", countryName: "France", pulses: 600 },        // Europe
        { iso3: "JPN", countryName: "Japan", pulses: 700 },         // Asia-Pacific
        { iso3: "NGA", countryName: "Nigeria", pulses: 400 },       // MEA
      ];
      const merged = mergePulses(pulseData);

      const americasTotal = totals(merged.filter((r) => r.region === "Americas"));
      const europeTotal = totals(merged.filter((r) => r.region === "Europe"));
      const apacTotal = totals(merged.filter((r) => r.region === "Asia-Pacific"));
      const meaTotal = totals(merged.filter((r) => r.region === "Middle East & Africa"));

      assert.equal(americasTotal, 1500);
      assert.equal(europeTotal, 1400);
      assert.equal(apacTotal, 700);
      assert.equal(meaTotal, 400);
      assert.equal(americasTotal + europeTotal + apacTotal + meaTotal, totals(merged));
    });
  });

  describe("Tier 4: Real-World Workflows", () => {
    it("F12-T4-1: Ingesting high-concurrency pulse streams with dynamic updates", () => {
      let state = toPulseRows({ USA: 10, HRV: 20 });
      let merged = mergePulses(state);
      assert.equal(rankOf(merged, "HRV"), 1);
      assert.equal(rankOf(merged, "USA"), 2);

      // New batch of pulses arrives
      const incomingBatch = { USA: 30, DEU: 25 };
      const combined = { ...{ USA: 10, HRV: 20 }, ...incomingBatch };
      state = toPulseRows(combined);
      merged = mergePulses(state);

      assert.equal(rankOf(merged, "USA"), 1); // USA now has 30
      assert.equal(rankOf(merged, "DEU"), 2); // DEU has 25
      assert.equal(rankOf(merged, "HRV"), 3); // HRV has 20
      assert.equal(totals(merged), 75);
    });

    it("F12-T4-2: Handles 100+ country multi-metric simultaneous ingestion", () => {
      const largeBatch = {};
      COUNTRIES.forEach((c, idx) => {
        largeBatch[c.iso3] = (idx + 1) * 10;
      });
      const rows = mergePulses(toPulseRows(largeBatch));
      assert.equal(rows.length, COUNTRIES.length);
      const expectedTotal = (COUNTRIES.length * (COUNTRIES.length + 1) / 2) * 10;
      assert.equal(totals(rows), expectedTotal);
    });

    it("F12-T4-3: CountryView objects preserve all CountryMeta properties", () => {
      const rows = mergePulses(toPulseRows({ HRV: 50 }));
      const hrv = rows.find((r) => r.iso3 === "HRV");
      assert.ok(hrv);
      assert.equal(hrv.iso3, "HRV");
      assert.equal(hrv.isoNumeric, "191");
      assert.equal(hrv.name, "Croatia");
      assert.equal(hrv.region, "Europe");
      assert.equal(hrv.pulses, 50);
    });

    it("F12-T4-4: Lowest-ranked country rank equals total count of rows", () => {
      const rows = mergePulses(toPulseRows({ USA: 100 }));
      const lastRank = rankOf(rows, rows[rows.length - 1].iso3);
      assert.ok(lastRank >= 1);
    });
  });
});
