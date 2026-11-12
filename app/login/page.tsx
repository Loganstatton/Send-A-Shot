import AuthForm from '@/components/AuthForm';
import { safeReturnPath } from '@/lib/return-path';

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await props.searchParams;
  return <AuthForm mode="login" returnTo={safeReturnPath(searchParams.next, '/')} />;
}
