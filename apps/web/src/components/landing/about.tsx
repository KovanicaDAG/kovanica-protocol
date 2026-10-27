/**
 * About / Founder section — “everything Light Project needs”.
 * Desktop: 2-col · Mobile: stacked
 */
import { ABOUT } from "@/lib/content/about";

export function About() {
  const { mission, founder, foundation, links, personalGithub, transparency } =
    ABOUT;

  return (
    <section className="mt-12 md:mt-16" aria-labelledby="about-heading">
      <h2
        id="about-heading"
        className="font-display text-2xl tracking-tight text-fg md:text-3xl"
      >
        About
      </h2>

      <div className="mt-5 grid gap-6 md:grid-cols-2 md:gap-8">
        {/* Mission + transparency */}
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted md:text-base">
            {mission}
          </p>
          <p className="text-sm leading-relaxed text-subtle">{transparency}</p>
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">{foundation.status}.</span>{" "}
            {foundation.holds}
          </p>
        </div>

        {/* Founder card */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="font-mono text-[10px] tracking-brand text-blue uppercase">
            Founder
          </p>
          <h3 className="mt-2 font-display text-xl tracking-tight text-fg">
            {founder.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{founder.role}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{founder.bio}</p>
          <p className="mt-2 text-xs text-subtle">{founder.location}</p>

          <ul className="mt-4 flex flex-wrap gap-2">
            {links.map((l) => (
              <li key={l.label}>
                {l.href.startsWith("http") || l.href.startsWith("mailto:") ? (
                  <a
                    href={l.href}
                    target={l.href.startsWith("http") ? "_blank" : undefined}
                    rel={l.href.startsWith("http") ? "noreferrer" : undefined}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-bg px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
                  >
                    {l.label}
                  </a>
                ) : (
                  <a
                    href={l.href}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-bg px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
                  >
                    {l.label}
                  </a>
                )}
              </li>
            ))}
            <li>
              <a
                href={personalGithub}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-border bg-bg px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
              >
                @BetterCallDzuks
              </a>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
