import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Permission } from '@petmore/shared';
import { AuthService } from './auth.service';
import { AuthedRequest, PERMISSIONS_KEY, PUBLIC_KEY } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & Partial<AuthedRequest>>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = await this.auth.resolve(token);
    if (!session) throw new UnauthorizedException('หมดเวลาใช้งานแล้ว กรุณาเข้าสู่ระบบอีกครั้ง');
    req.user = session.user;
    req.token = token;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    if (required?.length && !required.some((p) => session.user.permissions.includes(p))) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้ ติดต่อผู้ดูแลระบบหากต้องใช้');
    }
    return true;
  }
}
