import { useState } from 'react';
import WalletDashboard from './components/WalletDashboard';
import SeedPhraseSetup from './components/SeedPhraseSetup';

function App() {
  const [currentView, setCurrentView] = useState<'setup' | 'dashboard'>('setup');

  return (
    <div className="min-h-screen bg-black text-green-500 font-mono">
      {/* Super basic router for demonstration */}
      <div className="fixed top-0 left-0 p-4 z-50 flex gap-4">
        <button 
          onClick={() => setCurrentView('setup')}
          className={`text-xs uppercase tracking-widest border-b ${currentView === 'setup' ? 'border-green-500 text-green-400' : 'border-transparent text-green-800 hover:text-green-600'}`}
        >
          View Setup
        </button>
        <button 
          onClick={() => setCurrentView('dashboard')}
          className={`text-xs uppercase tracking-widest border-b ${currentView === 'dashboard' ? 'border-green-500 text-green-400' : 'border-transparent text-green-800 hover:text-green-600'}`}
        >
          View Dashboard
        </button>
      </div>

      {currentView === 'setup' ? <SeedPhraseSetup /> : <WalletDashboard />}
    </div>
  );
}

export default App;
