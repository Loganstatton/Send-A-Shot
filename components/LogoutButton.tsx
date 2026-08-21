'use client';
import { useRouter } from 'next/navigation';

export default function LogoutButton({ className = 'btn text-sm' }: { className?: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleLogout}>
      Log out
    </button>
  );
}
