import { Transform } from 'class-transformer';
import xss from 'xss';

export function XssSanitize() {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return xss(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script'],
    });
  });
}
