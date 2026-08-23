// Server-only email sender via Resend's HTTP API — no SDK needed, same
// "plain fetch against a documented REST API" shape as lib/deezer.ts and
// lib/youtube.ts. Nothing in this app currently requires email to actually
// arrive (there's no gate on unverified accounts), so an unconfigured
// server degrades to "log it and move on" rather than failing signup,
// password reset, etc. — see emailConfigured() below.

const API_BASE_URL = 'https://api.resend.com';

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type EmailResult = { ok: true } | { ok: false; error: string };

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    // Not a failure a caller needs to surface to the end user — signup,
    // password reset, etc. all still work with the link just logged
    // server-side instead of emailed, so local dev and a not-yet-configured
    // deploy both keep working.
    console.log(`[email] RESEND_API_KEY/EMAIL_FROM not set — would have sent "${input.subject}" to ${input.to}:\n${input.html}`);
    return { ok: false, error: 'Email is not configured on this server.' };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Resend: ${err?.message ?? 'network error'}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Resend returned ${res.status}: ${body.slice(0, 400)}` };
  }
  return { ok: true };
}
