import AuthForm from '@/components/AuthForm';

export default function SignupPage() {
  return <AuthForm mode="signup" inviteRequired={Boolean(process.env.SIGNUP_INVITE_CODE)} />;
}
