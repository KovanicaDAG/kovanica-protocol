import React, { useState } from 'react';
import { Card } from '../../../shared/src/components';

export function DeveloperPage() {
  const [activeTab, setActiveTab] = useState<'api' | 'examples' | 'tools'>('api');

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Developer Tools</h2>

      <div className="flex gap-2">
        {(['api', 'examples', 'tools'] as const).map((tab) => (
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

      {activeTab === 'api' && (
        <Card title="API Reference">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">GET Endpoints</h4>
              <div className="space-y-1 text-sm font-mono">
                <div className="p-2 bg-gray-50 rounded">/api/head</div>
                <div className="p-2 bg-gray-50 rounded">/api/bootstrap</div>
                <div className="p-2 bg-gray-50 rounded">/api/blocks</div>
                <div className="p-2 bg-gray-50 rounded">/api/blocks/{"{id}"}</div>
                <div className="p-2 bg-gray-50 rounded">/api/balance/{"{address}"}</div>
                <div className="p-2 bg-gray-50 rounded">/api/utxos/{"{address}"}</div>
                <div className="p-2 bg-gray-50 rounded">/api/tx/{"{id}"}</div>
                <div className="p-2 bg-gray-50 rounded">/api/history/{"{address}"}</div>
                <div className="p-2 bg-gray-50 rounded">/api/p2p</div>
              </div>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-2">POST Endpoints</h4>
              <div className="space-y-1 text-sm font-mono">
                <div className="p-2 bg-gray-50 rounded">/api/prepare</div>
                <div className="p-2 bg-gray-50 rounded">/api/submit</div>
                <div className="p-2 bg-gray-50 rounded">/api/prepare/htlc/create</div>
                <div className="p-2 bg-gray-50 rounded">/api/prepare/htlc/redeem</div>
                <div className="p-2 bg-gray-50 rounded">/api/prepare/htlc/refund</div>
                <div className="p-2 bg-gray-50 rounded">/api/multisig/create</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'examples' && (
        <Card title="Code Examples">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">JavaScript / TypeScript</h4>
              <pre className="bg-gray-900 text-green-400 p-3 rounded-md overflow-x-auto text-xs">
{`// Get chain head
const res = await fetch('https://explorer.kovanica.online/api/head');
const head = await res.json();
console.log('Chain height:', head.chain_height);

// Get balance
const bal = await fetch('https://explorer.kovanica.online/api/balance/kvnc1...');
const balance = await bal.json();
console.log('Balance:', balance.balance, 'atoms');`}
              </pre>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-2">cURL</h4>
              <pre className="bg-gray-900 text-green-400 p-3 rounded-md overflow-x-auto text-xs">
{`# Get chain head
curl https://explorer.kovanica.online/api/head

# Get balance
curl https://explorer.kovanica.online/api/balance/kvnc1...

# Prepare transaction
curl -X POST https://explorer.kovanica.online/api/prepare \\
  -H "Content-Type: application/json" \\
  -d '{"from":"kvnc1...","to":"kvnc1...","amount":"10000000000"}'`}
              </pre>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-2">Rust</h4>
              <pre className="bg-gray-900 text-green-400 p-3 rounded-md overflow-x-auto text-xs">
{`use kovanica_client::KovanicaClient;

let client = KovanicaClient::new("https://explorer.kovanica.online");
let head = client.head().await?;
println!("Chain height: {}", head.chain_height);

let balance = client.balance("kvnc1...").await?;
println!("Balance: {} atoms", balance.balance);`}
              </pre>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'tools' && (
        <Card title="Developer Tools">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">Transaction Builder</h4>
              <p className="text-sm text-gray-600 mb-3">Build and sign transactions offline</p>
              <div className="space-y-3">
                <input type="text" placeholder="From address" className="w-full px-3 py-2 border rounded-md text-sm font-mono" />
                <input type="text" placeholder="To address" className="w-full px-3 py-2 border rounded-md text-sm font-mono" />
                <input type="text" placeholder="Amount (atoms)" className="w-full px-3 py-2 border rounded-md text-sm" />
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
                  Build Transaction
                </button>
              </div>
            </div>
            <hr />
            <div>
              <h4 className="font-medium text-sm mb-2">Address Validator</h4>
              <div className="flex gap-2">
                <input type="text" placeholder="Enter address to validate..." className="flex-1 px-3 py-2 border rounded-md text-sm font-mono" />
                <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm">
                  Validate
                </button>
              </div>
            </div>
            <hr />
            <div>
              <h4 className="font-medium text-sm mb-2">Unit Converter</h4>
              <div className="flex gap-2 items-center">
                <input type="text" placeholder="Amount" className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <select className="px-3 py-2 border rounded-md text-sm">
                  <option>Atoms</option>
                  <option>KVNC</option>
                </select>
                <span className="text-gray-400">=</span>
                <input type="text" placeholder="Result" className="flex-1 px-3 py-2 border rounded-md text-sm" readOnly />
                <select className="px-3 py-2 border rounded-md text-sm">
                  <option>KVNC</option>
                  <option>Atoms</option>
                </select>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
