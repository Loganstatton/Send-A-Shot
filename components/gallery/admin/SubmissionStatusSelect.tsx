'use client';
import { useRouter } from 'next/navigation';
import { SubmissionStatus } from '@/lib/gallery/types';

export default function SubmissionStatusSelect({ id, status }: { id: number; status: SubmissionStatus }) {
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    await fetch(`/api/gallery/submissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: e.target.value }),
    });
    router.refresh();
  }

  return (
    <select className="g-input" style={{ width: 'auto' }} value={status} onChange={handleChange}>
      <option value="new">New</option>
      <option value="reviewed">Reviewed</option>
      <option value="used">Used in a Work</option>
    </select>
  );
}
