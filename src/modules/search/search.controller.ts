import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Get('properties')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async properties(@Query() q: SearchPropertiesDto) {
    return this.svc.searchProperties(q);
  }

  @Get('suggest')
  async suggest(
    @Query('q') q = '',
    @Query('field') field: 'title' | 'address' = 'title',
  ) {
    return this.svc.suggest(q, field);
  }
}
