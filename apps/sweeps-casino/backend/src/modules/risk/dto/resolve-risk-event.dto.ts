import { IsString, Length } from 'class-validator';

export class ResolveRiskEventDto {
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
