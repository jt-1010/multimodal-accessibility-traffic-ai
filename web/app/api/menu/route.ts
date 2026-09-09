import { asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { menuItems } from '@/lib/db/schema';

export async function GET() {
  const db = await getDb();
  const items = await db.select().from(menuItems).orderBy(asc(menuItems.category), asc(menuItems.name));

  const byCategory: Record<string, typeof items> = {};
  for (const item of items) (byCategory[item.category] ??= []).push(item);

  return Response.json({ categories: byCategory });
}
