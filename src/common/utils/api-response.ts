import {
  ApiResponse,
  PaginatedMeta,
  PaginatedResponse,
} from '../types/api-response.js';

export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
  };
}

export function paginatedResponse<T>(
  data: T[],
  meta: PaginatedMeta,
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    meta,
  };
}
