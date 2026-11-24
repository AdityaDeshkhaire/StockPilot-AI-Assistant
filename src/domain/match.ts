import type { ASN, DiscrepancyType, GoodsReceipt, POLine, POStatus, ReceiptLine, ReceiptStatus } from './types';

export interface MatchFlag {
  type: DiscrepancyType;
  qty_variance: number;
  note: string;
}

export interface LineMatch {
  receipt_line_id: string;
  po_line_id: string;
  open_qty: number;
  good_qty: number;
  qty_accepted: number;
  flags: MatchFlag[];
}

export interface MatchResult {
  lines: LineMatch[];
  status: ReceiptStatus;
  poLineUpdates: { po_line_id: string; received_qty: number }[];
  poStatus: POStatus;
  asnNotes: string[];
}

/**
 * Three-way match: PO line vs. receipt line (what the clerk counted) vs. ASN / packing slip.
 * openQty = ordered − already received; good = received − damaged; tolerance = max(1, pct% of openQty).
 * Short quantity counts only units physically missing (openQty − received) so damaged units are not claimed twice.
 */
export function performThreeWayMatch(
  receipt: GoodsReceipt,
  receiptLines: ReceiptLine[],
  poLines: POLine[],
  asn: ASN | null | undefined,
  tolerancePct = 2,
): MatchResult {
  void receipt;
  const lines: LineMatch[] = [];
  const asnNotes: string[] = [];
  const updates = new Map<string, number>(poLines.map((l) => [l.po_line_id, l.received_qty]));

  for (const rl of receiptLines) {
    const pol = poLines.find((p) => p.po_line_id === rl.po_line_id);
    if (!pol) continue;
    const openQty = Math.max(0, pol.ordered_qty - pol.received_qty);
    const good = Math.max(0, rl.qty_received - rl.qty_damaged);
    const tolerance = Math.max(1, (tolerancePct / 100) * openQty);
    const flags: MatchFlag[] = [];
    let accepted = Math.min(good, openQty);

    if (good > openQty) {
      accepted = openQty;
      flags.push({ type: 'Over', qty_variance: good - openQty, note: `${good - openQty} more good units than open quantity` });
    } else if (openQty - good > tolerance) {
      const missing = Math.max(0, openQty - rl.qty_received);
      if (missing > 0) flags.push({ type: 'Short', qty_variance: missing, note: `${missing} units not delivered` });
    }
    if (rl.qty_damaged > 0) {
      flags.push({ type: 'Damaged', qty_variance: rl.qty_damaged, note: `${rl.qty_damaged} units damaged on arrival` });
    }
    const wrong = rl.qty_wrong_item ?? 0;
    if (wrong > 0) {
      flags.push({ type: 'Wrong_Item', qty_variance: wrong, note: `${wrong} units of a different item were delivered` });
    }
    if (rl.slip_unit_price !== undefined && Math.abs(rl.slip_unit_price - pol.unit_price) > 0.005) {
      flags.push({
        type: 'Price_Mismatch',
        qty_variance: 0,
        note: `Packing slip price ${rl.slip_unit_price.toFixed(2)} vs PO price ${pol.unit_price.toFixed(2)}`,
      });
    }

    if (asn) {
      const asnLine = asn.lines.find((a) => a.po_line_id === rl.po_line_id);
      if (!asnLine) asnNotes.push(`PO line ${rl.po_line_id} not on ASN`);
      else if (asnLine.qty_shipped !== rl.qty_received)
        asnNotes.push(`PO line ${rl.po_line_id}: ASN says ${asnLine.qty_shipped} shipped, ${rl.qty_received} counted`);
    }

    updates.set(pol.po_line_id, pol.received_qty + accepted);
    lines.push({ receipt_line_id: rl.receipt_line_id, po_line_id: rl.po_line_id, open_qty: openQty, good_qty: good, qty_accepted: accepted, flags });
  }

  const totalAccepted = lines.reduce((s, l) => s + l.qty_accepted, 0);
  const anyFlags = lines.some((l) => l.flags.length > 0);
  const status: ReceiptStatus = totalAccepted === 0 ? 'Rejected' : anyFlags ? 'Partially_Accepted' : 'Accepted';

  const poLineUpdates = [...updates.entries()].map(([po_line_id, received_qty]) => ({ po_line_id, received_qty }));
  const fullyReceived = poLines.every((l) => (updates.get(l.po_line_id) ?? 0) >= l.ordered_qty);
  const anyReceived = poLineUpdates.some((u) => u.received_qty > 0);
  const poStatus: POStatus = fullyReceived ? 'Received' : anyReceived ? 'Partially_Received' : 'Acknowledged';

  return { lines, status, poLineUpdates, poStatus, asnNotes };
}
