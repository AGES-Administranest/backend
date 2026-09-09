import { Global, Module } from '@nestjs/common';

import { DocumentStorage } from './document-storage';
import { S3DocumentStorage } from './s3-document-storage';

@Global()
@Module({
  providers: [{ provide: DocumentStorage, useClass: S3DocumentStorage }],
  exports: [DocumentStorage],
})
export class StorageModule {}
