import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { OrdersModule } from './modules/orders/orders.module';
import { EmailModule } from './modules/email/email.module';
import { ImapModule } from './modules/imap/imap.module';
import { MonitorOrdersModule } from './modules/monitor-orders/monitor-orders.module';
import { AuthModule } from './modules/auth/auth.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { LogsModule } from './modules/logs/logs.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { FeesPaymentsModule } from './modules/fees-payments/fees-payments.module';
import { CustomersModule } from './modules/customers/customers.module';
import { AddressModule } from './modules/address/address.module';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
    imports: [
          // Configuration
      ConfigModule.forRoot({
              isGlobal: true,
              envFilePath: '.env',
      }),

          // Database
          DatabaseModule,

          // Scheduler for cron jobs
          ScheduleModule.forRoot(),

          // Feature modules
          OrdersModule,
          EmailModule,
          ImapModule,
          MonitorOrdersModule,
          AuthModule,
          FraudModule,
          LicensesModule,
          LogsModule,
          MerchantsModule,
          FeesPaymentsModule,
          CustomersModule,
          AddressModule,
        ],
    controllers: [AppController],
    providers: [AppService],
})
  export class AppModule {}
