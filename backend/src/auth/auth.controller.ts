import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { getFrontendCallbackUrl } from '../common/env';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('42')
  @UseGuards(AuthGuard('42'))
  authenticateWith42() {
    // Redirects to 42 OAuth provider automatically.
  }

  @Get('42/callback')
  @UseGuards(AuthGuard('42'))
  async authenticateWith42Callback(
    @Req() req: Request & { user: { accessToken: string; user: any } },
    @Res() res: Response,
  ) {
    const token = req.user?.accessToken;
    const redirectUrl = token ? getFrontendCallbackUrl(token) : null;

    if (redirectUrl) {
      return res.redirect(redirectUrl);
    }

    return res.json(req.user);
  }
}
