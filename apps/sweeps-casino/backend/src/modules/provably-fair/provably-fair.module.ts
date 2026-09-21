import { Module } from '@nestjs/common';
import { ProvablyFairController } from './provably-fair.controller';
import { ProvablyFairService } from './provably-fair.service';

@Module({
  controllers: [ProvablyFairController],
  providers: [ProvablyFairService],
})
export class ProvablyFairModule {}
