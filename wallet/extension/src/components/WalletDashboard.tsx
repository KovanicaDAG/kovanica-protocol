import React, { useState, useEffect } from 'react';
import { getBalance } from '../utils/rpc';

const WalletDashboard: React.FC = () => {
  const [balance, setBalance] = useState<string>('0.00');
  const dummyAddress = '0x1234567890123456789012345678901234567890';

  useEffect(() => {
    getBalance(dummyAddress).then(setBalance);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-green-500 font-mono p-6">
      <div className="w-full max-w-md border border-green-500 rounded-lg p-6 bg-gray-900 shadow-[0_0_15px_rgba(34,197,94,0.5)]">
        <h1 className="text-2xl font-bold mb-4 text-center tracking-widest border-b border-green-800 pb-2">KVNC WALLET</h1>
        
        <div className="my-8 text-center">
          <p className="text-sm text-green-700 uppercase mb-2">Current Balance</p>
          <div className="text-5xl font-extrabold tracking-tight animate-pulse text-green-400">
            {balance}
          </div>
          <p className="text-xs text-green-600 mt-2">KVNC</p>
        </div>

        <div className="flex gap-4 mt-8">
          <button className="flex-1 bg-transparent border-2 border-green-500 text-green-500 font-bold py-3 px-4 rounded hover:bg-green-500 hover:text-black transition-all duration-200 uppercase tracking-wide">
            Send
          </button>
          <button className="flex-1 bg-green-500 text-black font-bold py-3 px-4 rounded hover:bg-green-400 hover:shadow-[0_0_10px_rgba(74,222,128,0.8)] transition-all duration-200 uppercase tracking-wide">
            Receive
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletDashboard;
