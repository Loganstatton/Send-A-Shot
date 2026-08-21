'use client';
import { useState } from 'react';
import { ROLE_LABELS, ROLES, Role, User } from '@/lib/types';

const ROLE_BADGE_CLASSES: Record<Role, string> = {
  public: 'bg-neutral-500/20 border-neutral-500/40 text-neutral-300',
  internal: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
  admin: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
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
    <tr className="border-t border-neutral-800">
      <td className="py-2 pr-3">
        <div className="font-medium">{user.name}{isSelf && <span className="text-neutral-500"> (you)</span>}</div>
        <div className="text-xs text-neutral-500">{user.email}</div>
      </td>
      <td className="py-2 pr-3 text-neutral-400 text-sm whitespace-nowrap">
        {new Date(user.created_at).toLocaleDateString()}
      </td>
      <td className="py-2 pr-3">
        <span className={`badge ${ROLE_BADGE_CLASSES[role]}`}>{ROLE_LABELS[role]}</span>
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
        <thead className="text-neutral-500 text-left">
          <tr>
            <th className="font-normal pb-2">User</th>
            <th className="font-normal pb-2">Joined</th>
            <th className="font-normal pb-2">Role</th>
            <th className="font-normal pb-2">Change</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => <UserRow key={u.id} user={u} currentAdminId={currentAdminId} />)}
        </tbody>
      </table>
    </div>
  );
}
