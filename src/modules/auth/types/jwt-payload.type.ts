export interface JwtPayload {
  sub: string;
  // Present only on refresh tokens.
  jti?: string;
  type?: 'refresh';
  iat?: number;
  exp?: number;
}
