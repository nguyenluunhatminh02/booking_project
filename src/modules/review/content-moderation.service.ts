import { BadRequestException, Injectable, Logger } from '@nestjs/common';

type Mode = 'block' | 'mask' | 'flag';

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  // block | mask | flag
  private readonly mode: Mode =
    (process.env.COMMENT_MODERATION_MODE as Mode) || 'block';

  private readonly maskChar =
    process.env.COMMENT_MODERATION_MASK_CHAR &&
    process.env.COMMENT_MODERATION_MASK_CHAR.length
      ? process.env.COMMENT_MODERATION_MASK_CHAR
      : '*';

  // CSV ENV: "tu khoa 1,tu khoa 2"
  private readonly blocklistExact: string[] = (
    process.env.COMMENT_MODERATION_BLOCKLIST || ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // (Tuỳ chọn) từ điển mặc định — bạn có thể mở rộng thêm
  private readonly defaultProfanity = [
    // TV/teencode (tối thiểu)
    'dm',
    'đm',
    'dit me',
    'ditme',
    'địt',
    'lồn',
    'lon',
    'cặc',
    'cak',
    'đụ',
    'vcl',
    'vl',
    // EN
    'fuck',
    'shit',
    'bitch',
    'bastard',
    'asshole',
  ];

  // Bật/ tắt dùng default list qua ENV (mặc định dùng)
  private readonly useDefault =
    (process.env.COMMENT_MODERATION_USE_DEFAULT || '1') === '1';

  private get allBlockWords(): string[] {
    const arr = [
      ...(this.useDefault ? this.defaultProfanity : []),
      ...this.blocklistExact,
    ];
    // unique & bỏ rỗng
    return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
  }

  // Các pattern PII / link
  private readonly patterns: { name: string; re: RegExp }[] = [
    { name: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
    {
      name: 'phone_vn',
      // +84 hoặc 0 + đầu số 3/5/7/8/9, cho phép -, ., khoảng trắng giữa các nhóm
      re: /(?<!\d)(?:\+?84|0)[\s\-\\.]?(?:3|5|7|8|9)(?:[\s\-\\.]?\d){8}\b/giu,
    },
    { name: 'url', re: /\b(?:https?:\/\/|www\.)\S+/giu },
  ];

  /** Chuẩn hoá chuỗi để bắt teencode / lách luật thô */
  private normalize(raw: string) {
    let s = (raw || '').normalize('NFD').replace(/\p{M}+/gu, ''); // bỏ dấu
    s = s.toLowerCase();
    s = s
      .replace(/[@]/g, 'a')
      .replace(/[€₫]/g, 'e')
      .replace(/[$]/g, 's')
      .replace(/[0]/g, 'o')
      .replace(/[1!|]/g, 'i')
      .replace(/[3]/g, 'e')
      .replace(/[4]/g, 'a')
      .replace(/[5]/g, 's')
      .replace(/[7]/g, 't');
    // nén lặp: "điiiiii" -> "đii"
    s = s.replace(/(\p{L})\1{2,}/gu, '$1$1');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /** Fuzzy regex cho 1 từ: cho phép chèn 0..3 ký tự không phải chữ/số giữa các chữ */
  private compileFuzzyWord(word: string): RegExp {
    const letters = this.normalize(word).split('');
    const sep = '[^\\p{L}\\p{N}]{0,3}'; // cho phép ., -, _, khoảng trắng… xen giữa
    const pat = `(?<!\\p{L})(?:${letters.map(escapeRegExp).join(sep)})(?!\\p{L})`;
    // dùng giu để replace all + unicode + case-insensitive
    return new RegExp(pat, 'giu');
  }

  /** Che chuỗi bằng maskChar, độ dài 3..32 */
  private mask(s: string) {
    const len = Math.min(Math.max(s.length, 3), 32);
    return this.maskChar.repeat(len);
  }

  /**
   * Kiểm duyệt nội dung:
   * - Blocklist (fuzzy) + PII patterns
   * - mode=block: throw 400
   * - mode=flag: giữ nguyên text, trả về flagged[]
   * - mode=mask: che PII + từ bậy và trả về text đã mask
   */
  processOrThrow(body: string): { body: string; flagged: string[] } {
    const flagged: string[] = [];
    const normalized = this.normalize(body);

    // 1) Fuzzy blocklist
    const words = this.allBlockWords;
    const fuzzies = words.map((w) => ({ w, re: this.compileFuzzyWord(w) }));
    for (const { w, re } of fuzzies) {
      if (re.test(body) || re.test(normalized)) {
        flagged.push(w);
      }
    }

    // 2) PII/link (regex trên body gốc)
    for (const p of this.patterns) {
      if (p.re.test(body)) flagged.push(p.name);
    }

    if (!flagged.length) return { body, flagged: [] };

    // === hành vi theo mode ===
    if (this.mode === 'block') {
      throw new BadRequestException('Nội dung chứa từ khóa/PII bị cấm.');
    }

    if (this.mode === 'flag') {
      this.logger.warn(
        `Review flagged: ${Array.from(new Set(flagged)).join(', ')}`,
      );
      return { body, flagged: Array.from(new Set(flagged)) };
    }

    // mask mode
    let masked = body;

    // Che PII/link trước để giảm khả năng lộ thông tin
    for (const p of this.patterns) {
      masked = masked.replace(p.re, (m) => this.mask(m));
    }

    // Che từ bậy theo fuzzy
    for (const { re } of fuzzies) {
      masked = masked.replace(re, (m) => this.mask(m));
    }

    return { body: masked, flagged: Array.from(new Set(flagged)) };
  }
}
