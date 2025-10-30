export function topicName(prefix: string, t: string) {
  if (!t) return t;
  return prefix && !t.startsWith(prefix) ? `${prefix}${t}` : t;
}

export function stripPrefix(prefix: string, t: string) {
  if (!prefix) return t;
  return t.startsWith(prefix) ? t.slice(prefix.length) : t;
}
