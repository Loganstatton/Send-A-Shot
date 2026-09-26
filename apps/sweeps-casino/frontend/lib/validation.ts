// Pure, testable validation + payload-shaping helpers, kept separate from
// the register page component so a regression like sending "dob" instead
// of "dateOfBirth" (or a formatted display string instead of ISO 8601)
// is caught by a unit test, not just by eyeballing the component.

export interface RegisterFormValues {
  email: string;
  username: string;
  password: string;
  /** Value straight from an <input type="date">, already "YYYY-MM-DD". */
  dateOfBirth: string;
  stateOfRecord: string;
}

export interface RegisterApiPayload {
  email: string;
  username: string;
  password: string;
  dateOfBirth: string;
  stateOfRecord: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function minimumAgeCutoff(minAge: number, today = new Date()): Date {
  const cutoff = new Date(today);
  cutoff.setFullYear(cutoff.getFullYear() - minAge);
  return cutoff;
}

/**
 * Client-side pre-check before the request ever reaches the backend's
 * ValidationPipe. Intentionally conservative (18, the lowest age any
 * jurisdiction here requires) -- the backend's per-jurisdiction minAge is
 * still the authoritative check.
 */
export function validateRegisterForm(form: RegisterFormValues): string | null {
  if (!form.email.trim()) return "Please enter your email address.";
  if (!form.username.trim()) return "Please choose a username.";
  if (form.password.length < 10) return "Password must be at least 10 characters.";
  if (!form.dateOfBirth || !ISO_DATE_RE.test(form.dateOfBirth)) {
    return "Please enter a valid date of birth.";
  }
  const dob = new Date(form.dateOfBirth);
  if (Number.isNaN(dob.getTime())) return "Please enter a valid date of birth.";
  if (dob > minimumAgeCutoff(18)) return "You must be at least 18 years old to register.";
  if (dob < minimumAgeCutoff(120)) return "Please enter a valid date of birth.";
  if (!/^[A-Z]{2}$/.test(form.stateOfRecord)) return "Please select your state of record.";
  return null;
}

/**
 * The single place that shapes the API request body for POST
 * /auth/register. The backend's RegisterDto requires exactly
 * "dateOfBirth" as an ISO 8601 date string (see
 * backend/src/modules/auth/dto/register.dto.ts) -- never a "dob" key,
 * never a formatted string like "Jan 14, 1990".
 */
export function buildRegisterPayload(form: RegisterFormValues): RegisterApiPayload {
  return {
    email: form.email.trim(),
    username: form.username.trim(),
    password: form.password,
    dateOfBirth: form.dateOfBirth,
    stateOfRecord: form.stateOfRecord.toUpperCase(),
  };
}
