"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import { formatCoins, formatDate } from "@/lib/utils";

interface AdminUserDetail {
  id: string;
  username: string;
  email: string;
  status: string;
  createdAt: string;
  stateOfRecord?: string;
  balances?: { gc: number; sc: number };
  ledger?: { id: string; type: string; currency: string; amount: number; createdAt: string }[];
  sessions?: { id: string; device: string; lastActiveAt: string }[];
  kyc?: { status: string; updatedAt?: string };
  risk?: { level: string; flags: string[] };
  notes?: { id: string; author: string; body: string; createdAt: string }[];
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "ledger", label: "Ledger" },
  { key: "sessions", label: "Sessions" },
  { key: "kyc", label: "KYC" },
  { key: "risk", label: "Risk" },
  { key: "notes", label: "Notes" },
];

export default function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<AdminUserDetail>(`/admin/users/${params.id}`), [params.id]);
  const { data, loading, refetch } = useFetch(fetcher, [params.id]);

  const [tab, setTab] = useState("overview");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustCurrency, setAdjustCurrency] = useState<"GC" | "SC">("GC");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustReason.trim()) {
      toast.push("A reason is required for balance adjustments.", "danger");
      return;
    }
    setAdjusting(true);
    try {
      await api.post(
        `/admin/users/${params.id}/adjust-balance`,
        {
          currency: adjustCurrency,
          amount: Math.round(parseFloat(adjustAmount) * 100),
          reason: adjustReason,
        },
        { idempotent: true }
      );
      toast.push("Balance adjusted.", "success");
      setAdjustOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not adjust balance."), "danger");
    } finally {
      setAdjusting(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setSavingNote(true);
    try {
      await api.post(`/admin/users/${params.id}/notes`, { body: noteBody });
      setNoteBody("");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not save note."), "danger");
    } finally {
      setSavingNote(false);
    }
  }

  async function setStatus(status: "SUSPENDED" | "ACTIVE") {
    try {
      await api.post(`/admin/users/${params.id}/status`, { status, reason: `Set to ${status} via admin panel` });
      toast.push(`User ${status.toLowerCase()}.`, "success");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update status."), "danger");
    }
  }

  if (loading || !data) {
    return (
      <div>
        <AdminPageHeader title="User detail" />
        <div className="px-4 lg:px-6">
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title={data.username}
        description={data.email}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdjustOpen(true)}>
              Adjust balance
            </Button>
            {data.status === "SUSPENDED" ? (
              <Button size="sm" variant="secondary" onClick={() => setStatus("ACTIVE")}>
                Reinstate
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setStatus("SUSPENDED")}>
                Suspend
              </Button>
            )}
          </div>
        }
      />

      <div className="px-4 lg:px-6">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-text-muted">GC Balance</p>
              <p className="font-mono text-xl font-bold text-accent-gc">{formatCoins(data.balances?.gc ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-text-muted">SC Balance</p>
              <p className="font-mono text-xl font-bold text-accent-sc">{formatCoins(data.balances?.sc ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-text-muted">Status</p>
              <Badge variant={data.status === "ACTIVE" ? "success" : "danger"}>{data.status}</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-text-muted">Joined</p>
              <p className="text-sm font-medium text-text-primary">{formatDate(data.createdAt)}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-4" />

        {tab === "overview" && (
          <Card>
            <CardContent className="p-5 text-sm text-text-muted">
              <p>State of record: {data.stateOfRecord ?? "—"}</p>
            </CardContent>
          </Card>
        )}

        {tab === "ledger" && (
          <Card>
            <CardContent className="p-0">
              {(data.ledger?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No ledger entries.</p>}
              {data.ledger?.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <span>{l.type}</span>
                  <span className="font-mono">{formatCoins(l.amount)} {l.currency}</span>
                  <span className="text-xs text-text-muted">{formatDate(l.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {tab === "sessions" && (
          <Card>
            <CardContent className="p-0">
              {(data.sessions?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No active sessions.</p>}
              {data.sessions?.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <span>{s.device}</span>
                  <span className="text-xs text-text-muted">{formatDate(s.lastActiveAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {tab === "kyc" && (
          <Card>
            <CardContent className="p-5 text-sm">
              <Badge variant={data.kyc?.status === "VERIFIED" ? "success" : "neutral"}>{data.kyc?.status ?? "UNVERIFIED"}</Badge>
              {data.kyc?.updatedAt && <p className="mt-2 text-xs text-text-muted">Updated {formatDate(data.kyc.updatedAt)}</p>}
            </CardContent>
          </Card>
        )}

        {tab === "risk" && (
          <Card>
            <CardContent className="p-5 text-sm">
              <Badge variant={data.risk?.level === "HIGH" ? "danger" : "neutral"}>{data.risk?.level ?? "LOW"}</Badge>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.risk?.flags?.map((f) => (
                  <Badge key={f} variant="neutral">
                    {f}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "notes" && (
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4">
                <form onSubmit={addNote} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input label="Add note" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                  </div>
                  <Button type="submit" loading={savingNote} disabled={!noteBody}>
                    Save
                  </Button>
                </form>
              </CardContent>
            </Card>
            {data.notes?.map((n) => (
              <Card key={n.id}>
                <CardContent className="p-4 text-sm">
                  <p className="text-text-primary">{n.body}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {n.author} · {formatDate(n.createdAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Adjust balance">
        <form onSubmit={submitAdjustment} className="space-y-4">
          <Select label="Currency" value={adjustCurrency} onChange={(e) => setAdjustCurrency(e.target.value as "GC" | "SC")}>
            <option value="GC">Gold Coins</option>
            <option value="SC">Sweeps Coins</option>
          </Select>
          <Input
            label="Amount (use negative to debit)"
            type="number"
            step="0.01"
            required
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
          />
          <Input label="Reason (required)" required value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
          <Button type="submit" className="w-full" loading={adjusting}>
            Apply adjustment
          </Button>
        </form>
      </Modal>
    </div>
  );
}
