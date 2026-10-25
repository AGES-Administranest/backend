import { Global, Module } from '@nestjs/common';

import { DocumentStorage } from './document-storage';
import { DocumentUploads } from './document-uploads';
import { S3DocumentStorage } from './s3-document-storage';

@Global()
@Module({
  providers: [
    { provide: DocumentStorage, useClass: S3DocumentStorage },
    DocumentUploads,
  ],
  exports: [DocumentStorage, DocumentUploads],
})
export class StorageModule {}
