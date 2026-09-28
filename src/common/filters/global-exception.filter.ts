import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();

    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const timestamp = new Date().toISOString();
    const path = request.originalUrl;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message = this.extractMessage(exceptionResponse);

      const errors = this.extractErrors(exceptionResponse);

      response.status(status).json({
        success: false,
        statusCode: status,
        message,
        ...(errors && { errors }),
        timestamp,
        path,
      });

      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.handlePrismaError(exception, request, response, timestamp, path);

      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
      path,
    });
  }

  private extractMessage(execeptionResponse: string | object): string {
    if (typeof execeptionResponse === 'string') {
      return execeptionResponse;
    }

    if (
      'message' in execeptionResponse &&
      typeof execeptionResponse.message === 'string'
    ) {
      return execeptionResponse.message;
    }

    if (
      'message' in execeptionResponse &&
      Array.isArray(execeptionResponse.message)
    ) {
      return 'Validation failed';
    }

    return 'Request failed';
  }

  private extractErrors(
    exceptionResponse: string | object,
  ): unknown[] | undefined {
    if (typeof exceptionResponse !== 'object' || exceptionResponse === null) {
      return undefined;
    }

    if (
      'errors' in exceptionResponse &&
      Array.isArray(exceptionResponse.errors)
    ) {
      return exceptionResponse.errors;
    }

    return undefined;
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    request: Request,
    response: Response,
    timestamp: string,
    path: string,
  ): void {
    if (exception.code === 'P2002') {
      response.status(HttpStatus.CONFLICT).json({
        success: false,
        statusCode: HttpStatus.CONFLICT,
        message: 'A resource with the same value already exists',
        timestamp,
        path,
      });

      return;
    }

    if (exception.code === 'P2025') {
      response.status(HttpStatus.NOT_FOUND).json({
        success: false,
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Resource not found',
        timestamp,
        path,
      });

      return;
    }

    this.logger.error(
      `Prisma error on ${request.method} ${path}`,
      exception.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
      path,
    });
  }
}
