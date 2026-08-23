import { api, getApiSource } from "@/lib/api/client";

export async function creditPreview(
  address: string,
  atoms: number,
  kind: "tap" | "faucet" = "tap",
): Promise<boolean> {
  if (!address || atoms <= 0) return false;
  if (kind === "tap") {
    await api(`/api/tap?to=${encodeURIComponent(address)}&amount=${atoms}`, "POST");
    return true;
  }
  if (getApiSource() !== "local") return false;
  await api(`/api/faucet?to=${encodeURIComponent(address)}&amount=${atoms}&kind=${kind}`, "POST");
  return true;
}