import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/schema';
import { AIPanel, Button, Card, Empty, ErrorCard, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { useMaps } from '../hooks';
import { round2, usd } from '../domain/util';
import type { Discrepancy, Resolution } from '../domain/types';
import { approveClaim, draftClaim, getSuggestedResolutions } from '../services/workflow';
import { notify } from '../services/events';
import { useUser } from '../auth/session';

const RESOLUTIONS: Resolution[] = ['Credit_Requested', 'Replacement_Requested', 'Returned', 'Accepted_As_Is'];

export function Discrepancies() {
  const discs = useLiveQuery(() => db.discrepancies.toArray(), []) ?? [];
  const [params, setParams] = useSearchParams();
  const groups = new Map<string, Discrepancy[]>();
  for (const d of discs) groups.set(d.receipt_id ?? '?', [...(groups.get(d.receipt_id ?? '?') ?? []), d]);
  const receiptIds = [...groups.keys()].sort().reverse();
  const selected = params.get('receipt') ?? receiptIds.find((r) => groups.get(r)!.some((d) => d.claim_status !== 'Sent')) ?? receiptIds[0];

  return (
    <div className="space-y-5">
      <PageHeader title="Discrepancies" subtitle="Found by the three-way match. The Discrepancy agent drafts the vendor claim; you choose resolutions and send." />
      {receiptIds.length === 0 ? (
        <Empty>No discrepancies. They appear here when a receipt is short, over, damaged, wrong, or mispriced.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-4">
          <Card title="Receipts" className="lg:col-span-1">
            <ul className="space-y-1">
              {receiptIds.map((r) => {
                const ds = groups.get(r)!;
                const sent = ds.every((d) => d.claim_status === 'Sent');
                return (
                  <li key={r}>
                    <button
                      onClick={() => setParams({ receipt: r })}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selected === r ? 'bg-navy text-white' : 'hover:bg-slate-100'}`}
                    >
                      <span>
                        {r} · {ds[0].po_id}
                      </span>
                      <span className="text-xs">{sent ? 'Sent' : `${ds.length} open`}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="lg:col-span-3">{selected && <ClaimView key={selected} receiptId={selected} discs={groups.get(selected) ?? []} />}</div>
        </div>
      )}
    </div>
  );
}

function ClaimView({ receiptId, discs }: { receiptId: string; discs: Discrepancy[] }) {
  const user = useUser();
  const { product } = useMaps();
  const sent = discs.every((d) => d.claim_status === 'Sent');
  const [email, setEmail] = useState(discs[0]?.vendor_message ?? '');
  const [res, setRes] = useState<Record<string, Resolution>>({});
  const [instr, setInstr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setEmail(discs[0]?.vendor_message ?? ''), [discs[0]?.vendor_message]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getSuggestedResolutions(receiptId).then((s) => {
      const init: Record<string, Resolution> = {};
      for (const d of discs) init[d.discrepancy_id] = d.resolution !== 'Pending' ? d.resolution : (s[d.discrepancy_id] ?? 'Credit_Requested');
      setRes(init);
    });
  }, [receiptId, discs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const computed = round2(discs.filter((d) => ['Short', 'Damaged', 'Wrong_Item'].includes(d.type)).reduce((s, d) => s + d.qty_variance * (d.unit_price ?? 0), 0));
  const claimed = discs[0]?.claimed_amount ?? 0;

  return (
    <div className="space-y-4">
      <Card title={`Receipt ${receiptId} · PO ${discs[0]?.po_id}`}>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Item</th>
                <th>Type</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Value</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {discs.map((d) => (
                <tr key={d.discrepancy_id}>
                  <td className="font-medium">{d.discrepancy_id}</td>
                  <td>{product(d.product_id)?.name}</td>
                  <td>
                    <StatusChip status={d.type} />
                  </td>
                  <td className="text-right tabular-nums">{d.qty_variance}</td>
                  <td className="text-right tabular-nums">{usd(d.qty_variance * (d.unit_price ?? 0))}</td>
                  <td>
                    {sent ? (
                      <StatusChip status={d.resolution} />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {RESOLUTIONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setRes({ ...res, [d.discrepancy_id]: r })}
                            className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${res[d.discrepancy_id] === r ? 'bg-navy text-white ring-navy' : 'text-slate-600 ring-slate-300 hover:bg-slate-100'}`}
                          >
                            {r.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span>
            Agent claimed: <strong>{usd(claimed)}</strong>
          </span>
          <span>
            Rule check: <strong>{usd(computed)}</strong> {Math.abs(claimed - computed) < 0.01 ? '✓' : '⚠ differs'}
          </span>
        </div>
      </Card>

      <AIPanel title={`Receiving Discrepancy agent — ${discs[0]?.claim_subject ?? 'claim draft'}`}>
        {sent ? (
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800">{discs[0]?.vendor_message}</pre>
        ) : (
          <textarea className="input mt-1 font-mono text-xs text-slate-800" rows={16} value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </AIPanel>

      {err && <ErrorCard title="Action blocked">{err}</ErrorCard>}

      {!sent && (
        <Card>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="label">Instruction for regeneration (optional)</label>
              <input className="input" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="e.g. Ask for replacement milk by Wednesday instead of credit" />
            </div>
            <Button
              variant="ai"
              busy={busy === 'regen'}
              onClick={async () => {
                setBusy('regen');
                await draftClaim(receiptId, instr || undefined);
                setInstr('');
                setBusy(null);
              }}
            >
              ✦ Regenerate draft
            </Button>
            <Button
              busy={busy === 'send'}
              onClick={async () => {
                setBusy('send');
                setErr(null);
                try {
                  await approveClaim(receiptId, user, email, res);
                  notify({ kind: 'success', title: 'Claim approved and sent to vendor' });
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
                setBusy(null);
              }}
            >
              Approve &amp; send
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
