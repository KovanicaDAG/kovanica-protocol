import { Table, StatCard, Badge } from './ui';
import { Shield, Users, Clock, Hash, Info } from 'lucide-react';
import { fmtNumber } from '../hooks/useApi';
import type { ApiState, ApiNetwork } from '../types';

interface ConsensusPanelProps {
  network: ApiNetwork | null;
  state: ApiState | null;
  loading: boolean;
}

/**
 * Read-only view of the PoA authority set.
 *
 * The authority surface lives on `/api/network` — `/api/bootstrap` returns
 * `authority_set: null`, so reading it from there yields nothing at all. This
 * panel is deliberately read-only: authority signing keys live in mode-0600
 * `EnvironmentFile`s on the seed hosts and are never exposed to a browser, so
 * there is nothing here a user could act on beyond inspecting the set.
 *
 * The slot schedule below is FORWARD-LOOKING. The node's explorer payload
 * carries no per-block producer field, so "slots owned so far" cannot be
 * derived from the API and is not shown.
 */
export function ConsensusPanel({ network, state, loading }: ConsensusPanelProps) {
  const set = network?.authority_set ?? null;
  const authorities = set?.authorities ?? [];
  const threshold = set?.threshold ?? 0;
  const slotDuration = network?.slot_duration_ms ?? 0;
  const currentSlot = network?.current_slot ?? 0;

  /**
   * PoA eligibility is round-robin over the authority list, in the order the
   * node reports it: `active_authority(slot) = authorities[slot % len]`
   * (crates/kovanica-dag/src/authority.rs). List order is consensus-significant
   * — the permutation-invariance test depends on it — so it is rendered
   * exactly as received and never sorted.
   */
  const SCHEDULE_AHEAD = 12;
  const schedule = authorities.map((pk, i) => {
    // Next slot this authority is scheduled for, at or after the current slot.
    const offset = (i - (currentSlot % authorities.length) + authorities.length) % authorities.length;
    return {
      pubKey: pk,
      index: i,
      nextSlot: currentSlot + offset,
      offset,
      isNow: offset === 0,
    };
  }).sort((a, b) => a.nextSlot - b.nextSlot).slice(0, SCHEDULE_AHEAD);

  const statCards = [
    {
      label: 'Authorities',
      value: set ? `${set.count}` : '—',
      trend: `threshold ${threshold} of ${set?.count ?? 0}`,
      icon: <Users size={24} className="text-blue" />,
    },
    {
      label: 'Slot Duration',
      value: slotDuration ? `${fmtNumber(slotDuration)} ms` : '—',
      trend: 'fixed, no gap-fill',
      icon: <Clock size={24} className="text-gold" />,
    },
    {
      label: 'Current Slot',
      value: fmtNumber(currentSlot),
      trend: network ? `${fmtNumber(network.time_to_next_slot_ms)} ms to next` : 'waiting for node',
      icon: <Clock size={24} className="text-gold" />,
    },
    {
      label: 'Blue Score',
      value: fmtNumber(network?.blue_score ?? 0),
      trend: `chain ${fmtNumber(state?.node?.chain_len ?? 0)}`,
      icon: <Hash size={24} className="text-blue" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} trend={c.trend} icon={c.icon} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0 mb-4">
            <h2 className="text-lg font-display flex items-center gap-2">
              <Shield size={18} className="text-gold" />
              Authority Set
            </h2>
            {set && <Badge variant="ok">PoA active</Badge>}
          </div>

          {!set ? (
            <p className="text-sm text-muted">
              {loading ? 'Loading authority set…' : 'This node reports no authority set.'}
            </p>
          ) : (
            <>
              <Table
                headers={['#', 'Authority Public Key', 'Next Slot']}
                rows={schedule.map((s) => [
                  String(s.index),
                  s.pubKey,
                  s.isNow ? `${fmtNumber(s.nextSlot)} (now)` : fmtNumber(s.nextSlot),
                ])}
              />
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Threshold</dt>
                  <dd className="font-mono">{threshold} of {set.count}</dd>
                </div>
                <div className="flex justify-between gap-4 min-w-0">
                  <dt className="text-muted shrink-0">Set hash</dt>
                  <dd className="font-mono truncate">{set.hash}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Schedule rule</dt>
                  <dd className="font-mono text-right">authorities[slot % {set.count}]</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="text-lg font-display mb-4">Consensus Parameters</h2>
          <Table
            headers={['Parameter', 'Value']}
            rows={[
              ['Consensus', 'Proof of Authority'],
              ['Authorities', set ? String(set.count) : '—'],
              ['Threshold', set ? `${threshold} of ${set.count}` : '—'],
              ['Slot duration', slotDuration ? `${fmtNumber(slotDuration)} ms` : '—'],
              ['Current slot', fmtNumber(currentSlot)],
              ['Next slot at', network ? new Date(network.next_slot_timestamp_ms).toISOString() : '—'],
              ['Blue score', fmtNumber(network?.blue_score ?? 0)],
              ['Chain length', fmtNumber(state?.node?.chain_len ?? 0)],
              ['GHOSTDAG k', String(state?.node?.k ?? 3)],
              ['Selected tip', (state?.node?.selected_tip || '—').slice(0, 16)],
            ]}
          />
        </section>
      </div>

      <section className="panel border-l-2 border-l-gold">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-gold shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <h3 className="font-display">This view is read-only, and that is by design</h3>
            <p className="text-muted">
              Block production is PoA: an authority signs a 64-byte signature over the block
              hash, and the node admits it only if the signer is the one scheduled for
              that slot. Those signing keys are held in mode-0600 <code>EnvironmentFile</code>s
              on the seed hosts and are never sent to a browser, so this dashboard cannot
              act as a validator and deliberately offers no way to enter a key.
            </p>
            <p className="text-muted">
              The schedule above is computed forward from the current slot with the
              consensus rule. Historical "slots owned" per authority is not shown because
              the explorer's block payload carries no producer field — it is not knowable
              from the API, and it is not estimated here.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
