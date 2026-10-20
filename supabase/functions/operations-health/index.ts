// @ts-ignore Deno resolves this official SDK URL at deployment time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createOperationsHealthHandler } from './handler.ts';

type EdgeDeno = Readonly<{
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Promise<Response>) => void;
}>;
const Deno: EdgeDeno = (globalThis as typeof globalThis & { Deno: EdgeDeno }).Deno;
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const client = url && serviceKey ? createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

Deno.serve(createOperationsHealthHandler({
  token: Deno.env.get('MMI_MONITOR_TOKEN'),
  loadSnapshot: async signal => client
    ? await client.rpc('get_mmi_operations_dashboard', { p_testers_only: false }).abortSignal(signal)
    : { data: null, error: true },
}));
