@Post('login')
@Audit({
  action: 'AUTH_LOGIN',
  entity: 'USER',
  select: [
    { in: 'body', key: 'email' }
  ],
  idSelector: AuditId.params('id'), // lấy từ URL param,
  resolveId: (_req, _res, result) => result?.id, // lấy id từ response JSON
})
async login() {
  // ...
}

===

// Inject service
constructor(private readonly auditLogger: AuditLogService) {}

// Sử dụng trong methods
await this.auditLogger.log({
  action: 'MFA_DISABLED',
  actorId: userId,
  entity: 'mfa',
  metadata: {
    method: 'recovery_key'
  }
});