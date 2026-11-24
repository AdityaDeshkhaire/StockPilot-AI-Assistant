import { describe, expect, it } from 'vitest';
import { routeForApproval } from './approval';
import { pr, prLine, product, user } from './fixtures';

const settings = { auto_approve_limit: 1000, ack_timeout_hours: 48, match_tolerance_pct: 2 };
const users = [
  user(),
  user({ user_id: 'U9', role: 'Regional_Manager', approval_limit: 50000, email: 'regional@stockpilot.demo' }),
];

describe('routeForApproval', () => {
  it('auto-approves small, unflagged, system-sourced PRs (approved_by SYSTEM)', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 100, est_unit_cost: 5 })], users, settings);
    expect(r.route).toBe('Auto_Approved');
    expect(r.approver_id).toBe('SYSTEM');
    expect(r.total).toBe(500);
  });

  it('routes to a Store Manager when total exceeds auto-approve limit', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 900, est_unit_cost: 4.4 })], users, settings);
    expect(r.route).toBe('Pending_Approval');
    expect(r.approver_id).toBe('U1');
  });

  it('never auto-approves Manual PRs', () => {
    const r = routeForApproval(pr({ source: 'Manual', created_by: 'U5' }), [prLine({ requested_qty: 10, est_unit_cost: 1 })], users, settings);
    expect(r.route).toBe('Pending_Approval');
  });

  it('flags Low confidence lines and blocks auto-approval', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 10, est_unit_cost: 1, confidence: 'Low' })], users, settings);
    expect(r.route).toBe('Pending_Approval');
    expect(r.flagged[0].reason).toMatch(/Low/);
  });

  it('flags lines that would push stock above 1.1 × max_stock', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 200, est_unit_cost: 1 })], users, settings, {
      products: [product({ max_stock: 420 })],
      available: { P1: 300 },
    });
    expect(r.flagged).toHaveLength(1);
    expect(r.route).toBe('Pending_Approval');
  });

  it('enforces segregation of duties: creator cannot approve → escalates', () => {
    const r = routeForApproval(pr({ source: 'Manual', created_by: 'U1' }), [prLine({ requested_qty: 10, est_unit_cost: 1 })], users, settings);
    expect(r.route).toBe('Escalated');
    expect(r.approver_id).toBe('U9');
  });

  it('escalates when total exceeds every Store Manager approval limit', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 3000, est_unit_cost: 4.4 })], users, settings);
    expect(r.total).toBe(13200);
    expect(r.route).toBe('Escalated');
  });

  it('auto-approves at exactly the limit', () => {
    const r = routeForApproval(pr(), [prLine({ requested_qty: 250, est_unit_cost: 4 })], users, settings);
    expect(r.route).toBe('Auto_Approved');
  });
});
