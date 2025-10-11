// src/modules/property/property.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { UpsertCalendarDto } from './dto/upsert-calendar.dto';
import { GetCalendarDto } from './dto/get-calendar.dto';
import { MediaType } from '@prisma/client';

/** Force a date to UTC 00:00 (bucket per day) */
function toUtcStartOfDay(input: string | Date): Date {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date: ' + String(input));
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

@Injectable()
export class PropertyService {
  constructor(private readonly prisma: PrismaService) {}

  // --- constants / guards ---
  private static readonly MAX_CAL_ITEMS = 366; // tối đa 1 năm
  private static readonly UPSERT_CHUNK = 150; // size mỗi batch
  private static readonly MAX_CAL_WINDOW_DAYS = 366;

  // ----------------- ownership -----------------
  async assertOwnership(hostId: string, propertyId: string) {
    const prop = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, hostId: true },
    });
    if (!prop) throw new NotFoundException('Property not found');
    if (prop.hostId !== hostId) throw new ForbiddenException('Not the owner');
    return prop;
  }

  // ----------------- CRUD property -----------------
  async createProperty(hostId: string, dto: CreatePropertyDto) {
    return this.prisma.property.create({
      data: {
        hostId,
        title: dto.title,
        address: dto.address,
        description: dto.description ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        amenities: dto.amenities ?? {},
      },
    });
  }

  async listMyProperties(
    hostId: string,
    opts?: { skip?: number; take?: number },
  ) {
    const skip = clamp(opts?.skip ?? 0, 0, 10_000);
    const take = clamp(opts?.take ?? 20, 1, 100);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where: { hostId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          // lấy cover nhanh (nếu có)
          mediaLinks: {
            where: { type: MediaType.IMAGE, isCover: true },
            take: 1,
            include: { file: true },
          },
        },
      }),
      this.prisma.property.count({ where: { hostId } }),
    ]);

    const itemsWithCover = items.map((p) => {
      const mediaLinksRaw = Array.isArray((p as any).mediaLinks)
        ? (p as any).mediaLinks
        : [];
      const coverLink = mediaLinksRaw[0];
      const cover = coverLink?.file
        ? {
            url: coverLink.file.url,
            width: coverLink.file.width,
            height: coverLink.file.height,
          }
        : null;
      // bỏ mediaLinks nặng nề khỏi list
      const { mediaLinks, ...rest } = p as any;
      return { ...rest, cover };
    });

    return { items: itemsWithCover, total, skip, take };
  }

  async getMyPropertyById(hostId: string, id: string) {
    await this.assertOwnership(hostId, id);

    const prop = await this.prisma.property.findUnique({
      where: { id },
      include: {
        // Đúng với schema: mediaLinks (bảng nối) + file thật
        mediaLinks: {
          where: { type: MediaType.IMAGE },
          orderBy: [
            { isCover: 'desc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
          include: { file: true },
        },
        // Nên phân trang reviews ở endpoint riêng nếu dữ liệu lớn
        reviews: true,
      },
    });
    if (!prop) throw new NotFoundException('Property not found');

    // Map ra photos cho FE dùng dễ, nhưng vẫn giữ nguyên mediaLinks nếu cần
    const photos = prop.mediaLinks.map((m) => ({
      propertyFileId: m.id,
      fileId: m.fileId,
      url: m.file.url,
      width: m.file.width,
      height: m.file.height,
      isCover: m.isCover,
      sortOrder: m.sortOrder,
      createdAt: m.createdAt,
    }));

    const { mediaLinks, ...rest } = prop as any;
    return { ...rest, photos, mediaLinks }; // trả cả hai tuỳ FE chọn dùng
  }

  async updateProperty(hostId: string, id: string, dto: UpdatePropertyDto) {
    await this.assertOwnership(hostId, id);
    return this.prisma.property.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        address: dto.address ?? undefined,
        description: dto.description ?? undefined,
        lat: dto.lat ?? undefined,
        lng: dto.lng ?? undefined,
        amenities: dto.amenities ?? undefined,
      },
    });
  }

  // ----------------- Property photos helpers -----------------
  /** Gắn 1 ảnh (File) vào Property (bảng nối PropertyFile). */
  async addPhoto(
    hostId: string,
    propertyId: string,
    fileId: string,
    opts?: { isCover?: boolean; sortOrder?: number },
  ) {
    await this.assertOwnership(hostId, propertyId);

    // validate file tồn tại (tuỳ chọn)
    const f = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!f) throw new NotFoundException('File not found');

    // tạo link (unique [propertyId, fileId])
    const link = await this.prisma.propertyFile.create({
      data: {
        propertyId,
        fileId,
        type: MediaType.IMAGE,
        isCover: !!opts?.isCover,
        sortOrder: opts?.sortOrder ?? 0,
      },
      include: { file: true },
    });

    // đảm bảo duy nhất cover
    if (opts?.isCover) {
      await this.prisma.propertyFile.updateMany({
        where: { propertyId, id: { not: link.id } },
        data: { isCover: false },
      });
    }

    return link;
  }

  /** Gỡ 1 ảnh khỏi Property (không xoá File gốc). */
  async removePhoto(hostId: string, propertyFileId: string) {
    // kiểm tra ownership qua join
    const link = await this.prisma.propertyFile.findUnique({
      where: { id: propertyFileId },
      include: { property: { select: { hostId: true } } },
    });
    if (!link) throw new NotFoundException('Media link not found');
    if (link.property.hostId !== hostId) throw new ForbiddenException();

    await this.prisma.propertyFile.delete({ where: { id: propertyFileId } });
    return { ok: true };
  }

  /** Đặt một ảnh làm cover duy nhất. */
  async setCover(hostId: string, propertyId: string, propertyFileId: string) {
    await this.assertOwnership(hostId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.propertyFile.findUnique({
        where: { id: propertyFileId },
      });
      if (!link || link.propertyId !== propertyId) {
        throw new BadRequestException('Invalid media link');
      }
      await tx.propertyFile.updateMany({
        where: { propertyId },
        data: { isCover: false },
      });
      const updated = await tx.propertyFile.update({
        where: { id: propertyFileId },
        data: { isCover: true },
        include: { file: true },
      });
      return updated;
    });
  }

  /** Sắp xếp lại thứ tự ảnh (sortOrder) theo danh sách. */
  async reorderPhotos(
    hostId: string,
    propertyId: string,
    orders: Array<{ propertyFileId: string; sortOrder: number }>,
  ) {
    await this.assertOwnership(hostId, propertyId);
    if (!Array.isArray(orders) || !orders.length) {
      throw new BadRequestException('orders required');
    }

    // (tuỳ chọn) đảm bảo tất cả propertyFileId thuộc property này
    const ids = orders.map((o) => o.propertyFileId);
    const owns = await this.prisma.propertyFile.count({
      where: { id: { in: ids }, propertyId },
    });
    if (owns !== orders.length) {
      throw new ForbiddenException(
        'One or more photos do not belong to property',
      );
    }

    await this.prisma.$transaction(
      orders.map((o) =>
        this.prisma.propertyFile.update({
          where: { id: o.propertyFileId },
          data: { sortOrder: o.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }

  // ----------------- Availability (calendar) -----------------
  /**
   * Upsert lịch theo ngày:
   * - Tạo mới: **bắt buộc có price**
   * - Nếu isBlocked === true => ép remaining = 0
   * - Giới hạn items và chunk để tránh transaction quá lớn
   */
  async upsertAvailability(
    hostId: string,
    propertyId: string,
    dto: UpsertCalendarDto,
  ) {
    await this.assertOwnership(hostId, propertyId);

    if (!dto.items?.length) {
      throw new BadRequestException('items is required');
    }
    if (dto.items.length > PropertyService.MAX_CAL_ITEMS) {
      throw new BadRequestException(
        `items too many (> ${PropertyService.MAX_CAL_ITEMS})`,
      );
    }

    // Normalize + validate từng item
    type Norm = {
      date: Date;
      price?: number;
      remaining?: number;
      isBlocked?: boolean;
    };

    const normalized: Norm[] = dto.items.map((it) => {
      const day = toUtcStartOfDay(it.date);

      if (it.price != null) {
        if (typeof it.price !== 'number' || it.price < 0) {
          throw new BadRequestException('price must be a non-negative number');
        }
      }
      if (it.remaining != null) {
        if (!Number.isInteger(it.remaining) || it.remaining < 0) {
          throw new BadRequestException(
            'remaining must be a non-negative integer',
          );
        }
      }

      const isBlocked = it.isBlocked ?? undefined;
      const remaining = isBlocked === true ? 0 : (it.remaining ?? undefined);

      return {
        date: day,
        price: it.price ?? undefined,
        remaining,
        isBlocked,
      };
    });

    // Dedupe theo ngày (giữ item cuối cùng nếu trùng)
    const byDay = new Map<string, Norm>();
    for (const it of normalized) {
      byDay.set(it.date.toISOString(), it);
    }
    const compact = Array.from(byDay.values());

    // Chunk để giảm áp lực transaction
    const chunkSize = PropertyService.UPSERT_CHUNK;
    const chunks: Norm[][] = [];
    for (let i = 0; i < compact.length; i += chunkSize) {
      chunks.push(compact.slice(i, i + chunkSize));
    }

    let updated = 0;
    const items: any[] = [];

    for (const chunk of chunks) {
      // 1) Pre-check xem những ngày nào đã tồn tại
      const dates = chunk.map((it) => it.date);
      const existed = await this.prisma.availabilityDay.findMany({
        where: { propertyId, date: { in: dates } },
        select: { date: true },
      });
      const existSet = new Set(existed.map((r) => r.date.toISOString()));

      // 2) Lập ops: create cần price; update thì không bắt buộc price
      const ops = chunk.map((it) => {
        const iso = it.date.toISOString();
        const isCreate = !existSet.has(iso);

        if (isCreate && it.price == null) {
          throw new BadRequestException(
            `price required on create for date=${iso.slice(0, 10)}`,
          );
        }

        return this.prisma.availabilityDay.upsert({
          where: { propertyId_date: { propertyId, date: it.date } },
          create: {
            propertyId,
            date: it.date,
            price: it.price!, // an toàn vì đã check ở trên khi create
            remaining: it.remaining ?? 0,
            isBlocked: it.isBlocked ?? false,
          },
          update: {
            price: it.price ?? undefined,
            remaining: it.remaining ?? undefined,
            isBlocked: it.isBlocked ?? undefined,
          },
        });
      });

      const res = await this.prisma.$transaction(ops);
      updated += res.length;
      items.push(...res);
    }

    return { updated, items };
  }

  /**
   * Lấy lịch theo cửa sổ [from, to) (nửa kín).
   * - Mặc định: from = hôm nay (UTC 00:00), to = from + 60 ngày
   * - Cap tối đa 366 ngày để tránh query lớn
   */
  async getAvailability(
    hostId: string,
    propertyId: string,
    query: GetCalendarDto,
  ) {
    await this.assertOwnership(hostId, propertyId);

    const todayUtc = toUtcStartOfDay(new Date());
    const from = query.from ? toUtcStartOfDay(query.from) : todayUtc;

    const defaultTo = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + 60,
      ),
    );
    const to = query.to ? toUtcStartOfDay(query.to) : defaultTo;

    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('to must be >= from');
    }

    const windowDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
    if (windowDays > PropertyService.MAX_CAL_WINDOW_DAYS) {
      throw new BadRequestException(
        `window too large (> ${PropertyService.MAX_CAL_WINDOW_DAYS} days)`,
      );
    }

    const days = await this.prisma.availabilityDay.findMany({
      where: { propertyId, date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    });

    return { from, to, days };
  }
}
