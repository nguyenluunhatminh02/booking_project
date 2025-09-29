import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReviewService } from './review.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@UseGuards(JwtAuthGuard)
@Controller('reviews')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Post()
  async create(@Req() req, @Body() dto: CreateReviewDto) {
    const userId = req.user.id as string;
    const idem = (req.headers['idempotency-key'] as string) || undefined;
    return this.service.create(userId, dto, idem);
  }

  @Get()
  async list(@Query() q: ListReviewsQueryDto) {
    const limit = q.limit ?? 20;
    return this.service.listByProperty(q.propertyId, q.cursor, limit);
  }

  @Patch(':id')
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    const userId = req.user.id as string;
    const idem = (req.headers['idempotency-key'] as string) || undefined;
    return this.service.update(userId, id, dto, idem);
  }

  @Delete(':id')
  async remove(@Req() req, @Param('id') id: string) {
    const userId = req.user.id as string;
    const idem = (req.headers['idempotency-key'] as string) || undefined;
    return this.service.remove(userId, id, idem);
  }
}
