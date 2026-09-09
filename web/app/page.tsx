import { randomUUID } from 'node:crypto';
import { SessionShell } from '@/components/SessionShell';

// Rendered fresh per request, so each page load is a genuinely new session
// and never resurrects a previous customer's cart.
export const dynamic = 'force-dynamic';

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ?tune=1 reveals the camera calibration instruments. Read on the server so
  // there is no flash of developer UI before the client decides to hide it.
  const tuning = (await searchParams).tune === '1';

  return (
    <main className="mx-auto min-h-screen max-w-[100rem] px-6 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-white">SignOrder</h1>
        <p className="text-sm text-slate-400">Order by sign language, voice, typing, or touch</p>
      </header>

      <SessionShell baseSessionId={randomUUID()} tuning={tuning} />
    </main>
  );
}
