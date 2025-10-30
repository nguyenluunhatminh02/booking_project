// src/common/transforms/senitize-html.transform.ts  (nên sửa lại tên file “sanitize”)
import { Transform } from 'class-transformer';
import { filterXSS } from 'xss';

export function XssSanitize() {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return filterXSS(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script'],
    });
  });
}
