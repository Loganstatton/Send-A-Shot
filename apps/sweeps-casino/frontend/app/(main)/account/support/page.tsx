"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import type { FaqItem, SupportTicket } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { formatDate } from "@/lib/utils";

export default function SupportPage() {
  const [tab, setTab] = useState("faq");

  const faqFetcher = useCallback(() => api.get<FaqItem[]>("/support/faq"), []);
  const { data: faqs, loading: faqLoading } = useFetch(faqFetcher);

  const ticketsFetcher = useCallback(() => api.get<SupportTicket[]>("/support/tickets"), []);
  const { data: tickets, loading: ticketsLoading, refetch: refetchTickets } = useFetch(ticketsFetcher);

  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/support/tickets", { subject, body });
      toast.push("Ticket submitted.", "success");
      setSubject("");
      setBody("");
      refetchTickets();
      setTab("tickets");
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not submit ticket.", "danger");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Support</h1>
      <Tabs
        tabs={[
          { key: "faq", label: "FAQ" },
          { key: "new", label: "New ticket" },
          { key: "tickets", label: "My tickets" },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "faq" && (
        <div className="space-y-2">
          {faqLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          {!faqLoading && (faqs?.length ?? 0) === 0 && <p className="text-sm text-text-muted">No FAQ entries yet.</p>}
          {!faqLoading &&
            faqs?.map((f) => (
              <Card key={f.id}>
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-text-primary">{f.question}</p>
                  <p className="mt-1 text-sm text-text-muted">{f.answer}</p>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {tab === "new" && (
        <Card>
          <CardContent className="p-5">
            <form onSubmit={createTicket} className="space-y-4">
              <Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">Describe your issue</label>
                <textarea
                  required
                  rows={5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent-sc"
                />
              </div>
              <Button type="submit" loading={creating}>
                Submit ticket
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "tickets" && (
        <div className="space-y-2">
          {ticketsLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          {!ticketsLoading && (tickets?.length ?? 0) === 0 && (
            <p className="text-sm text-text-muted">You haven&apos;t submitted any tickets.</p>
          )}
          {!ticketsLoading &&
            tickets?.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t.subject}</p>
                    <p className="text-xs text-text-muted">{formatDate(t.createdAt)}</p>
                  </div>
                  <Badge variant={t.status === "OPEN" ? "success" : t.status === "PENDING" ? "sc" : "neutral"}>
                    {t.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
