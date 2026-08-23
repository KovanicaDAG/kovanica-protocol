export type RegionId =
  | "Americas"
  | "Europe"
  | "Asia-Pacific"
  | "Middle East & Africa";

type Spec = {
  iso3: string;
  isoNumeric: string;
  name: string;
  region: RegionId;
};

const SPECS: Spec[] = [
  { iso3: "USA", isoNumeric: "840", name: "United States", region: "Americas" },
  { iso3: "IND", isoNumeric: "356", name: "India", region: "Asia-Pacific" },
  { iso3: "DEU", isoNumeric: "276", name: "Germany", region: "Europe" },
  { iso3: "GBR", isoNumeric: "826", name: "United Kingdom", region: "Europe" },
  { iso3: "HRV", isoNumeric: "191", name: "Croatia", region: "Europe" },
  { iso3: "FRA", isoNumeric: "250", name: "France", region: "Europe" },
  { iso3: "BRA", isoNumeric: "076", name: "Brazil", region: "Americas" },
  { iso3: "CAN", isoNumeric: "124", name: "Canada", region: "Americas" },
  { iso3: "ITA", isoNumeric: "380", name: "Italy", region: "Europe" },
  { iso3: "JPN", isoNumeric: "392", name: "Japan", region: "Asia-Pacific" },
  { iso3: "ESP", isoNumeric: "724", name: "Spain", region: "Europe" },
  { iso3: "AUS", isoNumeric: "036", name: "Australia", region: "Asia-Pacific" },
  { iso3: "NLD", isoNumeric: "528", name: "Netherlands", region: "Europe" },
  { iso3: "POL", isoNumeric: "616", name: "Poland", region: "Europe" },
  { iso3: "KOR", isoNumeric: "410", name: "South Korea", region: "Asia-Pacific" },
  { iso3: "MEX", isoNumeric: "484", name: "Mexico", region: "Americas" },
  { iso3: "IDN", isoNumeric: "360", name: "Indonesia", region: "Asia-Pacific" },
  { iso3: "CHN", isoNumeric: "156", name: "China", region: "Asia-Pacific" },
  { iso3: "TUR", isoNumeric: "792", name: "Turkey", region: "Europe" },
  { iso3: "SWE", isoNumeric: "752", name: "Sweden", region: "Europe" },
  { iso3: "CHE", isoNumeric: "756", name: "Switzerland", region: "Europe" },
  { iso3: "ARG", isoNumeric: "032", name: "Argentina", region: "Americas" },
  { iso3: "BEL", isoNumeric: "056", name: "Belgium", region: "Europe" },
  { iso3: "AUT", isoNumeric: "040", name: "Austria", region: "Europe" },
  { iso3: "IRL", isoNumeric: "372", name: "Ireland", region: "Europe" },
  { iso3: "DNK", isoNumeric: "208", name: "Denmark", region: "Europe" },
  { iso3: "COL", isoNumeric: "170", name: "Colombia", region: "Americas" },
  { iso3: "PRT", isoNumeric: "620", name: "Portugal", region: "Europe" },
  { iso3: "CZE", isoNumeric: "203", name: "Czechia", region: "Europe" },
  { iso3: "ROU", isoNumeric: "642", name: "Romania", region: "Europe" },
  { iso3: "NOR", isoNumeric: "578", name: "Norway", region: "Europe" },
  { iso3: "THA", isoNumeric: "764", name: "Thailand", region: "Asia-Pacific" },
  { iso3: "NGA", isoNumeric: "566", name: "Nigeria", region: "Middle East & Africa" },
  { iso3: "ZAF", isoNumeric: "710", name: "South Africa", region: "Middle East & Africa" },
  { iso3: "PHL", isoNumeric: "608", name: "Philippines", region: "Asia-Pacific" },
  { iso3: "VNM", isoNumeric: "704", name: "Vietnam", region: "Asia-Pacific" },
  { iso3: "ISR", isoNumeric: "376", name: "Israel", region: "Middle East & Africa" },
  { iso3: "FIN", isoNumeric: "246", name: "Finland", region: "Europe" },
  { iso3: "HUN", isoNumeric: "348", name: "Hungary", region: "Europe" },
  { iso3: "GRC", isoNumeric: "300", name: "Greece", region: "Europe" },
  { iso3: "TWN", isoNumeric: "158", name: "Taiwan", region: "Asia-Pacific" },
  { iso3: "PAK", isoNumeric: "586", name: "Pakistan", region: "Asia-Pacific" },
  { iso3: "ARE", isoNumeric: "784", name: "United Arab Emirates", region: "Middle East & Africa" },
  { iso3: "NZL", isoNumeric: "554", name: "New Zealand", region: "Asia-Pacific" },
  { iso3: "CHL", isoNumeric: "152", name: "Chile", region: "Americas" },
  { iso3: "UKR", isoNumeric: "804", name: "Ukraine", region: "Europe" },
  { iso3: "MYS", isoNumeric: "458", name: "Malaysia", region: "Asia-Pacific" },
  { iso3: "EGY", isoNumeric: "818", name: "Egypt", region: "Middle East & Africa" },
  { iso3: "BGD", isoNumeric: "050", name: "Bangladesh", region: "Asia-Pacific" },
  { iso3: "SAU", isoNumeric: "682", name: "Saudi Arabia", region: "Middle East & Africa" },
  { iso3: "KEN", isoNumeric: "404", name: "Kenya", region: "Middle East & Africa" },
  { iso3: "PER", isoNumeric: "604", name: "Peru", region: "Americas" },
  { iso3: "SVK", isoNumeric: "703", name: "Slovakia", region: "Europe" },
  { iso3: "BGR", isoNumeric: "100", name: "Bulgaria", region: "Europe" },
  { iso3: "SRB", isoNumeric: "688", name: "Serbia", region: "Europe" },
  { iso3: "SVN", isoNumeric: "705", name: "Slovenia", region: "Europe" },
  { iso3: "LTU", isoNumeric: "440", name: "Lithuania", region: "Europe" },
  { iso3: "LVA", isoNumeric: "428", name: "Latvia", region: "Europe" },
  { iso3: "EST", isoNumeric: "233", name: "Estonia", region: "Europe" },
  { iso3: "LUX", isoNumeric: "442", name: "Luxembourg", region: "Europe" },
  { iso3: "ISL", isoNumeric: "352", name: "Iceland", region: "Europe" },
  { iso3: "QAT", isoNumeric: "634", name: "Qatar", region: "Middle East & Africa" },
  { iso3: "KWT", isoNumeric: "414", name: "Kuwait", region: "Middle East & Africa" },
  { iso3: "JOR", isoNumeric: "400", name: "Jordan", region: "Middle East & Africa" },
  { iso3: "MAR", isoNumeric: "504", name: "Morocco", region: "Middle East & Africa" },
  { iso3: "GHA", isoNumeric: "288", name: "Ghana", region: "Middle East & Africa" },
  { iso3: "TZA", isoNumeric: "834", name: "Tanzania", region: "Middle East & Africa" },
  { iso3: "UGA", isoNumeric: "800", name: "Uganda", region: "Middle East & Africa" },
  { iso3: "SEN", isoNumeric: "686", name: "Senegal", region: "Middle East & Africa" },
  { iso3: "CIV", isoNumeric: "384", name: "Côte d'Ivoire", region: "Middle East & Africa" },
  { iso3: "ECU", isoNumeric: "218", name: "Ecuador", region: "Americas" },
  { iso3: "URY", isoNumeric: "858", name: "Uruguay", region: "Americas" },
  { iso3: "CRI", isoNumeric: "188", name: "Costa Rica", region: "Americas" },
  { iso3: "GTM", isoNumeric: "320", name: "Guatemala", region: "Americas" },
  { iso3: "PAN", isoNumeric: "591", name: "Panama", region: "Americas" },
  { iso3: "LKA", isoNumeric: "144", name: "Sri Lanka", region: "Asia-Pacific" },
  { iso3: "NPL", isoNumeric: "524", name: "Nepal", region: "Asia-Pacific" },
  { iso3: "KHM", isoNumeric: "116", name: "Cambodia", region: "Asia-Pacific" },
  { iso3: "KAZ", isoNumeric: "398", name: "Kazakhstan", region: "Asia-Pacific" },
  { iso3: "BIH", isoNumeric: "070", name: "Bosnia and Herzegovina", region: "Europe" },
  { iso3: "MKD", isoNumeric: "807", name: "North Macedonia", region: "Europe" },
  { iso3: "ALB", isoNumeric: "008", name: "Albania", region: "Europe" },
  { iso3: "GEO", isoNumeric: "268", name: "Georgia", region: "Europe" },
  { iso3: "ARM", isoNumeric: "051", name: "Armenia", region: "Europe" },
  { iso3: "TUN", isoNumeric: "788", name: "Tunisia", region: "Middle East & Africa" },
  { iso3: "LBN", isoNumeric: "422", name: "Lebanon", region: "Middle East & Africa" },
  { iso3: "RUS", isoNumeric: "643", name: "Russia", region: "Europe" },
  { iso3: "IRN", isoNumeric: "364", name: "Iran", region: "Middle East & Africa" },
];

export type CountryMeta = {
  iso3: string;
  isoNumeric: string;
  name: string;
  region: RegionId;
};

export const COUNTRIES: CountryMeta[] = SPECS.map(({ iso3, isoNumeric, name, region }) => ({
  iso3,
  isoNumeric,
  name,
  region,
}));

export const CATALOG_BY_ISO3 = new Map(COUNTRIES.map((r) => [r.iso3, r]));
export const CATALOG_BY_NUMERIC = new Map(COUNTRIES.map((r) => [r.isoNumeric, r]));

export function catalogLookup(iso3: string): CountryMeta | undefined {
  return CATALOG_BY_ISO3.get(iso3);
}

export type PulseRow = {
  iso3: string;
  countryName: string;
  pulses: number;
};

export type CountryView = CountryMeta & { pulses: number };

export function mergePulses(pulses: PulseRow[]): CountryView[] {
  const extra = new Map(pulses.map((p) => [p.iso3, p]));
  const used = new Set<string>();
  const merged: CountryView[] = COUNTRIES.map((row) => {
    used.add(row.iso3);
    return { ...row, pulses: extra.get(row.iso3)?.pulses ?? 0 };
  });
  for (const p of pulses) {
    if (used.has(p.iso3)) continue;
    const known = CATALOG_BY_ISO3.get(p.iso3);
    merged.push({
      iso3: p.iso3,
      isoNumeric: known?.isoNumeric ?? "",
      name: p.countryName,
      region: known?.region ?? "Europe",
      pulses: p.pulses,
    });
  }
  return merged;
}

export function totals(rows: CountryView[]): number {
  return rows.reduce((s, r) => s + r.pulses, 0);
}

export function rankOf(rows: CountryView[], iso3: string): number {
  const sorted = [...rows].sort((a, b) => b.pulses - a.pulses);
  return sorted.findIndex((r) => r.iso3 === iso3) + 1;
}

export function toPulseRows(
  pulses: Record<string, number> | { iso3: string; pulses: number }[],
): PulseRow[] {
  const entries = Array.isArray(pulses)
    ? pulses.map((p) => [p.iso3, p.pulses] as const)
    : Object.entries(pulses);
  return entries.map(([iso3, n]) => ({
    iso3,
    countryName: CATALOG_BY_ISO3.get(iso3)?.name ?? iso3,
    pulses: n,
  }));
}
