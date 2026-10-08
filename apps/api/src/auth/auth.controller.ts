import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { PERMISSION_GROUPS, PERMISSIONS, ROLE_DEFAULTS, ROLES } from '@petmore/shared';
import { AuthService } from './auth.service';
import { AuthedRequest, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body?.username, body?.password);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest) {
    await this.auth.logout(req.token);
  }

  @Get('session')
  async session(@Req() req: AuthedRequest) {
    const s = await this.auth.resolve(req.token);
    return { user: req.user, expiresAt: s?.expiresAt.toISOString() };
  }

  @Get('catalog')
  catalog() {
    return { permissions: PERMISSIONS, groups: PERMISSION_GROUPS, roles: ROLES, defaults: ROLE_DEFAULTS };
  }
}
