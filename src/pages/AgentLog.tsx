import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/schema';
import { Button, Card, Chip, Empty, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { useMaps } from '../hooks';
import type { AgentActionLog } from '../domain/types';

const AGENTS = ['Replenishment Planner', 'Procurement', 'Vendor Expediting', 'Receiving Discrepancy', 'Inventory Insights', 'System Rules'];
const DECISIONS = ['Pending', 'Approved', 'Approved_With_Edits', 'Rejected', 'Auto_Approved', 'No_Action'];

function toCsv(rows: AgentActionLog[]): string {
  const cols: (keyof AgentActionLog)[] = ['log_id', 'agent_name', 'action_type', 'entity_type', 'entity_id', 'output_summary', 'human_decision', 'decided_by', 'created_at'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function AgentLog() {
  const rows = useLiveQuery(() => db.agent_action_log.orderBy('created_at').reverse().toArray(), []) ?? [];
  const { userName } = useMaps();
  const [agent, setAgent] = useState('');
  const [decision, setDecision] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [copied, setCopied] = useState(false);
  const filtered = rows.filter(
    (r) => (!agent || r.agent_name === agent) && (!decision || r.human_decision === decision) && (!from || r.created_at.slice(0, 10) >= from) && (!to || r.created_at.slice(0, 10) <= to),
  );

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent_action_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Agent Activity Log"
        subtitle="Every AI draft and every rule or human decision, in one audit trail."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(toCsv(filtered));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy CSV'}
            </Button>
            <Button onClick={exportCsv}>Export CSV</Button>
          </>
        }
      />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <select className="input max-w-[14rem]" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {AGENTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select className="input max-w-[14rem]" value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="">All decisions</option>
            {DECISIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input type="date" className="input max-w-[11rem]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input max-w-[11rem]" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <span className="self-center text-sm text-slate-500">{filtered.length} rows</span>
        </div>
        {filtered.length === 0 ? (
          <Empty>No log entries match.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th className="w-[40%]">Output summary</th>
                  <th>Decision</th>
                  <th>Decided by</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.log_id}>
                    <td className="whitespace-nowrap text-xs text-slate-500">{r.created_at.replace('T', ' ')}</td>
                    <td>
                      <Chip tone={r.agent_name === 'System Rules' ? 'navy' : 'purple'}>{r.agent_name}</Chip>
                    </td>
                    <td className="text-xs">{r.action_type.replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap text-xs">{r.entity_id}</td>
                    <td className="text-xs">{r.output_summary}</td>
                    <td>
                      <StatusChip status={r.human_decision} />
                    </td>
                    <td className="text-xs">{r.decided_by ? userName(r.decided_by) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
