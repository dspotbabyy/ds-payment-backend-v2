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
import { LicensesService } from './licenses.service';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { FilterLicensesDto } from './dto/filter-licenses.dto';
import { ValidateLicenseDto } from './dto/validate-license.dto';

@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createLicenseDto: CreateLicenseDto) {
    const license = await this.licensesService.create(createLicenseDto);
    return {
      success: true,
      message: 'License created successfully',
      data: license,
    };
  }

  @Get()
  async findAll(@Query() filterDto: FilterLicensesDto) {
    const licenses = await this.licensesService.findAll(filterDto);
    return {
      success: true,
      message: 'Licenses retrieved successfully',
      data: licenses,
      count: licenses.length,
    };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const license = await this.licensesService.findOne(id);
    return {
      success: true,
      message: 'License retrieved successfully',
      data: license,
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateLicenseDto: UpdateLicenseDto,
  ) {
    const license = await this.licensesService.update(id, updateLicenseDto);
    return {
      success: true,
      message: 'License updated successfully',
      data: license,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.licensesService.remove(id);
    return {
      success: true,
      message: 'License deleted successfully',
    };
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateLicense(@Body() validateLicenseDto: ValidateLicenseDto) {
    const result = await this.licensesService.validateLicense(validateLicenseDto);
    return {
      success: result.valid,
      message: result.message,
      data: result.license || null,
      valid: result.valid,
    };
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateLicenseKey(@Param('id', ParseIntPipe) id: number) {
    const license = await this.licensesService.regenerateLicenseKey(id);
    return {
      success: true,
      message: 'License key regenerated successfully',
      data: license,
    };
  }
}

