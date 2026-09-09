import { randomUUID } from 'node:crypto';
import { KioskShell } from '@/components/KioskShell';

// Rendered fresh per request, so each page load is a genuinely new kiosk
// session and never resurrects a previous customer's cart.
export const dynamic = 'force-dynamic';

export default function KioskPage() {
  return (
    <main className="mx-auto min-h-screen max-w-[100rem] px-6 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-white">SignOrder</h1>
        <p className="text-sm text-slate-400">Order by sign language, voice, or touch</p>
      </header>

      <KioskShell baseSessionId={randomUUID()} />
    </main>
  );
}
