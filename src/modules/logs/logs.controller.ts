import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { FilterLogsDto } from './dto/filter-logs.dto';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filterDto: FilterLogsDto) {
    const result = await this.logsService.findAll(filterDto);
    return {
      success: true,
      message: 'Logs retrieved successfully',
      data: result.logs,
      total: result.total,
      limit: filterDto?.limit || 100,
      offset: filterDto?.offset || 0,
    };
  }

  @Get('statistics')
  @HttpCode(HttpStatus.OK)
  async getStatistics() {
    const statistics = await this.logsService.getStatistics();
    return {
      success: true,
      message: 'Log statistics retrieved successfully',
      data: statistics,
    };
  }
}

