import { DocumentBuilder } from "@nestjs/swagger";

export function createSwaggerConfig(): DocumentBuilder {
    return new DocumentBuilder()
        .setTitle('Personal Finance & Expense Management API')
        .setDescription(
            'REST API for managing personal finance, expenses, categories, accounts, budgets, recurring financial records, and financial reports.',
        )
        .setVersion('1.0')
        .addTag('Categories', 'Income and expense category management')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Enter the JWT access token without the Bearer prefix.'
            },
            'access-token',
        )
}