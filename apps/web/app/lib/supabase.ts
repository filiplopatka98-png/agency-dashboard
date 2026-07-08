import { createClient } from '@supabase/supabase-js';
import type { Database } from '@agency/db';

/**
 * Browser klient — LEN anon key. Autorizáciu robí RLS. Auth = magic link.
 * service_role sa sem NIKDY nesmie dostať.
 */
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export type Tables = Database['public']['Tables'];
export type Site = Tables['sites']['Row'];
export type UptimeDaily = Tables['uptime_daily']['Row'];
export type Incident = Tables['incidents']['Row'];
export type Alert = Tables['alerts']['Row'];
export type Domain = Tables['domains']['Row'];
export type TlsCert = Tables['tls_certs']['Row'];
export type Client = Tables['clients']['Row'];
