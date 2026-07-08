import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';

/**
 * Service-role klient — RLS obchádza. Používa ho IBA scheduler.
 * NIKDY sa nesmie dostať do apps/web.
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
