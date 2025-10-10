import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);
  constructor(private readonly svc: NotificationsService) {}

  // mỗi phút bắn các noti đã đến hạn
  @Cron('*/1 * * * *')
  async run() {
    try {
      const r = await this.svc.dispatchDueSafely(200);
      if (r.dispatched) this.logger.log(`Dispatched: ${r.dispatched}`);
    } catch (e: any) {
      this.logger.warn(`scheduler error: ${e?.message || e}`);
    }
  }
}
