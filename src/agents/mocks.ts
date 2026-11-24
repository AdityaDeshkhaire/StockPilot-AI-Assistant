// Realistic canned agent responses. They are computed from the input so the
// demo works with no API key, and they double as the rule-based fallback when
// a live agent returns invalid JSON.
import type { DiscrepancyInput, ExpeditingInput, InsightsInput, ProcurementInput, ReplenishmentInput } from './inputs';
import type { DiscrepancyOutput, ExpeditingOutput, InsightsOutput, ProcurementOutput, ReplenishmentOutput } from './schemas';
import { round2, roundUpToCasePack, usd } from '../domain/util';

const HOLIDAY = new Set(['Dairy', 'Grocery', 'Snacks', 'Beverages']);

export function mockReplenishment(input: ReplenishmentInput): ReplenishmentOutput {
  const event = input.upcoming_events[0];
  const lines = input.items.map((it) => {
    const bump = event && HOLIDAY.has(it.category) ? 1.35 : 1;
    const horizon = it.best_lead_time_days + it.review_cycle_days;
    const forecast = Math.round(it.avg_daily_sales_28d * horizon * bump);
    const need = Math.max(it.max_stock - it.available, forecast + it.safety_stock - it.available);
    const capped = Math.min(need, Math.floor(it.max_stock * 1.1) - it.available);
    const qty = Math.max(it.case_pack, roundUpToCasePack(Math.max(0, capped), it.case_pack));
    const confidence: 'High' | 'Medium' = bump > 1 ? 'Medium' : 'High';
    const diff = it.rule_based_qty ? Math.abs(qty - it.rule_based_qty) / it.rule_based_qty : 0;
    const cover = it.days_of_cover === null ? 'n/a' : it.days_of_cover.toFixed(1);
    const rationale =
      bump > 1
        ? `Avg ${it.avg_daily_sales_28d.toFixed(1)}/day; ${event!.name} week lifts ${it.category.toLowerCase()} demand ~35%. ${cover} days of cover vs ${it.best_lead_time_days}-day lead time. Order to max in cases of ${it.case_pack}.`
        : `Stable sales of ${it.avg_daily_sales_28d.toFixed(1)}/day; ${cover} days of cover. Refill to max stock in cases of ${it.case_pack}.`;
    return {
      product_id: it.product_id,
      recommended_qty: qty,
      forecast_qty: forecast,
      confidence,
      needs_review: diff > 0.25,
      rationale,
    };
  });
  const total = input.items.reduce((s, it, i) => s + lines[i].recommended_qty * it.unit_cost, 0);
  return {
    lines,
    skipped: [],
    summary: `Drafted ${lines.length} line(s) worth about ${usd(total)}${event ? `, sized for ${event.name} (${event.date})` : ''}. Quantities are rounded to case packs and capped at 110% of max stock.`,
  };
}

export function mockProcurement(input: ProcurementInput): ProcurementOutput {
  const vendor_choices = input.lines
    .filter((l) => l.chosen_vendor_id)
    .map((l) => {
      const best = l.scores[0];
      const cheapest = [...l.scores].sort((a, b) => a.unit_price - b.unit_price)[0];
      let reason = `${best.vendor_name} scored highest (${best.score.toFixed(1)}).`;
      if (cheapest && cheapest.vendor_id !== best.vendor_id) {
        reason += cheapest.stockout_risk
          ? ` ${cheapest.vendor_name} was cheapest at ${usd(cheapest.unit_price)} but its ${cheapest.lead_time_days}-day lead time exceeds ${l.days_of_cover?.toFixed(1) ?? 'the'} days of cover (stock-out risk, −25).`
          : ` ${cheapest.vendor_name} was cheapest but scored lower on lead time and reliability.`;
      }
      return { product_id: l.product_id, vendor_id: best.vendor_id, reason };
    });

  const pos = input.po_drafts.map((po) => {
    const reasons = vendor_choices.filter((c) => c.vendor_id === po.vendor_id).map((c) => c.reason);
    const lineText = po.lines
      .map((l) => `  • ${l.name} — ${l.qty} @ ${usd(l.unit_price)} = ${usd(round2(l.qty * l.unit_price))}`)
      .join('\n');
    const tone = input.revision_instruction ? `\n(Revised per manager: ${input.revision_instruction})\n` : '';
    const order_email = `Subject: Purchase Order ${po.po_id} — StockPilot Store #12

Hello ${po.vendor_name} team,
${tone}
Please accept purchase order ${po.po_id} for the items below:

${lineText}

PO total: ${usd(po.total)}
Requested delivery: ${po.expected_delivery_date}
Ship to: ${input.ship_to}

Please acknowledge this order within 48 hours and include your tracking number when it ships.

Thank you,
Aditya Deshkahire
Store Manager, StockPilot Store #12`;
    return {
      vendor_id: po.vendor_id,
      lines: po.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price })),
      order_email,
      selection_note: reasons[0] ?? `${po.vendor_name} selected by in-house scoring.`,
    };
  });
  return { vendor_choices, pos };
}

export function mockExpediting(input: ExpeditingInput): ExpeditingOutput {
  if (input.mode === 'parse_note') {
    const note = input.vendor_note ?? '';
    const date = note.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    return {
      followup_email: null,
      escalate: false,
      parsed_note_summary: note ? `Vendor says: "${note.slice(0, 140)}"${date ? ` — revised delivery ${date}.` : ''}` : 'Vendor acknowledged with no note.',
      revised_delivery_date: date,
    };
  }
  const escalate = input.hours_since_sent >= input.ack_timeout_hours * 2;
  return {
    followup_email: `Subject: Follow-up — PO ${input.po_id} not yet acknowledged

Hello ${input.vendor_name} team,

We sent purchase order ${input.po_id} on ${input.order_date} and have not received an acknowledgement after ${Math.round(input.hours_since_sent)} hours. The order is due on ${input.expected_delivery_date}.

Please confirm receipt of the PO and your ship date today.

Thank you,
StockPilot Store #12 Purchasing`,
    escalate,
    parsed_note_summary: null,
    revised_delivery_date: null,
  };
}

export function mockDiscrepancy(input: DiscrepancyInput): DiscrepancyOutput {
  const claimable = input.discrepancies.filter((d) => ['Short', 'Damaged', 'Wrong_Item'].includes(d.type));
  const claimed = round2(claimable.reduce((s, d) => s + d.line_value, 0));
  const lines = input.discrepancies
    .map((d) => {
      const what =
        d.type === 'Short'
          ? `${d.qty_variance} units short`
          : d.type === 'Damaged'
            ? `${d.qty_variance} units damaged on arrival`
            : d.type === 'Wrong_Item'
              ? `${d.qty_variance} units of the wrong item`
              : d.type === 'Over'
                ? `${d.qty_variance} units over the ordered quantity`
                : 'price on packing slip differs from PO';
      return `  • ${d.product_name}: ${what}${d.line_value ? ` (${usd(d.line_value)} at ${usd(d.unit_price)}/unit)` : ''}`;
    })
    .join('\n');
  const note = input.instruction ? `\n(Revised per manager: ${input.instruction})\n` : '';
  return {
    subject: `Delivery discrepancy on PO ${input.po_id} — credit request ${usd(claimed)}`,
    email_text: `Hello ${input.vendor.name} team,
${note}
We received PO ${input.po_id} (packing slip ${input.packing_slip_no}, receipt ${input.receipt_id}) and found the following:

${lines}

We are requesting a credit of ${usd(claimed)} for the short and damaged units. Damaged units are held in quarantine for your pickup or disposal instructions.

Please reply within 3 business days to confirm the credit or arrange replacement.

Thank you,
Aditya Deshkahire
Store Manager, StockPilot Store #12`,
    claimed_amount: claimed,
    suggested_resolutions: input.discrepancies.map((d) => ({
      discrepancy_id: d.discrepancy_id,
      resolution:
        d.type === 'Wrong_Item' ? 'Returned' : d.type === 'Over' ? 'Accepted_As_Is' : 'Credit_Requested',
      reason:
        d.type === 'Short'
          ? 'Missing units; request credit (replacement would arrive after the holiday peak).'
          : d.type === 'Damaged'
            ? 'Unsellable units; request credit.'
            : d.type === 'Wrong_Item'
              ? 'Return the substituted item to vendor.'
              : d.type === 'Over'
                ? 'Small overage; accept and pay only for ordered quantity.'
                : 'Ask vendor to honor PO price.',
    })),
  };
}

export function mockInsights(input: InsightsInput): InsightsOutput {
  const up = [...input.category_sales].sort((a, b) => b.last_7 / Math.max(1, b.prior_7) - a.last_7 / Math.max(1, a.prior_7))[0];
  const pct = up ? Math.round((up.last_7 / Math.max(1, up.prior_7) - 1) * 100) : 0;
  const actions: string[] = [];
  if (input.low_stock.length) actions.push(`Review ${input.low_stock.length} low-stock item(s), starting with ${input.low_stock[0].name}.`);
  if (input.open_discrepancies.length) actions.push(`Close ${input.open_discrepancies.length} open discrepancy claim(s) with vendors.`);
  if (input.open_pos.length) actions.push(`Confirm delivery dates for ${input.open_pos.length} open PO(s), e.g. ${input.open_pos[0].po_id}.`);
  if (input.slow_movers.length) actions.push(`Consider lowering max stock for slow mover ${input.slow_movers[0].name}.`);
  actions.push('Pre-stage cooler space for the Thanksgiving dairy peak.');
  return {
    summary: `Week ending ${input.week_ending}: ${input.kpis.items_below_rop ?? 0} item(s) are at or below reorder point, ${input.kpis.pos_in_transit ?? 0} PO(s) are in transit and ${input.kpis.open_discrepancies ?? 0} discrepancy(ies) are open. ${up ? `${up.category} sales are ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs the prior week.` : ''} Top seller: ${input.top_sellers[0]?.name ?? 'n/a'} (${input.top_sellers[0]?.units_7d ?? 0} units). Holiday demand is building; keep dairy and baking items covered through Thanksgiving.`,
    action_items: actions.slice(0, 5),
    anomalies: input.slow_movers
      .filter((s) => s.units_7d === 0)
      .map((s) => ({ product_id: s.product_id, description: `${s.name} had zero sales in the last 7 days.` })),
  };
}
