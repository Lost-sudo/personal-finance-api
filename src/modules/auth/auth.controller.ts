import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { registerSchema, type RegisterDto } from './dto/register.dto.js';
import { loginSchema, type LoginDto } from './dto/login.dto.js';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/api-response.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @ApiOperation({
        summary: 'Register a new user',
        description: 'Creates a new personal finance account and returns an access token.',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['email', 'password', 'firstName', 'lastName'],
            properties: {
                email: {
                    type: 'string',
                    format: 'email',
                    example: 'johndoe@example.com',
                    description: 'Email',
                },
                password: {
                    type: 'string',
                    format: 'password',
                    example: 'password',
                    description: 'Password',
                },
                firstName: {
                    type: 'string',
                    example: 'John',
                    description: 'First Name',
                },
                lastName: {
                    type: 'string',
                    example: 'Doe',
                    description: 'Last Name',
                }
            }

        }
    })
    @ApiResponse({
        status: 201,
        description: 'User registered successfully.'
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid registration data.',
    })
    @ApiResponse({
        status: 409,
        description: 'Unable to create account with the provided email.',
    })
    @Post('register')
    async register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
        return successResponse(await this.authService.register(dto));
    }

    @ApiOperation({
        summary: 'Authenticate a user',
        description: 'Authenticates the user and returns an access token.',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
                email: {
                    type: 'string',
                    format: 'email',
                    example: 'johndoe@example.com',
                    description: 'Email',
                },
                password: {
                    type: 'string',
                    format: 'password',
                    example: 'password',
                    description: 'Password',
                },
            }

        }
    })
    @ApiResponse({
        status: 200,
        description: 'User authenticated successfully.',
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid authentication data.',
    })
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
        return successResponse(await this.authService.login(dto));
    }
}
