import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from '../../src/modules/auth/dto/register.dto';

/**
 * Regression guard for a real bug: the frontend once sent a "dob" field
 * (and, separately, a formatted display string like "Jan 14, 1990")
 * instead of "dateOfBirth" as an ISO 8601 date, which the backend's
 * ValidationPipe ({whitelist: true, forbidNonWhitelisted: true} in
 * main.ts) correctly rejected — but with an unfriendly raw error. These
 * tests pin down the exact contract (property name + format) so this
 * can't silently regress on either side again.
 */
describe('RegisterDto contract (POST /auth/register)', () => {
  const basePayload = {
    email: 'newuser@example.com',
    password: 'a-long-enough-password',
    username: 'newuser123',
    stateOfRecord: 'NJ',
  };

  async function validatePayload(payload: Record<string, unknown>) {
    const dto = plainToInstance(RegisterDto, payload);
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  it('accepts a valid payload: dateOfBirth as an ISO 8601 date string', async () => {
    const errors = await validatePayload({ ...basePayload, dateOfBirth: '1990-01-14' });
    expect(errors).toHaveLength(0);
  });

  it('rejects the legacy "dob" field name — dateOfBirth must be present, dob must be rejected', async () => {
    const errors = await validatePayload({ ...basePayload, dob: '1990-01-14' });
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('dateOfBirth'); // missing/required
    expect(properties).toContain('dob'); // forbidNonWhitelisted rejects the unknown property
  });

  it('rejects a formatted display string instead of an ISO 8601 date', async () => {
    const errors = await validatePayload({ ...basePayload, dateOfBirth: 'Jan 14, 1990' });
    const dobError = errors.find((e) => e.property === 'dateOfBirth');
    expect(dobError).toBeDefined();
    expect(dobError?.constraints).toHaveProperty('isDateString');
  });

  it('rejects a missing dateOfBirth entirely', async () => {
    const errors = await validatePayload({ ...basePayload });
    expect(errors.some((e) => e.property === 'dateOfBirth')).toBe(true);
  });
});
