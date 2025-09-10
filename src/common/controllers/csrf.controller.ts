// src/common/controllers/csrf.controller.ts

import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';

@Controller('csrf')
export class CsrfController {
  @Get('token')
  @Public()
  getCsrfToken(@Req() req: Request, @Res() res: Response) {
    return res.json({ token: req.csrfToken() });
  }
}
