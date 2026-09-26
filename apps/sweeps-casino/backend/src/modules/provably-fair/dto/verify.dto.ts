import { IsIn, IsInt, IsObject, IsString, Min } from 'class-validator';

export class ProvablyFairVerifyDto {
  @IsString()
  serverSeed!: string;

  @IsString()
  clientSeed!: string;

  @IsInt()
  @Min(0)
  nonce!: number;

  @IsIn(['dice', 'mines', 'plinko'])
  game!: 'dice' | 'mines' | 'plinko';

  /** Game-specific params, same shape as the play-time body (target/direction, minesCount/picks, rows/risk). */
  @IsObject()
  gameParams!: Record<string, unknown>;
}
