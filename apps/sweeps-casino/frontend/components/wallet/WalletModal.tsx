"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { formatCoins } from "@/lib/utils";
import { Coins } from "@/components/ui/icons";

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const balances = useWalletStore((s) => s.balances);

  return (
    <Modal open={open} onClose={onClose} title="Wallet">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-accent-gc/30 bg-accent-gc/5 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-gc">
            <Coins className="h-3.5 w-3.5" /> Gold Coins
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-text-primary">
            {balances ? formatCoins(balances.gc.balance) : "—"}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">Entertainment-only. No cash value.</p>
        </div>
        <div className="rounded-xl border border-accent-sc/30 bg-accent-sc/5 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-sc">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-current text-[8px]">
              S
            </span>
            Sweeps Coins
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-text-primary">
            {balances ? formatCoins(balances.sc.balance) : "—"}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">Promotional — pending compliance approval.</p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Link href="/account/wallet" onClick={onClose} className="flex-1">
          <Button variant="secondary" className="w-full">
            Manage wallet
          </Button>
        </Link>
        <Link href="/account/wallet?tab=redeem" onClick={onClose} className="flex-1">
          <Button variant="outline" className="w-full">
            Redeem SC
          </Button>
        </Link>
      </div>
    </Modal>
  );
}
