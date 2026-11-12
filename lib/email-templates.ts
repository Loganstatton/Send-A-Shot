// The account emails. Shared so signup and "resend verification" send the
// same thing.
const wrap = (body: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}<p style="color:#888;font-size:12px;margin-top:24px">NEXT — virtual credits only; nothing here is real money.</p></div>`;

export function verifyEmailMessage(appUrl: string, token: string) {
  const link = `${appUrl}/verify-email?token=${token}`;
  return {
    subject: 'Verify your email for NEXT',
    html: wrap(`<p>Welcome to NEXT — confirm your email so you can always get back into your account.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>`),
  };
}

export function resetPasswordMessage(appUrl: string, token: string) {
  const link = `${appUrl}/reset-password?token=${token}`;
  return {
    subject: 'Reset your NEXT password',
    html: wrap(`<p>Someone (hopefully you) asked to reset your NEXT password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour and stops working once it's used. If you didn't ask for this, ignore this email — your password hasn't changed.</p>`),
  };
}
