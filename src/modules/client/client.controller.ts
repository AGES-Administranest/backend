import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ClientService } from './client.service';

@ApiTags('client')
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}
}
