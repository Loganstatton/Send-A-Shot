import AuthForm from '@/components/AuthForm';
import { safeReturnPath } from '@/lib/return-path';

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return <AuthForm mode="login" returnTo={safeReturnPath(searchParams.next, '/')} />;
}
