import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { AuthDto } from './dto/auth.dto.js';
import type { JwtPayload } from './jwt-payload.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: AuthDto) {
    return this.authService.register(dto.username, dto.password);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AuthDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}