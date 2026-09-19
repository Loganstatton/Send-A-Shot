import { redirect } from 'next/navigation';
import { getSessionUser } from '../auth';
import { User } from '../types';

// Reuses Scout's existing session/role system rather than building a second
// auth stack for the gallery — /gallery/admin is gated the same way
// /admin/users already is: signed-in + role === 'admin'.
export async function requireGalleryAdmin(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/gallery/admin');
  if (user.role !== 'admin') redirect('/gallery');
  return user;
}

// API-route variant: never redirects (Next's redirect() throws a control-flow
// signal meant for pages/layouts, not route handlers) — returns null instead
// so the caller can respond with a proper 401/403 JSON body.
export async function getGalleryAdminOrNull(): Promise<User | null> {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') return null;
  return user;
}
