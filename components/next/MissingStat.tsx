// A real missing-data state, not a bare "—". A dash alone doesn't tell a
// trader whether a number is genuinely unknown, not tracked for this
// artist yet, or just hasn't loaded — this always says which.
export default function MissingStat({ reason }: { reason: string }) {
  return (
    <span className="text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
      {reason}
    </span>
  );
}
