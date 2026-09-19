'use client';
import { useRouter } from 'next/navigation';
import { InquiryStatus } from '@/lib/gallery/types';

export default function InquiryStatusSelect({ id, status }: { id: number; status: InquiryStatus }) {
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    await fetch(`/api/gallery/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: e.target.value }),
    });
    router.refresh();
  }

  return (
    <select className="g-input" style={{ width: 'auto' }} value={status} onChange={handleChange}>
      <option value="new">New</option>
      <option value="responded">Responded</option>
      <option value="closed">Closed</option>
    </select>
  );
}
