import { IsIn } from 'class-validator';
import { KycDocumentType } from '@prisma/client';

const KYC_DOCUMENT_TYPES: KycDocumentType[] = ['ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS'];

export class UploadKycDocumentDto {
  @IsIn(KYC_DOCUMENT_TYPES)
  type!: KycDocumentType;
}
