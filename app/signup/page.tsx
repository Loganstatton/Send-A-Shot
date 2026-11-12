import AuthForm from '@/components/AuthForm';
import { safeReturnPath } from '@/lib/return-path';

export default async function SignupPage(props: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <AuthForm
      mode="signup"
      inviteRequired={Boolean(process.env.SIGNUP_INVITE_CODE)}
      returnTo={safeReturnPath(searchParams.next, '/next')}
    />
  );
}
