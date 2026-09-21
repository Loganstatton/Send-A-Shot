import { IsIn, IsString, Length } from 'class-validator';

/**
 * Only ACTIVE/SUSPENDED are ever valid values here — SELF_EXCLUDED and
 * CLOSED are structurally impossible targets because this DTO's @IsIn()
 * doesn't list them. AdminUsersService.setStatus() still separately checks
 * the *current* status (a self-excluded or closed account can't be
 * toggled through this endpoint either), since the DTO alone can't express
 * "the current value must also be one of these."
 */
export class SetUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  @IsString()
  @Length(3, 1000)
  reason!: string;
}
