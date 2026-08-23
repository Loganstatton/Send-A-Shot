import ResetPasswordForm from '@/components/ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  return <ResetPasswordForm token={searchParams.token ?? ''} />;
}
