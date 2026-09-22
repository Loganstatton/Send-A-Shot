import { IsInt, Max, Min } from 'class-validator';

/** POST /casino/originals/mines/:roundId/pick body. */
export class PickTileDto {
  @IsInt()
  @Min(0)
  @Max(24)
  tileIndex!: number;
}
