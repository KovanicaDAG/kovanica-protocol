/**
 * What’s New — marketing Landing only.
 * Prefer absolute hrefs (http/https); no in-app protocol Links on apex.
 */
import { WHATS_NEW } from "@/lib/content/whats-new";

export function WhatsNew() {
  return (
    <section className="mt-12 md:mt-16" aria-labelledby="whats-new-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="whats-new-heading"
          className="font-display text-2xl tracking-tight text-fg md:text-3xl"
        >
          What’s new
        </h2>
        <span className="font-mono text-[10px] tracking-brand text-subtle uppercase">
          2026
        </span>
      </div>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {WHATS_NEW.map((item) => (
          <li key={`${item.date}-${item.title}`}>
            <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors duration-150 hover:bg-surface-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-blue">
                  {item.tag}
                </span>
                <span className="text-[11px] text-subtle">{item.date}</span>
              </div>
              <h3 className="mt-2 font-display text-lg tracking-tight text-fg">
                {item.href ? (
                  <a href={item.href} className="hover:underline">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h3>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">
                {item.body}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
