import React, { useState } from 'react';
import { Card, Table } from '@console-shared/components';
import { shortenHex } from '@console-shared/utils/format';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  created_at: string;
  last_used: string;
  status: 'active' | 'revoked';
}

const mockApiKeys: ApiKey[] = [
  { id: '1', name: 'Production API', key_prefix: 'kvnc_live_abc123...', permissions: ['read', 'write'], created_at: '2026-01-15', last_used: '2026-09-28', status: 'active' },
  { id: '2', name: 'Staging API', key_prefix: 'kvnc_test_def456...', permissions: ['read'], created_at: '2026-03-20', last_used: '2026-09-25', status: 'active' },
  { id: '3', name: 'Legacy Integration', key_prefix: 'kvnc_live_ghi789...', permissions: ['read', 'write'], created_at: '2025-11-10', last_used: '2026-06-01', status: 'revoked' },
];

export function ApiKeysPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">API Keys</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Your API Keys</h3>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {showCreateForm ? 'Cancel' : '+ Create API Key'}
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium mb-3">Create New API Key</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  placeholder="My API Key"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Permissions</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" defaultChecked className="rounded" />
                    Read
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="rounded" />
                    Write
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="rounded" />
                    Admin
                  </label>
                </div>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
                Generate Key
              </button>
            </div>
          </div>
        )}

        <Table
          columns={[
            { key: 'name', header: 'Name', render: (k) => k.name },
            { key: 'key', header: 'Key', render: (k) => <span className="font-mono text-xs">{k.key_prefix}</span> },
            { key: 'permissions', header: 'Permissions', render: (k) => (
              <div className="flex gap-1">
                {k.permissions.map((p) => (
                  <span key={p} className="px-2 py-0.5 text-xs bg-gray-100 rounded">{p}</span>
                ))}
              </div>
            )},
            { key: 'created', header: 'Created', render: (k) => k.created_at },
            { key: 'last_used', header: 'Last Used', render: (k) => k.last_used },
            { key: 'status', header: 'Status', render: (k) => (
              <span className={`px-2 py-1 text-xs rounded-full ${k.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {k.status}
              </span>
            )},
          ]}
          data={mockApiKeys}
          keyExtractor={(k) => k.id}
          emptyMessage="No API keys found"
        />
      </Card>

      <Card title="API Documentation">
        <div className="space-y-3 text-sm text-gray-600">
          <p>Use your API key in the <code className="bg-gray-100 px-1 rounded">Authorization</code> header:</p>
          <pre className="bg-gray-900 text-green-400 p-3 rounded-md overflow-x-auto">
{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://api.kovanica.online/api/head`}
          </pre>
          <p className="text-xs text-gray-500">
            Rate limit: 1000 requests per minute. Keep your keys secure and rotate them regularly.
          </p>
        </div>
      </Card>
    </div>
  );
}
