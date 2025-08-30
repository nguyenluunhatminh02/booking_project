import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ACLEffect } from '@prisma/client';
import { Subject, Action } from '../perms';

export class AddRoleDto {
  @IsUUID() userId!: string;
  @IsUUID() roleId!: string;
}

export class RemoveRoleDto {
  @IsUUID() userId!: string;
  @IsUUID() roleId!: string;
}

export class RoleAddPermissionDto {
  @IsUUID() roleId!: string;
  @IsString() subject!: Subject; // type-safe theo perms.ts
  @IsString() action!: Action;
}

export class RoleRemovePermissionDto {
  @IsUUID() roleId!: string;
  @IsString() subject!: Subject;
  @IsString() action!: Action;
}

export class GrantAclDto {
  @IsUUID() userId!: string;
  @IsString() resourceType!: Subject;
  @IsString() resourceId!: string;
  @IsString() action!: Action;
  @IsOptional()
  @IsEnum(ACLEffect)
  effect?: ACLEffect = 'ALLOW';
}

export class RevokeAclDto {
  @IsUUID() userId!: string;
  @IsString() resourceType!: Subject;
  @IsString() resourceId!: string;
  @IsString() action!: Action;
}
