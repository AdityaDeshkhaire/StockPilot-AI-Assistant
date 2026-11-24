import { z } from 'zod';

export const ReplenishmentOutput = z.object({
  lines: z.array(
    z.object({
      product_id: z.string(),
      recommended_qty: z.number().int().nonnegative(),
      forecast_qty: z.number().nonnegative(),
      confidence: z.enum(['High', 'Medium', 'Low']),
      needs_review: z.boolean(),
      rationale: z.string(),
    }),
  ),
  skipped: z.array(z.object({ product_id: z.string(), reason: z.string() })),
  summary: z.string(),
});
export type ReplenishmentOutput = z.infer<typeof ReplenishmentOutput>;

export const ProcurementOutput = z.object({
  vendor_choices: z.array(z.object({ product_id: z.string(), vendor_id: z.string(), reason: z.string() })),
  pos: z.array(
    z.object({
      vendor_id: z.string(),
      lines: z.array(z.object({ product_id: z.string(), qty: z.number().int().positive(), unit_price: z.number().nonnegative() })),
      order_email: z.string().min(1),
      selection_note: z.string().min(1),
    }),
  ),
});
export type ProcurementOutput = z.infer<typeof ProcurementOutput>;

export const ExpeditingOutput = z.object({
  followup_email: z.string().nullable(),
  escalate: z.boolean(),
  parsed_note_summary: z.string().nullable(),
  revised_delivery_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type ExpeditingOutput = z.infer<typeof ExpeditingOutput>;

export const DiscrepancyOutput = z.object({
  subject: z.string().min(1),
  email_text: z.string().min(1),
  claimed_amount: z.number().nonnegative(),
  suggested_resolutions: z.array(
    z.object({
      discrepancy_id: z.string(),
      resolution: z.enum(['Replacement_Requested', 'Credit_Requested', 'Returned', 'Accepted_As_Is']),
      reason: z.string(),
    }),
  ),
});
export type DiscrepancyOutput = z.infer<typeof DiscrepancyOutput>;

export const InsightsOutput = z.object({
  summary: z.string().min(1),
  action_items: z.array(z.string()).max(5),
  anomalies: z.array(z.object({ product_id: z.string().nullable(), description: z.string() })),
});
export type InsightsOutput = z.infer<typeof InsightsOutput>;
