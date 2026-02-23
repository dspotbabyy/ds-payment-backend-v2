import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Log, LogModule } from '../../database/entities/log.entity';
import { FilterLogsDto } from './dto/filter-logs.dto';

export interface CreateLogDto {
  module: LogModule;
  action: string;
  user_id?: number;
  entity_id?: number;
  details?: any;
  ip_address?: string;
}

@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(Log)
    private logRepository: Repository<Log>,
  ) {}

  /**
   * Create a log entry
   */
  async createLog(createLogDto: CreateLogDto): Promise<Log> {
    const { module, action, user_id, entity_id, details, ip_address } =
      createLogDto;

    const log = this.logRepository.create({
      module,
      action,
      user_id: user_id || null,
      entity_id: entity_id || null,
      details: details ? JSON.stringify(details) : null,
      ip_address: ip_address || null,
    });

    return this.logRepository.save(log);
  }

  /**
   * Get all logs with optional filtering
   */
  async findAll(filterDto?: FilterLogsDto): Promise<{
    logs: Log[];
    total: number;
  }> {
    const queryBuilder = this.logRepository.createQueryBuilder('log');

    if (filterDto) {
      if (filterDto.module) {
        queryBuilder.andWhere('log.module = :module', { module: filterDto.module });
      }

      if (filterDto.user_id) {
        queryBuilder.andWhere('log.user_id = :userId', { userId: filterDto.user_id });
      }

      if (filterDto.entity_id) {
        queryBuilder.andWhere('log.entity_id = :entityId', {
          entityId: filterDto.entity_id,
        });
      }

      if (filterDto.start_date) {
        queryBuilder.andWhere('log.created_at >= :startDate', {
          startDate: filterDto.start_date,
        });
      }

      if (filterDto.end_date) {
        queryBuilder.andWhere('log.created_at <= :endDate', {
          endDate: filterDto.end_date,
        });
      }
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    if (filterDto?.limit) {
      queryBuilder.limit(filterDto.limit);
    } else {
      queryBuilder.limit(100); // Default limit
    }

    if (filterDto?.offset) {
      queryBuilder.offset(filterDto.offset);
    }

    // Order by created_at DESC (newest first)
    queryBuilder.orderBy('log.created_at', 'DESC');

    const logs = await queryBuilder.getMany();

    // Parse details JSON for each log
    const logsWithParsedDetails = logs.map((log) => ({
      ...log,
      details: log.details ? this.parseDetails(log.details) : null,
    }));

    return {
      logs: logsWithParsedDetails as Log[],
      total,
    };
  }

  /**
   * Get logs by module
   */
  async findByModule(module: LogModule, limit: number = 100): Promise<Log[]> {
    const logs = await this.logRepository.find({
      where: { module },
      order: { created_at: 'DESC' },
      take: limit,
    });

    return logs.map((log) => ({
      ...log,
      details: log.details ? this.parseDetails(log.details) : null,
    })) as Log[];
  }

  /**
   * Get logs by user
   */
  async findByUser(userId: number, limit: number = 100): Promise<Log[]> {
    const logs = await this.logRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: limit,
    });

    return logs.map((log) => ({
      ...log,
      details: log.details ? this.parseDetails(log.details) : null,
    })) as Log[];
  }

  /**
   * Get logs by entity
   */
  async findByEntity(
    module: LogModule,
    entityId: number,
    limit: number = 100,
  ): Promise<Log[]> {
    const logs = await this.logRepository.find({
      where: { module, entity_id: entityId },
      order: { created_at: 'DESC' },
      take: limit,
    });

    return logs.map((log) => ({
      ...log,
      details: log.details ? this.parseDetails(log.details) : null,
    })) as Log[];
  }

  /**
   * Parse details JSON string
   */
  private parseDetails(details: string): any {
    try {
      return JSON.parse(details);
    } catch {
      return details;
    }
  }

  /**
   * Get statistics by module
   */
  async getStatistics(): Promise<{
    byModule: Array<{ module: LogModule; count: number }>;
    recentActivity: number; // Count of logs in last 24 hours
  }> {
    const byModule = await this.logRepository
      .createQueryBuilder('log')
      .select('log.module', 'module')
      .addSelect('COUNT(log.id)', 'count')
      .groupBy('log.module')
      .getRawMany();

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentActivity = await this.logRepository.count({
      where: {
        created_at: Between(oneDayAgo, new Date()),
      },
    });

    return {
      byModule: byModule.map((item) => ({
        module: item.module as LogModule,
        count: parseInt(item.count, 10),
      })),
      recentActivity,
    };
  }
}

