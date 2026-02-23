import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';
import { FraudRule } from './entities/fraud-rule.entity';
import { License } from './entities/license.entity';
import { Log } from './entities/log.entity';
import { Merchant } from './entities/merchant.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { Customer } from './entities/customer.entity';
import { BankRecipientEmail } from './entities/bank-recipient-email.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const isProduction =
          configService.get('NODE_ENV') === 'production' ||
          configService.get('RENDER') === 'true';
        const databaseUrl = configService.get('DATABASE_URL');

        if (isProduction && databaseUrl) {
          // PostgreSQL for production
          return {
            type: 'postgres',
            url: databaseUrl,
            ssl: {
              rejectUnauthorized: false,
            },
            entities: [Order, User, FraudRule, License, Log, Merchant, FeePayment, Customer, BankRecipientEmail],
            synchronize: true, // Auto-sync in production
            logging: false,
          };
        } else {
          // SQLite for development
          return {
            type: 'sqlite',
            database: configService.get('DATABASE_PATH') || './orders.db',
            entities: [Order, User, FraudRule, License, Log, Merchant, FeePayment, Customer, BankRecipientEmail],
            synchronize: true, // Auto-sync in development
            logging: false,
          };
        }
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Order]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}

