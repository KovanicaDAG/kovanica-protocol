import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** CI artifacts from `.github/workflows/wallet.yml` (Actions → latest green run). */
export const WALLET_DOWNLOADS = {
  /** Android debug APK, served publicly by the web host (explorer.kovanica.online/download/). */
  androidApk: "https://explorer.kovanica.online/download/kovanica-wallet-debug.apk",
  /** iOS unsigned IPA (sideload), served publicly by the web host. */
  iosIpa: "https://explorer.kovanica.online/download/kovanica-wallet-ios-unsigned.ipa",
  /** Latest build run (requires GitHub access to the private repo). */
  workflow: "https://github.com/KovanicaDAG/kovanica-protocol/actions/workflows/wallet.yml",
  iosGuide:
    "https://github.com/KovanicaDAG/kovanica-protocol/blob/main/kovanica-wallet/ios/README.md#install-on-a-real-iphone--no-mac-needed",
  androidGuide:
    "https://github.com/KovanicaDAG/kovanica-protocol/blob/main/kovanica-wallet/README.md",
} as const;

type Props = {
  className?: string;
  /** Compact strip (wallet page) vs card (landing). */
  variant?: "card" | "strip";
};

/**
 * Native wallet downloads — APK + unsigned IPA from the `kovanica wallet` workflow.
 * Artifacts require GitHub access to the private repo; links land on the Actions run list.
 */
export function WalletDownloads({ className, variant = "card" }: Props) {
  const isCard = variant === "card";

  return (
    <section
      className={cn(
        isCard
          ? "rounded-xl border border-border bg-surface p-4 md:p-5"
          : "rounded-lg border border-border/80 bg-surface/80 p-3",
        className,
      )}
      aria-label="Download native wallet"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-gold">
          <Smartphone className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={cn("font-medium text-fg", isCard ? "text-base" : "text-sm")}>
            Native wallet
          </h2>
          <p className={cn("mt-1 text-muted", isCard ? "text-sm leading-relaxed" : "text-xs leading-relaxed")}>
            Android APK and iOS IPA (sideload) build on every relevant push via GitHub Actions —
            copies are hosted here for direct download.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" className="h-11 justify-start sm:min-w-[11rem]">
              <a
                href={WALLET_DOWNLOADS.androidApk}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="size-4 text-teal" aria-hidden />
                Android APK
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11 justify-start sm:min-w-[11rem]">
              <a href={WALLET_DOWNLOADS.iosIpa} target="_blank" rel="noopener noreferrer">
                <Download className="size-4 text-gold" aria-hidden />
                iOS IPA
              </a>
            </Button>
          </div>

          <ul className={cn("mt-3 space-y-1 text-subtle", isCard ? "text-xs" : "text-[11px]")}>
            <li>
              <strong className="font-medium text-muted">Android:</strong> artifact{" "}
              <code className="rounded bg-bg px-1 font-mono text-[10px] text-fg/80">kovanica-wallet-apk</code>
              {" "}· debug build, sideload OK
            </li>
            <li>
              <strong className="font-medium text-muted">iOS:</strong> artifact{" "}
              <code className="rounded bg-bg px-1 font-mono text-[10px] text-fg/80">kovanica-wallet-ios-ipa</code>
              {" "}· unsigned; re-sign with AltStore / Sideloadly + free Apple ID (7-day trust)
            </li>
            <li>
              <a
                href={WALLET_DOWNLOADS.iosGuide}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue underline-offset-2 hover:underline"
              >
                iOS install guide (no Mac)
              </a>
              {" · "}
              <a
                href={WALLET_DOWNLOADS.androidGuide}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue underline-offset-2 hover:underline"
              >
                wallet README
              </a>
            </li>
            <li>
              Built by the{" "}
              <a
                href={WALLET_DOWNLOADS.workflow}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue underline-offset-2 hover:underline"
              >
                kovanica wallet
              </a>{" "}
              GitHub Actions workflow (copy hosted on the explorer; latest green run lives in the GitHub repo).
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
