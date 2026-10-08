import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, SessionUser } from '@petmore/shared';

export const PUBLIC_KEY = 'wms:public';
export const PERMISSIONS_KEY = 'wms:permissions';

/** endpoint ที่ไม่ต้องเข้าสู่ระบบ */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** ต้องมีสิทธิ์อย่างน้อยหนึ่งข้อในรายการ */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export interface AuthedRequest {
  user: SessionUser;
  token: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
