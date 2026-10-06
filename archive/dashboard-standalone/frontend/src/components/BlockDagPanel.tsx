import { useRef, useState } from 'react';
import { PanelTabs, Button, Select, SelectItem, Badge } from '@/components/ui';
import { ZoomIn, ZoomOut, RotateCcw, Target } from 'lucide-react';
import type { ApiState, ApiDagBlock } from '../types';

interface BlockDagPanelProps {
  state: ApiState | null;
  loading: boolean;
}

export function BlockDagPanel({ state, loading }: BlockDagPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const handleViewModeChange = (id: string) => setViewMode(id as 'graph' | 'list');
  const [selectedBlock, setSelectedBlock] = useState<ApiDagBlock | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const blocks = state?.node?.dag || [];
  const tips = state?.node?.tips || [];
  const selectedTip = state?.node?.selected_tip || '';

  const getBlockPosition = (block: ApiDagBlock, index: number) => {
    const col = Math.floor(index / 20);
    const row = index % 20;
    return {
      x: 50 + col * 120,
      y: 50 + row * 60,
    };
  };

  const filteredBlocks = blocks.filter(b => {
    if (filter === 'blue') return b.colour === 'blue';
    if (filter === 'red') return b.colour === 'red';
    if (filter === 'tips') return tips.includes(b.id);
    return true;
  });

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.1, Math.min(5, prev.scale - e.deltaY * 0.001)),
    }));
  };

  const handlePan = (e: React.MouseEvent) => {
    if (e.button !== 1 && !(e.button === 0 && e.shiftKey)) return;
    const startX = e.clientX - transform.x;
    const startY = e.clientY - transform.y;
    const moveHandler = (me: MouseEvent) => {
      setTransform(prev => ({
        ...prev,
        x: me.clientX - startX,
        y: me.clientY - startY,
      }));
    };
    const upHandler = () => {
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
    };
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
  };

  /**
   * Touch: one finger pans, two fingers pinch-zoom. Without this the graph is
   * completely unusable on touch devices (wheel/mouse handlers never fire).
   */
  const touchState = useRef<{
    dist: number;
    startCx: number;
    startCy: number;
    startX: number;
    startY: number;
    startScale: number;
  } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const base = { startX: transform.x, startY: transform.y, startScale: transform.scale };
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      touchState.current = {
        ...base,
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startCx: (a.clientX + b.clientX) / 2,
        startCy: (a.clientY + b.clientY) / 2,
      };
    } else if (e.touches.length === 1) {
      touchState.current = {
        ...base,
        dist: 0,
        startCx: e.touches[0].clientX,
        startCy: e.touches[0].clientY,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const st = touchState.current;
    if (!st) return;
    e.preventDefault();

    if (e.touches.length === 2 && st.dist > 0) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      const scale = Math.max(0.1, Math.min(5, st.startScale * (dist / st.dist)));
      const ratio = scale / st.startScale;
      // Keep the content point that was under the start midpoint pinned to the
      // current midpoint, so the gesture feels anchored rather than drifting.
      setTransform({
        scale,
        x: cx - (st.startCx - st.startX) * ratio,
        y: cy - (st.startCy - st.startY) * ratio,
      });
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - st.startCx;
      const dy = e.touches[0].clientY - st.startCy;
      setTransform({ scale: st.startScale, x: st.startX + dx, y: st.startY + dy });
    }
  };

  const handleTouchEnd = () => {
    touchState.current = null;
  };

  const resetView = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const centerOnSelected = () => {
    if (selectedBlock && svgRef.current) {
      const pos = getBlockPosition(selectedBlock, blocks.indexOf(selectedBlock));
      const svg = svgRef.current.getBoundingClientRect();
      setTransform({
        x: svg.width / 2 - pos.x * transform.scale,
        y: svg.height / 2 - pos.y * transform.scale,
        scale: transform.scale,
      });
    }
  };

  return (
    <div className="h-[calc(100vh-200px)] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">BlockDAG Explorer</h2>
          <Badge variant={loading ? 'warn' : 'ok'}>{loading ? 'Loading…' : `${blocks.length} blocks`}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={setFilter} className="w-40">
            <SelectItem value="all">All Blocks</SelectItem>
            <SelectItem value="blue">Blue Only</SelectItem>
            <SelectItem value="red">Red Only</SelectItem>
            <SelectItem value="tips">Tips Only</SelectItem>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setTransform(p => ({ ...p, scale: p.scale * 1.2 }))}><ZoomIn size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={() => setTransform(p => ({ ...p, scale: p.scale / 1.2 }))}><ZoomOut size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={resetView}><RotateCcw size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={centerOnSelected} disabled={!selectedBlock}><Target size={16} /></Button>
        </div>
      </div>

      <PanelTabs
        tabs={[
          { id: 'graph', label: 'Graph View' },
          { id: 'list', label: 'List View' },
        ]}
        activeTab={viewMode}
        onTabChange={handleViewModeChange}
      />

      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'graph' ? (
          <div
            className="w-full h-full bg-surface border border-border rounded-lg touch-none"
            onWheel={handleWheel}
            onMouseDown={handlePan}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            style={{ cursor: 'grab' }}
          >
            <svg
              ref={svgRef}
              className="w-full h-full"
              style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
            >
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#6b6b74" />
                </marker>
              </defs>
              {filteredBlocks.map(block => {
                const pos = getBlockPosition(block, blocks.indexOf(block));
                return block.parents.map(parentId => {
                  const parent = blocks.find(b => b.id === parentId);
                  if (!parent) return null;
                  const ppos = getBlockPosition(parent, blocks.indexOf(parent));
                  return (
                    <line
                      key={`${block.id}-${parentId}`}
                      x1={pos.x + 20} y1={pos.y + 20}
                      x2={ppos.x + 20} y2={ppos.y + 20}
                      stroke="#2a2a30"
                      strokeWidth={1.5 / transform.scale}
                      markerEnd="url(#arrow)"
                      opacity={0.5}
                    />
                  );
                });
              })}
              {filteredBlocks.map((block, idx) => {
                const pos = getBlockPosition(block, idx);
                const isTip = tips.includes(block.id);
                const isSelectedTip = block.id === selectedTip;
                const isSelected = selectedBlock?.id === block.id;

                const fillColor = isSelected
                  ? '#d8d4cc'
                  : isSelectedTip
                  ? '#F2A900'
                  : isTip
                  ? '#7d9a7a'
                  : block.colour === 'blue'
                  ? '#2fbaa4'
                  : '#b08980';

                return (
                  <g
                    key={block.id}
                    onClick={() => setSelectedBlock(block)}
                    style={{ cursor: 'pointer' }}
                    transform={`translate(${pos.x}, ${pos.y})`}
                  >
                    <rect
                      x={0} y={0} width={40} height={40}
                      rx={4} ry={4}
                      fill={fillColor}
                      stroke={isSelected ? '#d8d4cc' : '#2a2a30'}
                      strokeWidth={isSelected ? 3 / transform.scale : 1.5 / transform.scale}
                      filter={isSelected ? 'drop-shadow(0 0 4px #d8d4cc)' : 'none'}
                    />
                    <text
                      x={20} y={26}
                      textAnchor="middle"
                      fontSize={10 / transform.scale}
                      fill={isSelected ? '#0a0a0b' : '#f2f1ee'}
                      fontFamily="monospace"
                      pointerEvents="none"
                    >
                      {idx + 1}
                    </text>
                    <text
                      x={20} y={38}
                      textAnchor="middle"
                      fontSize={7 / transform.scale}
                      fill={isSelected ? '#0a0a0b' : '#9a9aa3'}
                      fontFamily="monospace"
                      pointerEvents="none"
                    >
                      {block.id.slice(0, 4)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="w-full h-full bg-surface border border-border rounded-lg overflow-auto">
            <table className="w-full min-w-[640px] md:min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2">Height</th>
                  <th className="text-left p-2">ID</th>
                  <th className="text-left p-2">Blue</th>
                  <th className="text-left p-2">Parents</th>
                  <th className="text-left p-2">TXs</th>
                  <th className="text-left p-2">Miner</th>
                  <th className="text-left p-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredBlocks.slice().reverse().map((block, i) => (
                  <tr
                    key={block.id}
                    onClick={() => setSelectedBlock(block)}
                    className={`hover:bg-surface-2 cursor-pointer ${selectedBlock?.id === block.id ? 'bg-accent/10' : ''}`}
                  >
                    <td className="p-2 font-mono">{filteredBlocks.length - i}</td>
                    <td className="p-2 font-mono">{block.id.slice(0, 16)}…</td>
                    <td className="p-2">
                      <Badge variant={block.colour === 'blue' ? 'ok' : 'danger'}>
                        {block.colour === 'genesis' ? 'Genesis' : block.colour === 'blue' ? 'Blue' : 'Red'}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{block.parents.length}</td>
                    <td className="p-2">{block.txs.length}</td>
                    <td className="p-2 font-mono text-xs">{block.work}</td>
                    <td className="p-2 text-muted">{new Date(block.timestamp_ms).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedBlock && (
          <div className="absolute right-4 top-4 bottom-4 w-80 max-w-[calc(100%-2rem)] bg-surface border border-border rounded-lg shadow-xl p-4 overflow-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 min-w-0">
              <h3 className="font-display font-medium">Block Details</h3>
              <button onClick={() => setSelectedBlock(null)} className="text-muted hover:text-fg">×</button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="text-muted">ID:</span> <code className="font-mono block break-all">{selectedBlock.id}</code></div>
              <div><span className="text-muted">Blue Score:</span> <code className="font-mono">{selectedBlock.blue_score}</code></div>
              <div><span className="text-muted">Status:</span> <Badge variant={selectedBlock.colour === 'blue' ? 'ok' : 'danger'}>{selectedBlock.colour === 'genesis' ? 'Genesis' : selectedBlock.colour === 'blue' ? 'Blue' : 'Red'}</Badge></div>
              <div><span className="text-muted">Parents:</span> <div className="text-xs text-muted">{selectedBlock.parents.map(p => p.slice(0, 12) + '…').join(', ')}</div></div>
              <div><span className="text-muted">Selected Parent:</span> <code className="font-mono text-xs">{selectedBlock.selected_parent ? selectedBlock.selected_parent.slice(0, 12) + '…' : 'none (genesis)'}</code></div>
              <div><span className="text-muted">TXs:</span> {selectedBlock.txs.length}</div>
              <div><span className="text-muted">Work:</span> <code className="font-mono text-xs">{selectedBlock.work}</code></div>
              <div><span className="text-muted">Nonce:</span> <code className="font-mono text-xs">{selectedBlock.nonce}</code></div>
              <div><span className="text-muted">Timestamp:</span> {new Date(selectedBlock.timestamp_ms).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}