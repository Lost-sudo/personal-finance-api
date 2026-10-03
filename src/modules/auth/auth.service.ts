import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { User } from '../../generated/prisma/client.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';

@Injectable()
export class AuthService {
    constructor(private readonly usersService: UsersService, private readonly passwordService: PasswordService, private readonly jwtService: JwtService) {}

    async register(dto: RegisterDto): Promise<AuthResponseDto> {
        // Normalize here too so the service is safe without the validation pipe.
        const email = dto.email.trim().toLowerCase();
        const existingUser = await this.usersService.findByEmail(email);

        if (existingUser) {
            throw new ConflictException('Unable to create account with the provided email.')
        }

        const passwordHash = await this.passwordService.hash(dto.password);

        const user = await this.usersService.create({
            email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
        });

        const accessToken = await this.createAccessToken(user.id);

        return {
            user: this.toSafeUser(user),
            accessToken,
        };
    }

    async login(dto: LoginDto): Promise<AuthResponseDto> {
        const user = await this.usersService.findByEmail(dto.email.trim().toLowerCase());

        if (!user) {
            throw new UnauthorizedException('Invalid email or password');
        }

        if (!user.isActive) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const passwordValid = await this.passwordService.verify(user.passwordHash, dto.password);

        if (!passwordValid) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const accessToken = await this.createAccessToken(user.id);

        return {
            user: this.toSafeUser(user),
            accessToken,
        }
    }

    private async createAccessToken(userId: string) {
        return this.jwtService.signAsync({
            sub: userId,
        });
    }

    private toSafeUser(user: User) {
        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            emailVerifiedAt: user.emailVerifiedAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        }
    }
}
