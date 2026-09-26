import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KycService } from './kyc.service';
import { UploadKycDocumentDto } from './dto/upload-document.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.kycService.getStatus(user.userId);
    return { data };
  }

  @Post('start')
  async start(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.kycService.start(user.userId);
    return { data };
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKycDocumentDto,
  ) {
    const data = await this.kycService.addDocument(user.userId, dto.type, file);
    return { data };
  }
}
