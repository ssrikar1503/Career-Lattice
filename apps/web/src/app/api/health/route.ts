/**
 * GET /api/health
 *
 * Lightweight health check endpoint.
 * Returns status of each configured service so you can spot outages quickly.
 *
 * Use cases:
 *   - Uptime monitoring (UptimeRobot, Better Stack, etc. ping this URL)
 *   - Quick debug from the browser when something feels broken
 *   - CI smoke tests after deploy
 *
 * Stays cheap — no actual API calls are made. We only check if env vars
 * are present and what state circuit breakers are in.
 */
import { getProviderStatus } from '@/lib/ai-providers';

export async function GET() {
  const providers      = getProviderStatus();
  const anyProvider    = providers.some(p => p.configured && p.circuit !== 'open');
  const supabaseConfig = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminConfig    = !!process.env.ADMIN_PASSWORD;

  const status = anyProvider ? 'ok' : 'degraded';

  return Response.json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      ai_advisor:  anyProvider ? 'ok' : 'unavailable',
      database:    supabaseConfig ? 'configured' : 'not_configured',
      admin:       adminConfig ? 'configured' : 'not_configured',
    },
    ai_providers: providers,
  }, {
    // Allow uptime monitors to alert on non-200
    status: status === 'ok' ? 200 : 503,
  });
}
