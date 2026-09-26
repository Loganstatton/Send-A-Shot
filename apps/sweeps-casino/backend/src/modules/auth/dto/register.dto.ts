import {
  IsDateString,
  IsEmail,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 128)
  password!: string;

  @IsString()
  @Length(3, 24)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers, and underscores',
  })
  username!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsString()
  @Length(2, 2)
  stateOfRecord!: string;
}
