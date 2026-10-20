import { supabase } from '../../lib/supabase';
import { createRuntimeReporter, runtimeArea } from './runtimeReporter';

export const reportRuntimeEvent = createRuntimeReporter(supabase);

export function reportRenderFailure(): void {
  const area = typeof window === 'undefined' ? 'other' : runtimeArea(window.location.pathname);
  void reportRuntimeEvent('render_error', area);
}
