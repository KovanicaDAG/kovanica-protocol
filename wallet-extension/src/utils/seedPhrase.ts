import hrWords from '../bip39_hr.json';
import enWordsRaw from '../bip39_en.txt?raw';

const enWords = enWordsRaw.split('\n').map(w => w.trim()).filter(Boolean);

export function generateSeedPhrase(): string[] {
  const phrase: string[] = [];
  for (let i = 0; i < 12; i++) {
    const hrWord = hrWords[Math.floor(Math.random() * hrWords.length)];
    const enWord = enWords[Math.floor(Math.random() * enWords.length)];
    phrase.push(enWord);
    phrase.push(hrWord);
  }
  return phrase;
}
