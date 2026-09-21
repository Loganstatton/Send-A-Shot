import { Body, Controller, Post } from '@nestjs/common';
import { ProvablyFairService } from './provably-fair.service';
import { ProvablyFairVerifyDto } from './dto/verify.dto';

/** Public — no auth guard. Anyone can independently verify any past round. */
@Controller('provably-fair')
export class ProvablyFairController {
  constructor(private readonly provablyFairService: ProvablyFairService) {}

  @Post('verify')
  verify(@Body() dto: ProvablyFairVerifyDto) {
    const data = this.provablyFairService.verify(dto);
    return { data };
  }
}
