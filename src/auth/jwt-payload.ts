import type { Role } from '../generated/prisma/enums.js';

export interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
}