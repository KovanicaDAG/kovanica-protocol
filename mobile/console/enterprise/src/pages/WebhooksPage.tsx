import React, { useState } from 'react';
import { Card, Table } from '../../../shared/src/components';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'paused' | 'failed';
  deliveries: number;
  last_delivery: string;
  success_rate: number;
}

const mockWebhooks: Webhook[] = [
  { id: '1', url: 'https://api.example.com/webhooks/kovanica', events: ['block', 'transaction'], status: 'active', deliveries: 15420, last_delivery: '2026-09-29 10:30', success_rate: 99.8 },
  { id: '2', url: 'https://hooks.example.com/kovanica', events: ['transaction'], status: 'active', deliveries: 8930, last_delivery: '2026-09-29 10:25', success_rate: 98.5 },
  { id: '3', url: 'https://old.example.com/webhook', events: ['block'], status: 'failed', deliveries: 120, last_delivery: '2026-09-20 14:00', success_rate: 45.2 },
];

export function WebhooksPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Webhooks</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Configured Webhooks</h3>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {showCreateForm ? 'Cancel' : '+ Add Webhook'}
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium mb-3">Create New Webhook</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Endpoint URL</label>
                <input
                  type="url"
                  placeholder="https://your-api.com/webhook"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Events</label>
                <div className="flex flex-wrap gap-3">
                  {['block', 'transaction', 'asset', 'htlc', 'multisig'].map((event) => (
                    <label key={event} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="rounded" />
                      {event}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Secret (for signature verification)</label>
                <input
                  type="text"
                  placeholder="whsec_..."
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
                Create Webhook
              </button>
            </div>
          </div>
        )}

        <Table
          columns={[
            { key: 'url', header: 'URL', render: (w) => <span className="font-mono text-xs">{w.url}</span> },
            { key: 'events', header: 'Events', render: (w) => (
              <div className="flex gap-1 flex-wrap">
                {w.events.map((e) => (
                  <span key={e} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">{e}</span>
                ))}
              </div>
            )},
            { key: 'status', header: 'Status', render: (w) => (
              <span className={`px-2 py-1 text-xs rounded-full ${
                w.status === 'active' ? 'bg-green-100 text-green-800' :
                w.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {w.status}
              </span>
            )},
            { key: 'deliveries', header: 'Deliveries', render: (w) => w.deliveries.toLocaleString() },
            { key: 'success_rate', header: 'Success', render: (w) => (
              <span className={w.success_rate > 95 ? 'text-green-600' : w.success_rate > 80 ? 'text-yellow-600' : 'text-red-600'}>
                {w.success_rate}%
              </span>
            )},
          ]}
          data={mockWebhooks}
          keyExtractor={(w) => w.id}
          emptyMessage="No webhooks configured"
        />
      </Card>

      <Card title="Webhook Payloads">
        <div className="space-y-3 text-sm text-gray-600">
          <p>Webhooks are sent as <code className="bg-gray-100 px-1 rounded">POST</code> requests with a JSON body:</p>
          <pre className="bg-gray-900 text-green-400 p-3 rounded-md overflow-x-auto">
{`{
  "event": "block",
  "timestamp": "2026-09-29T10:30:00Z",
  "data": {
    "block_id": "abc123...",
    "height": 12345,
    "tx_count": 3
  },
  "signature": "sha256=..."
}`}
          </pre>
          <p className="text-xs text-gray-500">
            Verify webhook signatures using your secret to ensure authenticity.
          </p>
        </div>
      </Card>
    </div>
  );
}
