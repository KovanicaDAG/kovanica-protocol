import React, { useState } from 'react';
import { Card } from '@console-shared/components';

export function HtlcPage() {
  const [activeTab, setActiveTab] = useState<'create' | 'redeem' | 'refund'>('create');
  const [formData, setFormData] = useState({
    from: '',
    amount: '',
    recipientPk: '',
    preimageHash: '',
    timeout: '1000',
    preimage: '',
    script: '',
    to: '',
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">HTLC Atomic Swaps</h2>

      <div className="flex gap-2">
        {(['create', 'redeem', 'refund'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'create' && (
        <Card title="Create HTLC">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input
                type="text"
                value={formData.from}
                onChange={(e) => setFormData({ ...formData, from: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="kvnc1..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (atoms)</label>
              <input
                type="text"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
                placeholder="10000000000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Public Key</label>
              <input
                type="text"
                value={formData.recipientPk}
                onChange={(e) => setFormData({ ...formData, recipientPk: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="Recipient's public key..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preimage Hash (SHA256)</label>
              <input
                type="text"
                value={formData.preimageHash}
                onChange={(e) => setFormData({ ...formData, preimageHash: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="Hash of the secret preimage..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (blocks)</label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: e.target.value })}
                className="w-32 px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
              Create HTLC
            </button>
          </div>
        </Card>
      )}

      {activeTab === 'redeem' && (
        <Card title="Redeem HTLC">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input
                type="text"
                value={formData.from}
                onChange={(e) => setFormData({ ...formData, from: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="kvnc1..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">HTLC Script</label>
              <input
                type="text"
                value={formData.script}
                onChange={(e) => setFormData({ ...formData, script: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="HTLC script..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preimage (secret)</label>
              <input
                type="text"
                value={formData.preimage}
                onChange={(e) => setFormData({ ...formData, preimage: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="The secret preimage..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Address</label>
              <input
                type="text"
                value={formData.to}
                onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="kvnc1..."
              />
            </div>
            <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm">
              Redeem HTLC
            </button>
          </div>
        </Card>
      )}

      {activeTab === 'refund' && (
        <Card title="Refund HTLC">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input
                type="text"
                value={formData.from}
                onChange={(e) => setFormData({ ...formData, from: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="kvnc1..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">HTLC Script</label>
              <input
                type="text"
                value={formData.script}
                onChange={(e) => setFormData({ ...formData, script: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="HTLC script..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Refund Address</label>
              <input
                type="text"
                value={formData.to}
                onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                placeholder="kvnc1..."
              />
            </div>
            <button className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm">
              Refund HTLC
            </button>
          </div>
        </Card>
      )}

      <Card title="About HTLC">
        <div className="space-y-2 text-sm text-gray-600">
          <p>Hashed Time-Locked Contracts (HTLCs) enable atomic swaps and trustless escrow.</p>
          <p>Create: Lock funds with a secret hash. The recipient can claim with the preimage.</p>
          <p>Redeem: Claim funds by revealing the preimage before the timeout.</p>
          <p>Refund: After the timeout, the creator can reclaim the funds.</p>
        </div>
      </Card>
    </div>
  );
}
