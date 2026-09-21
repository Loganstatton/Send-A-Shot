import { IsString, Length } from 'class-validator';

export class AddUserNoteDto {
  @IsString()
  @Length(1, 2000)
  note!: string;
}
