import React, { useState, useEffect } from 'react';
import { generateSeedPhrase } from '../utils/seedPhrase';

const SeedPhraseSetup: React.FC = () => {
  const [words, setWords] = useState<string[]>([]);

  useEffect(() => {
    setWords(generateSeedPhrase());
  }, []);

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black text-green-500 font-mono p-4">
      <div className="w-full max-w-md border border-green-500/50 rounded-xl p-6 bg-black/80 shadow-[0_0_20px_rgba(34,197,94,0.15)] mt-4">
        <h2 className="text-xl md:text-2xl font-bold mb-3 text-center tracking-widest text-green-400">KVNC SEED</h2>
        <p className="text-center text-xs text-green-700/80 mb-6 max-w-sm mx-auto">
          Write down these 24 words in exact order.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {words.map((word, index) => (
            <div key={index} className="flex bg-gray-900/50 border border-green-900/50 rounded-md p-2 items-center shadow-inner">
              <span className="text-green-800 text-[10px] w-5 text-right mr-2">{index + 1}.</span>
              <span className="text-green-400 font-medium tracking-wider text-sm">{word}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-center mt-2">
          <button className="w-full bg-green-500/10 border border-green-500 text-green-400 font-bold py-3 px-6 rounded-lg hover:bg-green-500 hover:text-black transition-all duration-300 uppercase tracking-widest text-sm">
            I Saved It
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeedPhraseSetup;
