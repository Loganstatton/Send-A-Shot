import type { Metadata } from 'next';
import NewWorkForm from '@/components/gallery/admin/NewWorkForm';

export const metadata: Metadata = { title: 'Admin — Add New Work' };

export default function NewWorkPage() {
  return (
    <div>
      <h2 className="g-serif text-xl mb-10">Add New Work</h2>
      <NewWorkForm />
    </div>
  );
}
