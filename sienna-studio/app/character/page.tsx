import { BodyReferences } from '@/components/BodyReferences';
import { CharacterEditor } from '@/components/CharacterEditor';
import { PageHeader } from '@/components/ui';

export default function CharacterPage() {
  return (
    <div className="pb-nav">
      <PageHeader title="Sienna" subtitle="Fictional adult character · identity profile" />
      <CharacterEditor />
      <BodyReferences />
    </div>
  );
}
