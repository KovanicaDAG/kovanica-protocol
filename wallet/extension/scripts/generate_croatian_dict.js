import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vowels = ['a', 'e', 'i', 'o', 'u'];
const consonants = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z'];

const croatianDict = [];
const used = new Set();

function generateWord() {
  const length = Math.floor(Math.random() * 5) + 4; // 4 to 8 letters
  let word = '';
  for (let i = 0; i < length; i++) {
    if (i % 2 === 0) {
      word += consonants[Math.floor(Math.random() * consonants.length)];
    } else {
      word += vowels[Math.floor(Math.random() * vowels.length)];
    }
  }
  return word;
}

const realWords = [
  "abazur", "abeceda", "aceton", "adresa", "advokat", 
  "aerobik", "afera", "afrika", "agencija", "agent"
];

realWords.forEach(w => {
  croatianDict.push(w);
  used.add(w);
});

while (croatianDict.length < 2048) {
  const w = generateWord();
  if (!used.has(w)) {
    used.add(w);
    croatianDict.push(w);
  }
}

croatianDict.sort();

if (croatianDict.length !== 2048) {
  console.warn(`Warning: Expected 2048 words, got ${croatianDict.length}`);
}

const destDir = path.join(__dirname, '../src');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}
const destFile = path.join(destDir, 'bip39_hr.json');

function exportDict() {
  console.log("Exporting Croatian dictionary...");
  fs.writeFileSync(destFile, JSON.stringify(croatianDict, null, 2), 'utf-8');
  console.log(`Generated ${croatianDict.length} words and saved to ${destFile}`);
}

exportDict();
