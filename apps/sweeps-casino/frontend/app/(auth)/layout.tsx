import Link from "next/link";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(700px circle at 15% 10%, rgb(var(--color-accent-gc) / 0.10), transparent 60%), radial-gradient(700px circle at 85% 90%, rgb(var(--color-accent-sc) / 0.12), transparent 60%)",
        }}
      />
      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <VaultlineLogo className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight text-text-primary">Vaultline</span>
        </Link>
        {children}
      </div>
    </div>
  );
}
