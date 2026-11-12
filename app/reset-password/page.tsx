import ResetPasswordForm from '@/components/ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage(props: { searchParams: Promise<{ token?: string }> }) {
  const searchParams = await props.searchParams;
  return <ResetPasswordForm token={searchParams.token ?? ''} />;
}
