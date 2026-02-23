import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum LogModule {
  ORDERS = 'orders',
  LICENSES = 'licenses',
  FRAUD = 'fraud',
  EMAIL = 'email',
  AUTH = 'auth',
  MERCHANTS = 'merchants',
}

@Entity('logs')
@Index(['module'])
@Index(['created_at'])
@Index(['module', 'created_at'])
export class Log {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 50,
  })
  module: LogModule;

  @Column({ type: 'text' })
  action: string; // e.g., 'create', 'update', 'delete', 'login', 'register', etc.

  @Column({ type: 'integer', nullable: true })
  user_id: number; // User who performed the action (if applicable)

  @Column({ type: 'integer', nullable: true })
  entity_id: number; // ID of the related entity (order_id, license_id, etc.)

  @Column({ type: 'text', nullable: true })
  details: string; // JSON string or text description

  @Column({ type: 'text', nullable: true })
  ip_address: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}

