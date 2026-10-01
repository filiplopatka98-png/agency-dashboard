import { PostgrestClient } from '@supabase/postgrest-js';
import type { Env } from './env';

/**
 * DB klient Workera = holý PostgREST (`@supabase/postgrest-js`), nie celé
 * `@supabase/supabase-js`. Worker používa len `.from()` a `.rpc()` — auth,
 * storage, realtime ani functions nie. supabase-js ich pritom zbalí (~200 kB
 * z ~300 kB bundlu) a `createClient` ich pri každom studenom štarte inštanciuje:
 * merané 1. 10. 2026 ~3 ms eval modulu + ~1,7 ms createClient + ~1,5 ms réžie
 * dotazov na tick — pri limite 10 ms CPU na Workers Free priveľa.
 * supabase-js volá pod kapotou ten istý PostgrestClient s tými istými hlavičkami.
 */
export type Db = PostgrestClient;

/**
 * Service-role klient — RLS obchádza. Používa ho IBA scheduler.
 * NIKDY sa nesmie dostať do apps/web.
 */
export function serviceClient(env: Env): Db {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return new PostgrestClient(`${env.SUPABASE_URL}/rest/v1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    // Zabalené: globálny fetch sa na Workers nesmie volať ako metóda iného objektu.
    fetch: (input, init) => fetch(input, init),
  });
}
