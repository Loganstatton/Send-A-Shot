'use client';
import { useRouter } from 'next/navigation';

export default function DeleteStoryButton({ id }: { id: number }) {
  const router = useRouter();
  async function handleDelete() {
    if (!confirm('Delete this story?')) return;
    await fetch(`/api/gallery/stories/${id}`, { method: 'DELETE' });
    router.refresh();
  }
  return <button onClick={handleDelete} className="text-xs text-red-400">Delete</button>;
}
