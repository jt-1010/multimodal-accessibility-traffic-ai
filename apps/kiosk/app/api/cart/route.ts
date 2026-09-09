import { getCart } from '@/lib/agent/cart';

/**
 * The UI reads the cart from the same functions the agent's tools write
 * through, so the panel on screen cannot disagree with what the assistant
 * just said. One source of truth, queried twice.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 });
  return Response.json(await getCart(sessionId));
}
