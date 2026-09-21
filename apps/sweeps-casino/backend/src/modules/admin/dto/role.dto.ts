import { AdminRoleKey } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsIn, IsString } from 'class-validator';

const ROLE_KEYS: AdminRoleKey[] = [
  'SUPER_ADMIN',
  'COMPLIANCE',
  'FINANCE',
  'SUPPORT',
  'VIP_MANAGER',
  'FRAUD_ANALYST',
  'CONTENT_MANAGER',
  'GAME_MANAGER',
  'MODERATOR',
];

export class CreateRoleDto {
  @IsIn(ROLE_KEYS)
  key!: AdminRoleKey;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissions!: string[];
}
