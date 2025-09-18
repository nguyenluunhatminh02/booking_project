import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { UpsertCalendarDto } from './dto/upsert-calendar.dto';
import { GetCalendarDto } from './dto/get-calendar.dto';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // nếu có

type AuthedRequest = Request & { user?: { sub: string } };

@Controller('properties')
// @UseGuards(JwtAuthGuard) // bật nếu project có guard
export class PropertyController {
  constructor(private readonly service: PropertyService) {}

  @Post()
  async createProperty(
    @Req() req: AuthedRequest,
    @Body() dto: CreatePropertyDto,
  ) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.createProperty(hostId, dto);
  }

  @Get()
  async listMyProperties(
    @Req() req: AuthedRequest,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.listMyProperties(hostId, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async getMyPropertyById(@Req() req: AuthedRequest, @Param('id') id: string) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.getMyPropertyById(hostId, id);
  }

  @Patch(':id')
  async updateProperty(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.updateProperty(hostId, id, dto);
  }

  @Post(':id/calendar')
  async upsertAvailability(
    @Req() req: AuthedRequest,
    @Param('id') propertyId: string,
    @Body() dto: UpsertCalendarDto,
  ) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.upsertAvailability(hostId, propertyId, dto);
  }

  @Get(':id/calendar')
  async getAvailability(
    @Req() req: AuthedRequest,
    @Param('id') propertyId: string,
    @Query() query: GetCalendarDto,
  ) {
    const hostId = req.user?.sub ?? 'DEV_HOST_ID';
    return this.service.getAvailability(hostId, propertyId, query);
  }
}
