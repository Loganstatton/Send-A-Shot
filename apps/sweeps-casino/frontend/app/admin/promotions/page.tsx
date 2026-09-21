"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import type { Promotion } from "@/lib/types";
import { Plus } from "@/components/ui/icons";

export default function AdminPromotionsPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<Promotion[]>("/admin/promotions"), []);
  const { data, loading, refetch } = useFetch(fetcher);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("WELCOME");
  const [saving, setSaving] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/admin/promotions", { name: title, description, type, status: "ACTIVE" });
      toast.push("Promotion created.", "success");
      setOpen(false);
      setTitle("");
      setDescription("");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not create promotion."), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(id: string, status: string) {
    try {
      await api.patch(`/admin/promotions/${id}`, { status: status === "ACTIVE" ? "PAUSED" : "ACTIVE" });
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update promotion."), "danger");
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Promotions"
        description="Full CRUD on the generic promotion model."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New promotion
          </Button>
        }
      />
      <div className="px-4 pb-8 lg:px-6">
        <Card>
          <CardContent className="p-0">
            {loading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!loading && (data?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No promotions yet.</p>}
            {!loading &&
              data?.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <div>
                    <p className="font-medium text-text-primary">{p.name}</p>
                    <p className="text-xs text-text-muted">{p.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => toggleStatus(p.id, p.status)}>
                      {p.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New promotion">
        <form onSubmit={create} className="space-y-4">
          <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Type" required value={type} onChange={(e) => setType(e.target.value)} hint="e.g. WELCOME, RELOAD, DAILY_BONUS, CHALLENGE, RAFFLE" />
          <Input label="Description" required value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button type="submit" className="w-full" loading={saving}>
            Create promotion
          </Button>
        </form>
      </Modal>
    </div>
  );
}
