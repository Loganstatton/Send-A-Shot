import { Suspense } from 'react';
import { SimpleCreate } from '@/components/SimpleCreate';

export default function Page() {
  return (
    <Suspense>
      <SimpleCreate />
    </Suspense>
  );
}
