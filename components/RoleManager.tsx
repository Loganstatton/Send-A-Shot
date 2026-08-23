'use client';
import { useState } from 'react';
import { ROLE_LABELS, ROLES, Role, User } from '@/lib/types';

const ROLE_BADGE_STYLE: Record<Role, React.CSSProperties> = {
  public: { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' },
  internal: { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' },
  admin: { background: 'oklch(70% 0.15 300 / 0.14)', borderColor: 'oklch(70% 0.15 300 / 0.4)', color: 'oklch(78% 0.12 300)' },
};

function UserRow({ user, currentAdminId }: { user: User; currentAdminId: number }) {
  const [role, setRole] = useState<Role>(user.role);
  const [saving, setSaving] = useState(false);
  const isSelf = user.id === currentAdminId;

  async function handleChange(newRole: Role) {
    const previous = role;
    setRole(newRole);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) setRole(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border-soft)' }}>
      <td className="py-2 pr-3">
        <div className="font-medium">{user.name}{isSelf && <span style={{ color: 'var(--text-faint)' }}> (you)</span>}</div>
        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{user.email}</div>
      </td>
      <td className="num py-2 pr-3 text-sm whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
        {new Date(user.created_at).toLocaleDateString()}
      </td>
      <td className="py-2 pr-3">
        <span className="badge" style={ROLE_BADGE_STYLE[role]}>{ROLE_LABELS[role]}</span>
      </td>
      <td className="py-2">
        <select
          className="input w-auto"
          value={role}
          disabled={saving || isSelf}
          onChange={(e) => handleChange(e.target.value as Role)}
        >
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </td>
    </tr>
  );
}

export default function RoleManager({ users, currentAdminId }: { users: User[]; currentAdminId: number }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[600px]">
        <thead className="text-left">
          <tr>
            <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>User</th>
            <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Joined</th>
            <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Role</th>
            <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => <UserRow key={u.id} user={u} currentAdminId={currentAdminId} />)}
        </tbody>
      </table>
    </div>
  );
}
