import { Controller, Param, Post, Query } from '@nestjs/common';
import { SearchIndexerService } from './search.indexer.service';

@Controller('search-index')
export class SearchAdminController {
  constructor(private readonly indexer: SearchIndexerService) {}

  @Post('reindex/:propertyId')
  reindexOne(@Param('propertyId') propertyId: string) {
    return this.indexer.reindexProperty(propertyId);
  }

  @Post('reindex-all')
  reindexAll(@Query('batch') batch?: string) {
    const size = batch ? Number(batch) : 500;
    return this.indexer.reindexAll(size);
  }
}
