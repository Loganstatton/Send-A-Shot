import { IsString, Length } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @Length(3, 200)
  subject!: string;

  @IsString()
  @Length(1, 5000)
  message!: string;
}
