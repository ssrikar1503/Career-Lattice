import type { Metadata } from 'next';
import { isAdminAuthed } from '@/lib/admin-auth';
import AdminClient from './AdminClient';

export const metadata: Metadata = { title: 'Admin — Review Queue' };

export default async function AdminPage() {
  const authed = await isAdminAuthed();
  return <AdminClient isAuthed={authed} />;
}
