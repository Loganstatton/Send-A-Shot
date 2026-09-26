import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ComplianceService } from './compliance.service';
import { FeatureFlagService } from './feature-flag.service';
import { ComplianceController } from './compliance.controller';
import { AdminComplianceController } from './admin-compliance.controller';
import { GEOLOCATION_PROVIDER, MockGeolocationProvider } from './providers/geolocation.provider';

@Module({
  // Registered locally (mirrors AuthModule) purely so ComplianceController
  // can optionally parse an access JWT pre-auth; this module does not
  // participate in issuing/verifying sessions otherwise.
  imports: [JwtModule.register({})],
  controllers: [ComplianceController, AdminComplianceController],
  providers: [
    ComplianceService,
    FeatureFlagService,
    // DI-token binding — swap to a real vendor adapter later by changing
    // only this line (docs/01-architecture.md §5, §10).
    { provide: GEOLOCATION_PROVIDER, useClass: MockGeolocationProvider },
  ],
  exports: [ComplianceService, FeatureFlagService],
})
export class ComplianceModule {}
