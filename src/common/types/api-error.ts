export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors?: unknown[];
  timestamp: string;
  path: string;
}
