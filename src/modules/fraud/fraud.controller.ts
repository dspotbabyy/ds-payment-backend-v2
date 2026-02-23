import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { FraudService } from './fraud.service';
import { CreateFraudRuleDto } from './dto/create-fraud-rule.dto';
import { UpdateFraudRuleDto } from './dto/update-fraud-rule.dto';
import { FilterFraudRulesDto } from './dto/filter-fraud-rules.dto';

@Controller('fraud')
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createFraudRuleDto: CreateFraudRuleDto) {
    const fraudRule = await this.fraudService.create(createFraudRuleDto);
    return {
      success: true,
      message: 'Fraud rule created successfully',
      data: fraudRule,
    };
  }

  @Get()
  async findAll(@Query() filterDto: FilterFraudRulesDto) {
    const fraudRules = await this.fraudService.findAll(filterDto);
    return {
      success: true,
      message: 'Fraud rules retrieved successfully',
      data: fraudRules,
      count: fraudRules.length,
    };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const fraudRule = await this.fraudService.findOne(id);
    return {
      success: true,
      message: 'Fraud rule retrieved successfully',
      data: fraudRule,
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFraudRuleDto: UpdateFraudRuleDto,
  ) {
    const fraudRule = await this.fraudService.update(id, updateFraudRuleDto);
    return {
      success: true,
      message: 'Fraud rule updated successfully',
      data: fraudRule,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.fraudService.remove(id);
    return {
      success: true,
      message: 'Fraud rule deleted successfully',
    };
  }
}

