let wordsCache: string[] | null = null;

export async function loadWordlist(): Promise<string[]> {
  if (wordsCache) return wordsCache;
  const t = await fetch("/bip39.txt").then((r) => r.text());
  const words = t.trim().split(/\s+/);
  if (words.length !== 2048) throw new Error("bip39 wordlist");
  wordsCache = words;
  return words;
}
