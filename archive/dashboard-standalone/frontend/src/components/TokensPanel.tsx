import { useState } from 'react';
import { Table, Badge, Input, Button, Select, SelectItem, SelectContent, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import { Search } from 'lucide-react';
import { fmtNumber, fmtKvnc } from '../hooks/useApi';
import { useDexTokens } from '../hooks/useApi';

interface TokensPanelProps {
  state: any;
  loading: boolean;
}

export function TokensPanel({ state: _state, loading }: TokensPanelProps) {
  const [activeTab, setActiveTab] = useState<'dex' | 'tokens' | 'nfts' | 'collections' | 'create'>('dex');
  const [search, setSearch] = useState('');

  const { data: dexTokens, isLoading: dexLoading } = useDexTokens();

  const [tokenId, setTokenId] = useState('');
  const [nftId, setNftId] = useState('');
  const [collectionId, setCollectionId] = useState('');

  // Create Token form state
  const [createForm, setCreateForm] = useState({
    name: '',
    symbol: '',
    decimals: '8',
    totalSupply: '',
    assetType: 'fungible', // 'fungible' | 'nft'
    royaltyBps: '0',
    metadataUri: '',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string; assetId?: string } | null>(null);

  const handleTabChange = (id: string) => setActiveTab(id as 'dex' | 'tokens' | 'nfts' | 'collections' | 'create');

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateResult(null);
    
    try {
      const response = await fetch('/api/token/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          symbol: createForm.symbol,
          decimals: parseInt(createForm.decimals, 10),
          total_supply: BigInt(createForm.totalSupply).toString(),
          asset_type: createForm.assetType,
          royalty_bps: parseInt(createForm.royaltyBps, 10),
          metadata_uri: createForm.metadataUri,
        }),
      });
      
      const result = await response.json();
      if (response.ok) {
        setCreateResult({ success: true, message: 'Token created successfully!', assetId: result.asset_id });
        // Reset form
        setCreateForm({
          name: '',
          symbol: '',
          decimals: '8',
          totalSupply: '',
          assetType: 'fungible',
          royaltyBps: '0',
          metadataUri: '',
        });
      } else {
        setCreateResult({ success: false, message: result.error || 'Failed to create token' });
      }
    } catch (error) {
      setCreateResult({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-foreground">Tokens & Assets</h2>
          <Badge variant={loading ? 'warning' : 'success'}>KVP-102/106</Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dex">DEX Tokens</TabsTrigger>
          <TabsTrigger value="tokens">Tokens (KVP-102)</TabsTrigger>
          <TabsTrigger value="nfts">NFTs (KVP-106)</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="create">Create Token</TabsTrigger>
        </TabsList>

        <TabsContent value="dex">
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  type="text"
                  placeholder="Search DEX tokens…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="input pl-8 w-full sm:w-64 max-w-full"
                />
              </div>
            </div>
            <div className="panel overflow-auto">
              {dexLoading ? (
                <p className="text-muted-foreground text-center py-8">Loading DEX tokens…</p>
              ) : dexTokens && dexTokens.length > 0 ? (
                <Table
                  headers={['Asset ID', 'Symbol', 'Name', 'Decimals', 'KVNC Reserve', 'Asset Reserve', 'Price (KVNC)', '24h Volume']}
                  rows={dexTokens
                    .filter(t => t.symbol.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))
                    .map(t => [
                      t.asset_id.slice(0, 16) + '…',
                      t.symbol,
                      t.name,
                      t.decimals,
                      fmtKvnc(t.reserve_kvnc),
                      fmtNumber(t.reserve_asset),
                      t.price_kvnc.toFixed(8),
                      fmtNumber(t.volume_24h),
                    ])}
                />
              ) : (
                <p className="text-muted-foreground text-center py-8">No DEX tokens found</p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tokens">
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Input
                label="Token ID"
                value={tokenId}
                onChange={e => setTokenId(e.target.value)}
                placeholder="Enter token asset ID"
                className="input w-full sm:w-96 max-w-full"
              />
              <Button onClick={() => tokenId && window.open(`/api/token/${tokenId}`, '_blank')}>View Token</Button>
            </div>
            <p className="text-muted-foreground">Use the API Console to query /api/token/&#123;id&#125; for full token details.</p>
          </div>
        </TabsContent>

        <TabsContent value="nfts">
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Input
                label="NFT ID"
                value={nftId}
                onChange={e => setNftId(e.target.value)}
                placeholder="Enter NFT asset ID"
                className="input w-full sm:w-96 max-w-full"
              />
              <Button onClick={() => nftId && window.open(`/api/nft/${nftId}`, '_blank')}>View NFT</Button>
            </div>
            <p className="text-muted-foreground">Use the API Console to query /api/nft/&#123;id&#125; for full NFT details.</p>
          </div>
        </TabsContent>

        <TabsContent value="collections">
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Input
                label="Collection ID"
                value={collectionId}
                onChange={e => setCollectionId(e.target.value)}
                placeholder="Enter collection ID"
                className="input w-full sm:w-96 max-w-full"
              />
              <Button onClick={() => collectionId && window.open(`/api/collection/${collectionId}`, '_blank')}>View Collection</Button>
            </div>
            <p className="text-muted-foreground">Use the API Console to query /api/collection/&#123;id&#125; for full collection details.</p>
          </div>
        </TabsContent>

        <TabsContent value="create">
          <div className="space-y-6 mt-4">
            <div className="panel max-w-2xl">
              <h3 className="font-display text-lg font-medium mb-4">Create New Token / Asset</h3>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Name"
                    value={createForm.name}
                    onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="e.g., My Token"
                    required
                  />
                  <Input
                    label="Symbol"
                    value={createForm.symbol}
                    onChange={e => setCreateForm({ ...createForm, symbol: e.target.value })}
                    placeholder="e.g., MTK"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Decimals"
                    type="number"
                    value={createForm.decimals}
                    onChange={e => setCreateForm({ ...createForm, decimals: e.target.value })}
                    placeholder="8"
                    required
                  />
                  <Input
                    label="Total Supply (atoms)"
                    type="number"
                    value={createForm.totalSupply}
                    onChange={e => setCreateForm({ ...createForm, totalSupply: e.target.value })}
                    placeholder="1000000000000"
                    required
                  />
                  <Select value={createForm.assetType} onChange={value => setCreateForm({ ...createForm, assetType: value })} className="w-full">
                    <SelectTrigger>
                      <SelectValue placeholder="Select asset type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fungible">Fungible Token</SelectItem>
                      <SelectItem value="nft">NFT (KVP-106)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Royalty (basis points)"
                    type="number"
                    value={createForm.royaltyBps}
                    onChange={e => setCreateForm({ ...createForm, royaltyBps: e.target.value })}
                    placeholder="0"
                  />
                  <Input
                    label="Metadata URI"
                    value={createForm.metadataUri}
                    onChange={e => setCreateForm({ ...createForm, metadataUri: e.target.value })}
                    placeholder="ipfs://... or https://..."
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" loading={createLoading}>
                    Create Token
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setCreateResult(null)}>
                    Clear Result
                  </Button>
                </div>
                {createResult && (
                  <div className={`p-4 rounded-lg ${createResult.success ? 'bg-green-500/20 border border-green-500/30' : 'bg-destructive/20 border border-destructive/30'}`}>
                    <p className="font-medium">{createResult.success ? 'Success' : 'Error'}</p>
                    <p className="text-sm">{createResult.message}</p>
                    {createResult.assetId && (
                      <p className="text-sm font-mono mt-2">Asset ID: {createResult.assetId}</p>
                    )}
                  </div>
                )}
              </form>
            </div>
            <div className="panel max-w-2xl">
              <h3 className="font-display text-lg font-medium mb-4">Notes</h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Total supply is in atoms (1 token = 10^decimals atoms)</li>
                <li>Fungible tokens use KVP-102 standard</li>
                <li>NFTs use KVP-106 standard with optional royalties</li>
                <li>Metadata URI should point to JSON metadata (IPFS or HTTPS)</li>
                <li>Royalty is in basis points (100 = 1%)</li>
              </ul>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}