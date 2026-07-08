import { z } from 'zod';

/**
 * Zdieľané zod schémy a odvodené typy pre celý monorepo.
 * Zámerne bez runtime závislostí (žiadne cloudflare:*, next:*, node:*).
 */

export const memberRoleSchema = z.enum(['owner', 'staff', 'client']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const alertSeveritySchema = z.enum(['critical', 'warning', 'info']);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export const siteCmsSchema = z.enum(['wordpress', 'other', 'static']);
export type SiteCms = z.infer<typeof siteCmsSchema>;

export const domainSourceSchema = z.enum(['rdap', 'whois43', 'unsupported']);
export type DomainSource = z.infer<typeof domainSourceSchema>;

/** Podmnožina `sites`, ktorú scheduler potrebuje na uptime check. */
export const siteForCheckSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  url: z.string().url(),
  expectedString: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
});
export type SiteForCheck = z.infer<typeof siteForCheckSchema>;

export const checkResultSchema = z.object({
  siteId: z.string().uuid(),
  ok: z.boolean(),
  statusCode: z.number().int().optional(),
  responseMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const alertSchema = z.object({
  orgId: z.string().uuid(),
  siteId: z.string().uuid().nullable(),
  type: z.string(),
  severity: alertSeveritySchema,
  title: z.string(),
  body: z.string().nullable(),
  dedupeKey: z.string(),
});
export type Alert = z.infer<typeof alertSchema>;
