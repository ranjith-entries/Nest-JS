# Authentication — Detailed Guide (A1 – A3)

Backend: NestJS 12 (Express) · Prisma 7 + SQLite · `bcryptjs` · `@nestjs/jwt`

> Short version: see `AUTH.md`. This file explains every piece in depth, with the actual code.

---

## Table of contents

1. [Concepts](#1-concepts)
2. [The full flow](#2-the-full-flow)
3. [A1 — Users, register & login](#3-a1--users-register--login)
4. [A2 — JWT access token](#4-a2--jwt-access-token)
5. [A3 — Global JWT guard](#5-a3--global-jwt-guard)
6. [Request lifecycle](#6-request-lifecycle)
7. [Files overview](#7-files-overview)
8. [Testing](#8-testing)
9. [Security decisions](#9-security-decisions)
10. [Troubleshooting](#10-troubleshooting)
11. [Common questions](#11-common-questions)
12. [What's next](#12-whats-next)

---

## 1. Concepts

| | Authentication (AuthN) | Authorization (AuthZ) |
|---|---|---|
| Question | **Who are you?** | **What are you allowed to do?** |
| Example | Log in with username + password | Only admins can see all todos |
| Failure | **401 Unauthorized** | **403 Forbidden** (or 404 for "not yours") |
| Status in this app | ✅ A1–A3 done | ⏳ A4 (ownership), A5 (roles) |

**The core problem:** HTTP is *stateless*. Every request stands alone — the server doesn't remember
that you logged in a second ago. So after login, the server gives the client a **token**, and the
client sends it with every request to prove who it is.

```
Without a token:                         With a token:
POST /auth/login  → "OK, you're alice"   POST /auth/login  → { access_token }
GET  /todos       → "Who are you?" 🤷    GET  /todos + token → "Hi alice" ✅
```

---

## 2. The full flow

```
┌──────────┐                                   ┌──────────────────────────────────────────┐
│  Client  │                                   │                 Backend                  │
└────┬─────┘                                   └──────────────────────────────────────────┘
     │ 1. POST /auth/register {username, password}
     │ ───────────────────────────────────────►  hash password (bcrypt) → save User
     │ ◄─────────────────────────────────────── 201 { id, username, role }
     │
     │ 2. POST /auth/login {username, password}
     │ ───────────────────────────────────────►  find user → bcrypt.compare
     │                                           ✅ sign JWT {sub, username, role} (1h)
     │ ◄─────────────────────────────────────── 200 { access_token }
     │
     │ 3. GET /todos
     │    Authorization: Bearer <token>
     │ ───────────────────────────────────────►  JwtAuthGuard: verify signature + expiry
     │                                           ✅ request.user = {sub, username, role}
     │                                           → controller → service → DB
     │ ◄─────────────────────────────────────── 200 [ ...todos ]
     │
     │ 4. GET /todos (no token / bad token)
     │ ───────────────────────────────────────►  JwtAuthGuard ✋
     │ ◄─────────────────────────────────────── 401
```

---

## 3. A1 — Users, register & login

### What
- A `User` table in the database.
- `POST /auth/register` creates an account.
- `POST /auth/login` checks the username and password.

### Why
- The app needs to know who its users are before it can protect anything.
- Passwords must **never** be stored as plain text. If the database leaked, every password would leak
  too — and people reuse passwords on other sites.

### How

#### 3.1 Database model — `prisma/schema.prisma`

```prisma
enum Role {
  USER
  ADMIN
}

model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  role         Role     @default(USER)
  createdAt    DateTime @default(now())
}
```

| Field | Why |
|---|---|
| `username @unique` | The **database** rejects duplicates, and adds an index for fast lookup |
| `passwordHash` | The name reminds everyone: never plain text |
| `role Role @default(USER)` | Only `USER` or `ADMIN` allowed; new users are always `USER` |

Applied with:
```bash
pnpm exec prisma migrate dev --name add_user
pnpm exec prisma generate
```

#### 3.2 Password hashing (bcrypt)

A **hash** is a one-way scramble:
```
"alice123"  ──hash──►  "$2b$10$NHLAECe1voYI9OxMJ0YR..."   (cannot be reversed)
```

bcrypt output explained:
```
$2b$10$NHLAECe1voYI9OxMJ0YRK.EPT3MQSLGpZGMhGvzvPmaAa.TtTUAPe
 │   │  └──── salt (22 chars) ───┘└──────── hash ──────────┘
 │   └─ cost (2^10 rounds)
 └─ algorithm version
```

| Property | Why it matters |
|---|---|
| **One-way** | Nobody (not even us) can recover the password from the hash |
| **Salted** | The same password gives a different hash each time → precomputed "rainbow tables" don't work |
| **Slow on purpose** (cost 10 ≈ 0.1s) | Guessing billions of passwords becomes impractical |

At login we don't "decrypt" — we hash the typed password the same way and compare:
```
compare("alice123", storedHash)  →  true
compare("wrong",    storedHash)  →  false
```

#### 3.3 `UsersModule` — data access for users

`src/users/users.service.ts`
```ts
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  create(username: string, passwordHash: string) {
    return this.prisma.user.create({ data: { username, passwordHash } });
  }
}
```

`src/users/users.module.ts`
```ts
@Module({
  providers: [UsersService],
  exports: [UsersService],   // ← share with other modules
})
export class UsersModule {}
```

**Module sharing rule:** a service is private to its module unless it's exported.
```
UsersModule:  exports: [UsersService]   ← "I share this"
AuthModule:   imports: [UsersModule]    ← "I use what it shares"
```
Forget either → `Nest can't resolve dependencies of the AuthService (?)`.

#### 3.4 Input validation — `src/auth/dto/auth.dto.ts`

```ts
export class AuthDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```
Checked by the global `ValidationPipe` before the controller runs → bad input = **400**.

#### 3.5 Business logic — `src/auth/auth.service.ts`

```ts
async register(username: string, password: string) {
  const existing = await this.usersService.findByUsername(username);
  if (existing) {
    throw new ConflictException('Username already taken');            // 409
  }
  const passwordHash = await hash(password, 10);
  const user = await this.usersService.create(username, passwordHash);
  return { id: user.id, username: user.username, role: user.role };   // no passwordHash!
}

async login(username: string, password: string) {
  const user = await this.usersService.findByUsername(username);
  if (!user || !(await compare(password, user.passwordHash))) {
    throw new UnauthorizedException('Invalid username or password');  // 401
  }
  // A2: returns a token here
}
```

| Decision | Why |
|---|---|
| `await hash(...)` (async) | Hashing is slow; `await` lets the server handle other requests meanwhile |
| Same 401 message for wrong username **and** wrong password | Prevents *user enumeration* — attackers can't learn which usernames exist |
| Return only `{ id, username, role }` | Never send `passwordHash` to the client — not even the hash |
| No `role` input on register | Nobody can register themselves as `ADMIN` |

#### 3.6 Routes — `src/auth/auth.controller.ts`

```ts
@Controller('auth')
export class AuthController {
  @Post('register')                 // 201 Created (default for POST)
  register(@Body() dto: AuthDto) { ... }

  @Post('login')
  @HttpCode(200)                    // login doesn't create anything → 200, not 201
  login(@Body() dto: AuthDto) { ... }
}
```

#### 3.7 Creating the admin
1. Register `admin` like any user.
2. `pnpm studio` → `User` table → change `role` to `ADMIN` → save.

---

## 4. A2 — JWT access token

### What
`POST /auth/login` returns:
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs...eyJzdWIiOjIs...E2zqfrQ1p7K8..." }
```

### Why
The server needs a way to recognise the user on **later** requests without asking for the password
every time. The token is a signed "visitor badge".

### How

#### 4.1 Setup

```bash
pnpm add @nestjs/jwt
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # generate a secret
```

`.env` (each variable on its own line):
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="<random 32-byte base64 value>"
```

`src/auth/auth.module.ts`
```ts
JwtModule.register({
  secret: process.env.JWT_SECRET,
  signOptions: { expiresIn: '1h' },
}),
```
`process.env.JWT_SECRET` is available because `import 'dotenv/config'` is the **first line** of `main.ts`.

#### 4.2 Signing — end of `login()`

```ts
const payload = { sub: user.id, username: user.username, role: user.role };
return { access_token: await this.jwtService.signAsync(payload) };
```

#### 4.3 How a JWT is built

A JWT is three base64url parts joined by dots: `header.payload.signature`

```
Step 1  Header    {"alg":"HS256","typ":"JWT"}                        → base64url
Step 2  Payload   {"sub":2,"username":"admin","role":"ADMIN",
                   "iat":1790658984,"exp":1790662584}                → base64url
Step 3  Signature HMAC-SHA256( JWT_SECRET, header + "." + payload )   → base64url
Step 4  Join      header.payload.signature
```

| Claim | Meaning | Set by |
|---|---|---|
| `sub` | Subject = user id | our `login()` |
| `username`, `role` | Extra data for the app | our `login()` |
| `iat` | Issued at (Unix seconds) | library, automatically |
| `exp` | Expires at = `iat` + 3600 | library, from `expiresIn: '1h'` |

#### 4.4 Encoded ≠ encrypted

**base64url** is just a text format — anyone can decode it:
```bash
echo "<middle part>" | node -e "process.stdin.on('data',d=>console.log(Buffer.from(d.toString().trim(),'base64url').toString()))"
```
→ ✅ put ids, usernames, roles in the payload
→ ❌ never put passwords, hashes, or secrets in it

#### 4.5 Why it can't be forged

Changing **anything** produces a completely different signature:

| Change | Signature |
|---|---|
| none (real token) | `E2zqfrQ1p7K8Q5olNd54...` ✅ |
| `role` ADMIN → USER | `AQrdwtqezf7guKzgCaui...` ❌ |
| wrong secret | `gqab2HX4MITxs6DMkWu7...` ❌ |

Making a valid signature for edited data requires `JWT_SECRET`, which only the server has.

#### 4.6 JWT vs sessions

| | Session (e.g. Frappe `sid`) | JWT (this app) |
|---|---|---|
| Where login state lives | Server (session store) | Inside the token |
| Check per request | Look up session | Verify signature (no DB) |
| Scaling to many servers | Needs shared session store | Works out of the box |
| Instant logout / revoke | Easy (delete session) | Hard (valid until `exp`) |

---

## 5. A3 — Global JWT guard

### What
- Every route requires a valid token, **except** routes marked `@Public()`
  (`/auth/register`, `/auth/login`).
- `GET /auth/me` returns the logged-in user.

### Why
- A token is useless unless something checks it.
- **Secure by default:** a global guard protects every route, including ones added in the future.
  Forgetting to protect a route can't leave it open.

### How

#### 5.1 What a guard is

A class with one method, `canActivate()`, that runs **before** the route. It returns `true` (let in)
or throws (block). Guards run **before** pipes.

```
Request → [ Guard ] → [ Pipes ] → Controller → Service
            401/403      400                     404
```

#### 5.2 Token shape — `src/auth/jwt-payload.ts`

```ts
import type { Role } from '../generated/prisma/enums.js';

export interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
}
```
- Describes what `login()` puts in the token → autocomplete + type safety everywhere.
- `Role` comes from Prisma's generated types → always in sync with the schema.
- An `interface` (not a class) is enough: the signature already proves the data is ours.

#### 5.3 `@Public()` — `src/auth/decorators/public.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```
`SetMetadata` attaches an invisible label (`isPublic = true`) to a route. The guard reads it.

#### 5.4 The guard — `src/auth/guards/jwt-auth.guard.ts`

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Public route? → allow
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 2. Get the token from the header
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    // 3. Verify signature + expiry, then remember the user
    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

| Piece | Purpose |
|---|---|
| `implements CanActivate` | Makes the class a guard |
| `Reflector.getAllAndOverride(...)` | Reads `@Public()` from the method **or** the whole controller |
| `split(' ')` | `"Bearer eyJ..."` → `["Bearer", "eyJ..."]` |
| `?.` / `?? []` | No header at all → treat as "no token" instead of crashing |
| `verifyAsync` | Recomputes the signature with `JWT_SECRET` and checks `exp` |
| `request.user = ...` | Stores the caller for later use in controllers |

**What `verifyAsync` does:**
```
split token → header . payload . signature
recompute HMAC-SHA256(JWT_SECRET, header + "." + payload)
  ≠ signature → 401 (edited or not ours)
  = signature → exp in the future?
                  no  → 401 (expired)
                  yes → return payload ✅
```

#### 5.5 `@CurrentUser()` — `src/auth/decorators/current-user.decorator.ts`

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
```
A custom parameter decorator — like `@Body()` or `@Param()`, but it returns the user the guard saved.

#### 5.6 Turning it on globally — `src/auth/auth.module.ts`

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
```
- `APP_GUARD` = apply this guard to **every route in the app**.
- Registered in `AuthModule` because that's where `JwtService` is available.

#### 5.7 Marking routes — `src/auth/auth.controller.ts`

```ts
import type { JwtPayload } from './jwt-payload.js';   // "import type" is required (TS1272)

@Public()
@Post('register')
register(@Body() dto: AuthDto) { ... }

@Public()
@Post('login')
@HttpCode(200)
login(@Body() dto: AuthDto) { ... }

@Get('me')                                           // protected
me(@CurrentUser() user: JwtPayload) {
  return user;
}
```
Login and register **must** be public — you can't have a token before you log in.

---

## 6. Request lifecycle

```
Incoming request
   │
   ▼
JwtAuthGuard ────── @Public()? ── yes ──────────────────────┐
   │ no                                                      │
   ├─ no "Bearer" token ──────────────► 401 Missing token    │
   ├─ bad signature / expired ────────► 401 Invalid token    │
   │ ✅ request.user = {sub, username, role}                 │
   ▼                                                         │
ValidationPipe / ParseIntPipe ◄──────────────────────────────┘
   ├─ invalid body / params ──────────► 400
   ▼
Controller  (@CurrentUser() → request.user)
   ▼
Service → Prisma → SQLite
   ├─ not found ──────────────────────► 404
   ▼
Response 200 / 201 / 204
```

Example: `DELETE /todos/999` **without a token** returns **401**, not 404 — the guard stops it before
the service ever looks in the database. Unauthenticated users learn nothing about your data.

---

## 7. Files overview

```
src/
├── main.ts                              # import 'dotenv/config' (first line), ValidationPipe, CORS
├── app.module.ts                        # imports PrismaModule, TodosModule, UsersModule, AuthModule
├── users/
│   ├── users.module.ts                  # exports UsersService
│   └── users.service.ts                 # findByUsername, create
└── auth/
    ├── auth.module.ts                   # JwtModule + APP_GUARD
    ├── auth.controller.ts               # register, login, me
    ├── auth.service.ts                  # bcrypt + JWT signing
    ├── jwt-payload.ts                   # token shape
    ├── dto/auth.dto.ts                  # username + password validation
    ├── decorators/
    │   ├── public.decorator.ts          # @Public()
    │   └── current-user.decorator.ts    # @CurrentUser()
    └── guards/
        └── jwt-auth.guard.ts            # checks every request
```

---

## 8. Testing

### Postman setup
1. `POST localhost:4000/auth/login` → Body → raw → **JSON** → copy `access_token`
2. Other requests → **Authorization** tab → Type **Bearer Token** → paste

### Test cases

| # | Request | Token | Expected |
|---|---|---|---|
| 1 | `POST /auth/register` `{"username":"bob","password":"bob123"}` | – | 201 |
| 2 | Same again | – | 409 Username already taken |
| 3 | `POST /auth/register` `{"username":"x","password":"123"}` | – | 400 |
| 4 | `POST /auth/login` correct | – | 200 `{ access_token }` |
| 5 | `POST /auth/login` wrong password | – | 401 |
| 6 | `POST /auth/login` unknown user | – | 401 (same message) |
| 7 | `GET /todos` | none | 401 Missing token |
| 8 | `GET /todos` | `abc.def.ghi` | 401 Invalid or expired token |
| 9 | `GET /todos` | token without `Bearer ` | 401 |
| 10 | `GET /auth/me` | token with 1 char changed in payload | 401 |
| 11 | `GET /todos` | valid | 200 |
| 12 | `GET /auth/me` | valid | 200 `{ sub, username, role, iat, exp }` |

### Decode a token (terminal)
```bash
echo "<middle part>" | node -e "process.stdin.on('data',d=>console.log(Buffer.from(d.toString().trim(),'base64url').toString()))"
```

---

## 9. Security decisions

| Decision | Reason |
|---|---|
| bcrypt, cost 10 | Slow + salted → resists brute force and rainbow tables |
| Same error for wrong user/password | Prevents user enumeration |
| `passwordHash` never returned | Don't leak even hashed credentials |
| Role defaults to `USER`, not settable on register | Prevents self-promotion to admin |
| Random 32-byte `JWT_SECRET` in `.env` | Can't be guessed; not in git |
| 1 hour expiry | Limits damage if a token is stolen |
| Global guard + `@Public()` opt-out | Secure by default |
| Guard before pipes | Unauthenticated requests learn nothing (no 400/404 hints) |

### Known limitations (planned improvements)

| Limitation | Improvement |
|---|---|
| Role change applies only after re-login (≤ 1h) | Load user from DB in the guard, or shorter expiry |
| No server-side logout / revoke | Token blacklist or per-user token version |
| User must log in again after 1h | Refresh tokens |
| Token in `localStorage` (A6) is readable by JS | httpOnly cookies |
| Unlimited login attempts | Rate limiting (`@nestjs/throttler`) |
| `JWT_SECRET` not validated at startup | `@nestjs/config` validation |

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Nest can't resolve dependencies of the AuthService (?)` | `UsersService` not exported, or `UsersModule` not imported | Add `exports` / `imports` (§3.3) |
| `Nest can't resolve dependencies of the JwtAuthGuard` | Guard registered outside `AuthModule` | Register `APP_GUARD` in `AuthModule` |
| `secretOrPrivateKey must have a value` | `JWT_SECRET` missing / not loaded | Check `.env`; `import 'dotenv/config'` first in `main.ts` |
| Both env vars broken | `.env` had no newline → `JWT_SECRET` glued onto `DATABASE_URL` line | One variable per line |
| `TS1272: A type referenced in a decorated signature...` | `JwtPayload` imported without `type` | `import type { JwtPayload }` |
| Can't log in at all (401 Missing token) | `@Public()` missing on login | Add `@Public()` above `@Post('login')` |
| Everything returns 401 | Postman sending token as plain header without `Bearer ` | Use Authorization tab → Bearer Token |
| Frontend list empty after A3 | Frontend doesn't send a token yet | Expected until A6 |
| Forgot a password | Hashes can't be reversed | Delete user in Studio and register again |

---

## 11. Common questions

**Why JWT instead of sessions?**
Stateless — no session store, no DB lookup per request, easy to scale. Sessions are also valid; it's a trade-off (see §4.6).

**Is the token encrypted?**
No, it's *signed*. Anyone can read the payload; nobody can change it without the secret.

**Can a user make themselves admin by editing the token?**
No. Any change breaks the signature → 401.

**What happens when the token expires?**
The guard returns 401 and the user must log in again (refresh tokens would fix this later).

**401 vs 403?**
401 = we don't know who you are. 403 = we know who you are, but you're not allowed.

**Why bcrypt and not SHA-256?**
SHA-256 is fast — great for files, bad for passwords. bcrypt is slow and salted on purpose.

---

## 12. What's next

| Step | Adds | Concept |
|---|---|---|
| **A4** | `Todo.userId` relation; every query filtered by the logged-in user | Authorization by **ownership** (404 for others' todos) |
| **A5** | `@Roles('ADMIN')` + `RolesGuard` + `GET /todos/all` | Authorization by **role** (403) |
| **A6** | Next.js login page, token storage, `Authorization` header, logout | Client-side auth |
