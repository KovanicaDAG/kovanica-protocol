import React, { useState } from 'react';
import { Card } from '../../../shared/src/components';

export function MultisigPage() {
  const [threshold, setThreshold] = useState(2);
  const [pubkeys, setPubkeys] = useState(['', '', '']);
  const [result, setResult] = useState<{ address: string; redeem_script: string } | null>(null);

  const handleCreate = () => {
    // In production, this would call the API
    setResult({
      address: 'kvnc1multisig' + Math.random().toString(36).slice(2, 10),
      redeem_script: '5221' + pubkeys.map(() => '21' + '00'.repeat(32)).join('') + '53ae',
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Multisig (M-of-N)</h2>

      <Card title="Create Multisig Address">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Threshold (M)
            </label>
            <input
              type="number"
              min={1}
              max={pubkeys.length}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="w-24 px-3 py-2 border rounded-md text-sm"
            />
            <span className="ml-2 text-sm text-gray-500">of {pubkeys.length} required</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Public Keys (N)
            </label>
            <div className="space-y-2">
              {pubkeys.map((pk, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Public key #${i + 1}...`}
                    value={pk}
                    onChange={(e) => {
                      const newPubkeys = [...pubkeys];
                      newPubkeys[i] = e.target.value;
                      setPubkeys(newPubkeys);
                    }}
                    className="flex-1 px-3 py-2 border rounded-md text-sm font-mono"
                  />
                  {pubkeys.length > 2 && (
                    <button
                      onClick={() => setPubkeys(pubkeys.filter((_, j) => j !== i))}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pubkeys.length < 10 && (
              <button
                onClick={() => setPubkeys([...pubkeys, ''])}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700"
              >
                + Add Public Key
              </button>
            )}
          </div>

          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            Create Multisig Address
          </button>
        </div>
      </Card>

      {result && (
        <Card title="Multisig Address Created">
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500">Address</div>
              <div className="font-mono text-sm bg-gray-50 p-2 rounded break-all">{result.address}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Redeem Script</div>
              <div className="font-mono text-xs bg-gray-50 p-2 rounded break-all">{result.redeem_script}</div>
            </div>
            <div className="text-sm text-gray-600">
              This {threshold}-of-{pubkeys.length} multisig address requires {threshold} signatures to spend.
            </div>
          </div>
        </Card>
      )}

      <Card title="About Multisig">
        <div className="space-y-2 text-sm text-gray-600">
          <p>Multisig (M-of-N) addresses require M out of N public keys to authorize a transaction.</p>
          <p>This is useful for:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Shared treasury management</li>
            <li>Escrow services</li>
            <li>Corporate governance</li>
            <li>Enhanced security for large holdings</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
