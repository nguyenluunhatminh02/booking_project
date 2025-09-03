@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.$use(async (params, next) => {
      // Log queries in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('Query:', params);
      }
      return next(params);
    });
  }
}

---

// sanitizer.ts
import sanitizeHtml from 'sanitize-html';

export function sanitizeRichText(input: string) {
  return sanitizeHtml(input, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'ul', 'li', 'code', 'pre'],
    allowedAttributes: { a: ['href', 'name', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Tip: thêm rel="noopener noreferrer" cho link target="_blank"
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, rel: 'noopener noreferrer' }
      })
    }
  });
}
