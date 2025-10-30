import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class StartTotpDto {
  @IsString()
  @IsOptional()
  issuer?: string;

  @IsString()
  @IsOptional()
  label?: string;
}

export class VerifyTotpDto {
  @IsString()
  code: string;
}

export class DisableTotpDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  backupCode?: string;
}

export class GenerateBackupDto {
  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(20)
  count?: number;
}

export class ConsumeBackupDto {
  @IsString()
  code: string;
}

export class DisableWithRecoveryDto {
  @IsString()
  recoveryKey: string;
}
