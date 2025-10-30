import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Controllers
import { SearchController } from './search.controller';
import { SearchAdminController } from './search.admin.controller';

// Services
import { SearchService } from './search.service';
import { SearchIndexerService } from './search.indexer.service';
import { SearchConsumer } from './search.consumer';

// Adapters
import { MeiliSearchAdapter } from './adapters/meili.adapter';

@Module({
  controllers: [SearchController, SearchAdminController],
  providers: [
    PrismaService,
    // Adapter
    MeiliSearchAdapter,
    // Query
    SearchService,
    // Indexing
    SearchIndexerService,
    SearchConsumer,
  ],
  exports: [SearchService, SearchIndexerService],
})
export class SearchModule {}
