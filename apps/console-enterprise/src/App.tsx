import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@console-shared/components';
import { DashboardPage } from './pages/DashboardPage';
import { WalletsPage } from './pages/WalletsPage';
import { AssetsPage } from './pages/AssetsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/wallets', label: 'Wallets', icon: '👛' },
  { path: '/assets', label: 'Assets', icon: '🪙' },
  { path: '/transactions', label: 'Transactions', icon: '📋' },
  { path: '/api-keys', label: 'API Keys', icon: '🔑' },
  { path: '/webhooks', label: 'Webhooks', icon: '🔗' },
  { path: '/reports', label: 'Reports', icon: '📈' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  return (
    <BrowserRouter>
      <Layout title="Kovanica Enterprise Console" navItems={navItems}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/wallets" element={<WalletsPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/api-keys" element={<ApiKeysPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}