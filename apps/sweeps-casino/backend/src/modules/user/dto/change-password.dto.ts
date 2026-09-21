import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  /** Same length policy as RegisterDto.password. */
  @IsString()
  @Length(10, 128)
  newPassword!: string;
}
