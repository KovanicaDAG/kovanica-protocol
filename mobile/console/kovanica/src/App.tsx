import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '../../shared/src/components';
import { ExplorerPage } from './pages/ExplorerPage';
import { BlocksPage } from './pages/BlocksPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { PeersPage } from './pages/PeersPage';
import { AuthoritiesPage } from './pages/AuthoritiesPage';
import { WalletPage } from './pages/WalletPage';
import { MultisigPage } from './pages/MultisigPage';
import { HtlcPage } from './pages/HtlcPage';
import { DeveloperPage } from './pages/DeveloperPage';

const navItems = [
  { path: '/', label: 'Explorer', icon: '🔍' },
  { path: '/blocks', label: 'Blocks', icon: '📦' },
  { path: '/transactions', label: 'Transactions', icon: '📋' },
  { path: '/peers', label: 'Peers', icon: '🌐' },
  { path: '/authorities', label: 'Authorities', icon: '🔐' },
  { path: '/wallet', label: 'Wallet', icon: '👛' },
  { path: '/multisig', label: 'Multisig', icon: '🤝' },
  { path: '/htlc', label: 'HTLC', icon: '⚡' },
  { path: '/developer', label: 'Developer', icon: '🛠️' },
];

export default function App() {
  return (
    <BrowserRouter>
      <Layout title="Kovanica Console" navItems={navItems}>
        <Routes>
          <Route path="/" element={<ExplorerPage />} />
          <Route path="/blocks" element={<BlocksPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/peers" element={<PeersPage />} />
          <Route path="/authorities" element={<AuthoritiesPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/multisig" element={<MultisigPage />} />
          <Route path="/htlc" element={<HtlcPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
