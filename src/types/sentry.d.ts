// Optional ambient declaration for @sentry/node so code can reference it
// without requiring the package to be installed at compile time.
declare module '@sentry/node' {
  const Sentry: any;
  export default Sentry;
  export function init(...args: any[]): void;
  export function withScope(cb: (scope: any) => void): void;
  export function captureException(err: any): void;
}
