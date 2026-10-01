/**
 * Kovanica protocol mark — a 3-node directed acyclic graph glyph.
 *
 * Two parent diamonds converge on one child diamond; the emphasized edge is
 * the "selected parent" path (the GHOSTDAG anchor). Reads clearly at 16px.
 *
 * Two marks, two meanings: this DAG glyph is the PROTOCOL mark; the gold coin
 * (coin.webp) remains the KVNC token mark.
 */
type DagMarkProps = {
  variant?: "gold" | "ivory";
  className?: string;
};

const GOLD = "#F2A900";
const IVORY = "#d8d4cc";

export function DagMark({ variant = "gold", className }: DagMarkProps) {
  const c = variant === "gold" ? GOLD : IVORY;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      {/* edges */}
      <path d="M10 14.75 L16 19.5" stroke={c} strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
      <path d="M22 14.75 L16 19.5" stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      {/* nodes */}
      <rect x="6.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 10 11)" fill={c} opacity={0.55} />
      <rect x="18.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 22 11)" fill={c} />
      <rect x="12.5" y="19.5" width="7" height="7" rx="1.2" transform="rotate(45 16 23)" fill={c} />
    </svg>
  );
}

/** Inline favicon SVG (data URI) using the DAG glyph, tinted by network color. */
export function dagFaviconHref(color: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="7" fill="#09090b"/>`,
    `<g fill="none" stroke="${color}" stroke-linecap="round">`,
    `<path d="M10 14.75 L16 19.5" stroke-width="1.4" opacity="0.5"/>`,
    `<path d="M22 14.75 L16 19.5" stroke-width="2.2"/>`,
    `</g>`,
    `<g fill="${color}">`,
    `<rect x="6.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 10 11)" opacity="0.6"/>`,
    `<rect x="18.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 22 11)"/>`,
    `<rect x="12.5" y="19.5" width="7" height="7" rx="1.2" transform="rotate(45 16 23)"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
