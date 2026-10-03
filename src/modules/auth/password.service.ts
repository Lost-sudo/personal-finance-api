import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

// Argon2id costs: 64 MiB memory, 3 iterations, parallelism 4, 32-byte hash.
const MEMORY_SIZE_KIB = 65536;
const ITERATIONS = 3;
const PARALLELISM = 4;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

@Injectable()
export class PasswordService {
    async hash(password: string): Promise<string> {
        // WASM Argon2id (no native binary); returns a PHC-encoded hash.
        return argon2id({
            password,
            salt: randomBytes(SALT_LENGTH),
            parallelism: PARALLELISM,
            iterations: ITERATIONS,
            memorySize: MEMORY_SIZE_KIB,
            hashLength: HASH_LENGTH,
            outputType: 'encoded',
        });
    }

    async verify(passwordHash: string, password: string): Promise<boolean> {
        try {
            return await argon2Verify({ password, hash: passwordHash });
        } catch {
            return false;
        }
    }
}
