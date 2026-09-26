import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class GrantAdminAccessDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  roleId!: string;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
