/**
 * Product grid.
 * - variant="landing" → absolute testnet/docs URLs (apex marketing page)
 * - variant="app"     → in-app TanStack Links (testnet host only; rarely used)
 */
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Compass,
  Eye,
  Image,
  Layers,
  Lock,
  Map,
  Route,
  Users,
  Vault,
  Wallet,
} from "lucide-react";

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";

type ProductTo =
  | "/explorer"
  | "/wallet"
  | "/map"
  | "/multisig"
  | "/multi-asset"
  | "/network"
  | "/roadmap"
  | "/stealth"
  | "/htlc"
  | "/vaults"
  | "/nft"
  | "/faucet";

type Product = {
  to: ProductTo;
  /** Absolute URL used on marketing landing so apex never “owns” protocol paths */
  external?: string;
  icon: typeof Compass;
  title: string;
  body: string;
};

const PRODUCTS: Product[] = [
  {
    to: "/explorer",
    external: `${TESTNET}/explorer`,
    icon: Compass,
    title: "Explorer",
    body: "GHOSTDAG graph, selected chain, live mine and pause — buttons are no longer operator-gated.",
  },
  {
    to: "/wallet",
    external: `${TESTNET}/wallet`,
    icon: Wallet,
    title: "Wallet",
    body: "Create or import a seed, hardware wallets, accounts 0–2, QR, faucet and Ed25519 sends.",
  },
  {
    to: "/multi-asset",
    external: `${TESTNET}/multi-asset`,
    icon: Layers,
    title: "Multi-asset",
    body: "Native multi-asset UTXOs, AssetPicker, per-asset balances and prepare — KVP-102.",
  },
  {
    to: "/nft",
    external: `${TESTNET}/nft`,
    icon: Image,
    title: "NFTs",
    body: "Native NFTs (KVP-106). AssetKind::Nft, max_supply = 1, metadata URI. Design complete — ledger next.",
  },
  {
    to: "/multisig",
    external: `${TESTNET}/multisig`,
    icon: Users,
    title: "Multisig",
    body: "M-of-N P2SH addresses, spend proposals, partial signatures and combine — RFC-001.",
  },
  {
    to: "/stealth",
    external: `${TESTNET}/stealth`,
    icon: Eye,
    title: "Stealth",
    body: "One-time ECDH addresses, view tags, scan & spend — KVP-103 / RFC-003.",
  },
  {
    to: "/htlc",
    external: `${TESTNET}/htlc`,
    icon: Lock,
    title: "HTLC",
    body: "Hashed time-locked contracts for atomic swaps — redeem or refund — KVP-104.",
  },
  {
    to: "/vaults",
    external: `${TESTNET}/vaults`,
    icon: Vault,
    title: "Vaults",
    body: "CLTV / CSV time-lock vaults and treasury vesting templates — KVP-105.",
  },
  {
    to: "/network",
    external: `${TESTNET}/network`,
    icon: Activity,
    title: "Network",
    body: "Live head, peers, PoW, subsidy, finality and bootstrap seeds for the selected source.",
  },
  {
    to: "/roadmap",
    external: `${TESTNET}/roadmap`,
    icon: Route,
    title: "Roadmap",
    body: "RFC status, client surfaces, and what is shipping next on the protocol.",
  },
  {
    to: "/map",
    external: `${TESTNET}/map`,
    icon: Map,
    title: "Origins map",
    body: "Choropleth of real origin pulses from recorded visits — record your origin to leave yours.",
  },
];

export function ProductGrid({
  variant = "landing",
}: {
  variant?: "landing" | "app";
}) {
  return (
    <section className="mt-12 md:mt-16" aria-labelledby="products-heading">
      <h2
        id="products-heading"
        className="font-display text-2xl tracking-tight text-fg md:text-3xl"
      >
        Surfaces
      </h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((p) => (
          <ProductCard key={p.title} product={p} variant={variant} />
        ))}
      </ul>
      {variant === "landing" && (
        <p className="mt-4 text-center text-xs text-subtle">
          Protocol surfaces live on{" "}
          <a href={TESTNET} className="underline hover:text-fg">
            testnet.kovanica.online
          </a>
          . Specs on{" "}
          <a href={DOCS} className="underline hover:text-fg">
            docs.kovanica.online
          </a>
          .
        </p>
      )}
    </section>
  );
}

function ProductCard({
  product,
  variant,
}: {
  product: Product;
  variant: "landing" | "app";
}) {
  const { to, external, icon: Icon, title, body } = product;
  const className =
    "flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors duration-150 hover:bg-surface-2";
  const inner = (
    <>
      <Icon className="size-4 text-blue" />
      <h3 className="mt-3 font-display text-xl tracking-tight text-fg">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </>
  );

  return (
    <li>
      {variant === "landing" && external ? (
        <a href={external} className={className}>
          {inner}
        </a>
      ) : (
        <Link to={to} className={className}>
          {inner}
        </Link>
      )}
    </li>
  );
}
