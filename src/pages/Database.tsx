import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, TABLE_NAMES, type TableName } from '../db/schema';
import { Card, Empty, PageHeader, TableWrap } from '../components/ui';

const PAGE = 50;

export function DatabaseViewer() {
  const [table, setTable] = useState<TableName>('purchase_requisitions');
  const [page, setPage] = useState(0);
  const counts = useLiveQuery(async () => Object.fromEntries(await Promise.all(TABLE_NAMES.map(async (t) => [t, await db.table(t).count()] as const))), []) ?? {};
  const rows = useLiveQuery(() => db.table(table).offset(page * PAGE).limit(PAGE).toArray(), [table, page]) ?? [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const total = (counts as Record<string, number>)[table] ?? 0;

  return (
    <div>
      <PageHeader title="Database" subtitle="Live view of every IndexedDB table — matches the report's ERD and data dictionary." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABLE_NAMES.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTable(t);
              setPage(0);
            }}
            className={`rounded-md px-2.5 py-1 font-mono text-xs ${table === t ? 'bg-navy text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'}`}
          >
            {t} <span className="opacity-60">({(counts as Record<string, number>)[t] ?? 0})</span>
          </button>
        ))}
      </div>
      <Card
        title={<span className="font-mono">{table}</span>}
        actions={
          total > PAGE && (
            <div className="flex items-center gap-2 text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="disabled:opacity-30">
                ←
              </button>
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
              <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} className="disabled:opacity-30">
                →
              </button>
            </div>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty>Table is empty.</Empty>
        ) : (
          <TableWrap>
            <table className="table font-mono text-xs">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => {
                      const v = (r as Record<string, unknown>)[c];
                      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                      return (
                        <td key={c} className="max-w-[20rem] truncate" title={s}>
                          {s}
                        </td>
                      );
                    })}
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
