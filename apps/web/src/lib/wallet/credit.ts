import { api, getApiSource } from "@/lib/api/client";

export async function creditPreview(
  address: string,
  atoms: number,
  kind: "faucet" = "faucet",
): Promise<boolean> {
  if (!address || atoms <= 0) return false;
  if (getApiSource() !== "local") return false;
  await api(`/api/faucet?to=${encodeURIComponent(address)}&amount=${atoms}&kind=${kind}`, "POST");
  return true;
}
