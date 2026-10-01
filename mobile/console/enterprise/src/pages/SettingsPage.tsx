import React, { useState } from 'react';
import { Card } from '../../../shared/src/components';

export function SettingsPage() {
  const [settings, setSettings] = useState({
    apiUrl: 'https://explorer.kovanica.online',
    notifications: true,
    emailAlerts: false,
    autoSync: true,
    syncInterval: '30',
    currency: 'KVNC',
    language: 'en',
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Settings</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="API Configuration">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
              <input
                type="url"
                value={settings.apiUrl}
                onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Default: https://explorer.kovanica.online</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sync Interval (seconds)</label>
              <input
                type="number"
                value={settings.syncInterval}
                onChange={(e) => setSettings({ ...settings, syncInterval: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
                min="10"
                max="300"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Auto-sync</span>
              <button
                onClick={() => setSettings({ ...settings, autoSync: !settings.autoSync })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.autoSync ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.autoSync ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </Card>

        <Card title="Notifications">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Push Notifications</div>
                <div className="text-xs text-gray-500">Receive notifications for important events</div>
              </div>
              <button
                onClick={() => setSettings({ ...settings, notifications: !settings.notifications })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.notifications ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.notifications ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Email Alerts</div>
                <div className="text-xs text-gray-500">Get email alerts for critical events</div>
              </div>
              <button
                onClick={() => setSettings({ ...settings, emailAlerts: !settings.emailAlerts })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.emailAlerts ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.emailAlerts ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </Card>

        <Card title="Display">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency Display</label>
              <select
                value={settings.currency}
                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="KVNC">KVNC</option>
                <option value="atoms">Atoms</option>
                <option value="USD">USD (estimated)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="en">English</option>
                <option value="es">Espanol</option>
                <option value="de">Deutsch</option>
                <option value="fr">Francais</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Security">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Two-Factor Authentication</div>
                <div className="text-xs text-gray-500">Add an extra layer of security</div>
              </div>
              <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                Enable
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Session Timeout</div>
                <div className="text-xs text-gray-500">Auto-logout after inactivity</div>
              </div>
              <select className="px-3 py-1 border rounded-md text-sm">
                <option>30 minutes</option>
                <option>1 hour</option>
                <option>4 hours</option>
                <option>Never</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">API Key Rotation</div>
                <div className="text-xs text-gray-500">Last rotated: Never</div>
              </div>
              <button className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
                Rotate Now
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Danger Zone">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg">
            <div>
              <div className="text-sm font-medium text-red-700">Reset Local Data</div>
              <div className="text-xs text-red-500">Clear all cached data and re-sync from scratch</div>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm">
              Reset
            </button>
          </div>
          <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg">
            <div>
              <div className="text-sm font-medium text-red-700">Revoke All API Keys</div>
              <div className="text-xs text-red-500">Immediately invalidate all active API keys</div>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm">
              Revoke All
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
