/**
 * Shared admin auth helpers.
 * Cookie name + value are defined here so routes don't duplicate magic strings.
 */
import { cookies } from 'next/headers';

export const ADMIN_COOKIE_NAME  = 'admin-session';
export const ADMIN_COOKIE_VALUE = 'authenticated';

export async function isAdminAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE_NAME)?.value === ADMIN_COOKIE_VALUE;
}
