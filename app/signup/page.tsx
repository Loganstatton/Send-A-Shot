import AuthForm from '@/components/AuthForm';
import { safeReturnPath } from '@/lib/return-path';
import { inviteOnly } from '@/lib/invites';

export default async function SignupPage(props: { searchParams: Promise<{ next?: string; invite?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <AuthForm
      mode="signup"
      inviteRequired={inviteOnly()}
      initialInviteCode={typeof searchParams.invite === 'string' ? searchParams.invite.slice(0, 40) : ''}
      returnTo={safeReturnPath(searchParams.next, '/next')}
    />
  );
}
