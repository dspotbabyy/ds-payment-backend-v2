import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { UploadsController } from './uploads.controller';
import { OrdersService } from './orders.service';
import { FileUploadService } from './file-upload.service';
import { Order } from '../../database/entities/order.entity';
import { EmailModule } from '../email/email.module';
import { FraudModule } from '../fraud/fraud.module';
import { LogsModule } from '../logs/logs.module';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    EmailModule,
    FraudModule,
    LogsModule,
    LicensesModule,
  ],
  controllers: [OrdersController, UploadsController],
  providers: [OrdersService, FileUploadService],
  exports: [OrdersService, FileUploadService],
})
export class OrdersModule {}

