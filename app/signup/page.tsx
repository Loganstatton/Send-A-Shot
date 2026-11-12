import AuthForm from '@/components/AuthForm';
import { safeReturnPath } from '@/lib/return-path';

export default function SignupPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <AuthForm
      mode="signup"
      inviteRequired={Boolean(process.env.SIGNUP_INVITE_CODE)}
      returnTo={safeReturnPath(searchParams.next, '/next')}
    />
  );
}
