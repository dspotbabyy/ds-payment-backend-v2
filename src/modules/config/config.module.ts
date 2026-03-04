import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
    imports: [LicensesModule],
    controllers: [ConfigController],
})
  export class PluginConfigModule {}
