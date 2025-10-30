export type RenderEmail = { subject: string; html?: string; text?: string };
export type RenderInapp = { title: string; body?: string };
export type RenderPush = {
  title: string;
  body?: string;
  data?: Record<string, any>;
};

export type TemplateSpec = {
  key: string;
  renderEmail?: (ctx: any) => RenderEmail;
  renderInapp?: (ctx: any) => RenderInapp;
  renderPush?: (ctx: any) => RenderPush;
};

function esc(s: any) {
  return String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  review_reminder: {
    key: 'review_reminder',
    renderEmail: (ctx) => {
      const attempt = Number(ctx?.attempt ?? 1);
      const subject =
        attempt === 1
          ? `Hoàn tất đánh giá cho ${ctx?.propertyTitle || 'chỗ ở của bạn'}`
          : `Nhắc lại: bạn quên đánh giá ${ctx?.propertyTitle || 'chỗ ở'} 😄`;
      const url = ctx?.reviewUrl || '#';
      const html = `
        <div>
          <p>Chào bạn,</p>
          <p>Bạn vừa hoàn tất chuyến ở tại <b>${esc(ctx?.propertyTitle || '')}</b>.
             Hãy để lại đánh giá để giúp chủ nhà và khách khác nhé.</p>
          <p><a href="${esc(url)}">Viết đánh giá ngay</a></p>
          <p>Cảm ơn bạn!</p>
        </div>`;
      return { subject, html, text: `Hãy đánh giá: ${url}` };
    },
    renderInapp: (ctx) => ({
      title: 'Nhắc đánh giá sau chuyến đi',
      body: `Bạn đã ở xong tại "${ctx?.propertyTitle || ''}". Nhấn để viết review.`,
    }),
    renderPush: (ctx) => ({
      title: 'Nhắc đánh giá',
      body: `Bạn đã ở xong tại "${ctx?.propertyTitle || ''}".`,
      data: { action: 'open_review', bookingId: ctx?.bookingId },
    }),
  },

  generic_info: {
    key: 'generic_info',
    renderInapp: (ctx) => ({
      title: String(ctx?.title || 'Thông báo'),
      body: String(ctx?.body || ''),
    }),
    renderEmail: (ctx) => ({
      subject: String(ctx?.subject || 'Thông báo'),
      text: String(ctx?.text || ''),
    }),
    renderPush: (ctx) => ({
      title: String(ctx?.title || 'Thông báo'),
      body: String(ctx?.body || ''),
    }),
  },
};

export function getTemplate(key: string): TemplateSpec | null {
  return TEMPLATES[key] || null;
}
