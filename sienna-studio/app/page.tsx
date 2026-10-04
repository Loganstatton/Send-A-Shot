import { Suspense } from 'react';
import { CreateScreen } from '@/components/CreateScreen';

export default function Page() {
  return (
    <Suspense>
      <CreateScreen />
    </Suspense>
  );
}
