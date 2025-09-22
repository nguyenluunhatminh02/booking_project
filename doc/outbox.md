Ngắn gọn: **Outbox** nên được dùng ở các “điểm biên” nơi state đã thay đổi xong và cần thông báo cho module khác; **Saga** nên nằm ở các “luồng nghiệp vụ nhiều bước” (hold → pay → confirm/refund …) để điều phối/chống lỗi giữa các module.

### Đặt ở module nào?

**1) BookingModule (trọng tâm – nên có cả Outbox & Saga)**

* Outbox phát:
  `booking.held`, `booking.review_pending`, `booking.review_approved`, `booking.review_rejected`, `booking.confirmed`, `booking.cancelled`, `booking.expired`.
* Saga nhận/điều phối:
  từ `payment.succeeded` → xác nhận booking, áp dụng promotion, xuất invoice, gửi email…
  từ `payment.refunded`/`booking.cancelled` → trả kho, release promotion, gửi email.

**2) PaymentModule**

* Outbox phát: `payment.succeeded`, `payment.failed`, `payment.refunded`.
* Saga (hoặc handler) nhận `booking.confirm_request` để gọi cổng thanh toán; khi callback thành công, phát `payment.succeeded` cho BookingSaga xử lý phần còn lại.

**3) PromotionModule**

* Nhận: `booking.held` → `applyOnHold` (reserve).
* Nhận: `payment.succeeded` → `confirmOnPaid` (applied, usedCount++).
* Nhận: `booking.cancelled`/`booking.expired`/`payment.refunded` → `releaseOnCancelOrExpire` (released, dùng `cause`).
* (Tùy) Outbox phát: `promotion.applied`, `promotion.released`.

**4) FraudModule**

* Nhận: `booking.held` → chạy chấm điểm, nếu MEDIUM phát `booking.review_pending`.
* Quyết định review (APPROVED/REJECTED) → phát `booking.review_approved`/`booking.review_rejected`.
* (Tùy) nếu quá hạn review (job) → `AUTO_DECLINED` + phát `booking.expired` hoặc `booking.review_auto_declined`.

**5) Inventory/Calendar (có thể vẫn xử lý “gần” Booking)**

* Nhận: `booking.held` → trừ kho; `booking.cancelled`/`expired`/`refunded` → trả kho.
  (Trong monolith có thể làm trong cùng transaction; nhưng vẫn nên phát outbox để các module khác (promotion/notify) biết.)

**6) Notification/EmailModule**

* Nhận: `booking.held/confirmed/cancelled/expired`, `payment.succeeded/refunded`, `promotion.applied/released` → gửi mail/SMS.
* Không cần biết DB schema của booking/payments.

**7) InvoiceModule**

* Nhận: `booking.confirmed` hoặc `payment.succeeded` → tạo PDF + gửi mail (hoặc chờ user tải).
* Có thể phát `invoice.issued` (tùy).

**8) Analytics/Search/Reporting (nếu có)**

* Consume các event trên để cập nhật chỉ số, báo cáo, index tìm kiếm.

---

### Cấu trúc gợi ý

```
src/modules/outbox/
  outbox.producer.ts      // gọi trong transaction
  outbox.dispatcher.ts    // job/cron/poller: đọc outbox -> publish/route
  outbox.handlers.ts      // map topic -> handler (trong monolith dùng in-process)
src/modules/booking/booking.saga.ts
src/modules/payment/payment.saga.ts
src/modules/promotion/promotion.handlers.ts
src/modules/notification/notification.handlers.ts
src/modules/invoice/invoice.handlers.ts
```

Trong **monolith**, `outbox.dispatcher` có thể:

* Đọc `Outbox` theo `createdAt`/`id` > lastOffset,
* Gọi handler in-process theo `topic`,
* (Tùy) đánh dấu `ProcessedEvent` để idempotent.

---

### Ví dụ mini

**Trong BookingService (sau khi HOLD thành công):**

```ts
await tx.outbox.create({
  data: {
    topic: 'booking.held',
    eventKey: booking.id,
    payload: { bookingId: booking.id, customerId, totalPrice },
  },
});
```

**BookingSaga handler (consume outbox in-process):**

```ts
handlers['payment.succeeded'] = async (evt) => {
  const { bookingId } = evt.payload;
  // 1) confirm booking
  await bookingService.confirm(bookingId);
  // 2) promotion applied
  await promotionService.confirmOnPaid(bookingId);
  // 3) invoice + email
  await invoiceService.emailInvoice(bookingId);
};
```

**Promotion handler:**

```ts
handlers['booking.held'] = (evt) =>
  promotionService.applyOnHold({ bookingId: evt.payload.bookingId, userId: evt.payload.customerId, code: evt.payload.promoCode });
handlers['booking.cancelled'] = (evt) =>
  promotionService.releaseOnCancelOrExpire(evt.payload.bookingId, false, 'CANCELLED');
```

---

### Khi nào dùng cái nào?

* **Outbox**: mọi nơi bạn “đã commit DB xong” và muốn thông báo cho module khác mà **không muốn coupling** hoặc **sợ mất sự kiện** (send mail, xuất invoice, analytics, search, indexing…).
* **Saga**: mọi luồng **đa bước/đa module** có khả năng lỗi giữa chừng (thanh toán, refund, hủy đơn, review fraud), cần **điều phối** + **bù trừ (compensation)** nếu lỗi.

> TL;DR: Hãy đặt **Outbox** ở Booking/Payment (điểm giao), và đặt **Saga** chủ yếu ở **Booking** (orchestrator chính), còn Promotion/Invoice/Notification đóng vai trò **handlers/consumers**. Trong monolith dùng in-process handlers; nếu sau này tách service, chỉ cần thay dispatcher publish ra Kafka/Rabbit mà không đổi logic nghiệp vụ.
