import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../../database/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private logsService: LogsService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      name: name || null,
    });

    const savedUser = await this.userRepository.save(user);

    // Generate JWT token
    const payload = { sub: savedUser.id, email: savedUser.email };
    const access_token = this.jwtService.sign(payload);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = savedUser;

    // Log user registration
    this.logsService
      .createLog({
        module: LogModule.AUTH,
        action: 'register',
        user_id: savedUser.id,
        entity_id: savedUser.id,
        details: {
          user_id: savedUser.id,
          email: savedUser.email,
        },
      })
      .catch((err) => console.error('Error logging user registration:', err));

    return {
      success: true,
      message: 'User registered successfully',
      data: {
        user: userWithoutPassword,
        access_token,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate JWT token
    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // Log user login
    this.logsService
      .createLog({
        module: LogModule.AUTH,
        action: 'login',
        user_id: user.id,
        entity_id: user.id,
        details: {
          user_id: user.id,
          email: user.email,
        },
      })
      .catch((err) => console.error('Error logging user login:', err));

    return {
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        access_token,
      },
    };
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  async updateProfile(userId: number, updateProfileDto: UpdateProfileDto) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { email, name } = updateProfileDto;

    // If email is being updated, check if it's already taken by another user
    if (email && email !== user.email) {
      const existingUser = await this.findByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException('Email is already taken by another user');
      }
      user.email = email;
    }

    if (name !== undefined) {
      user.name = name;
    }

    const updatedUser = await this.userRepository.save(user);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = updatedUser;

    // Log profile update
    this.logsService
      .createLog({
        module: LogModule.AUTH,
        action: 'update_profile',
        user_id: userId,
        entity_id: userId,
        details: {
          user_id: userId,
          updated_fields: Object.keys(updateProfileDto),
        },
      })
      .catch((err) => console.error('Error logging profile update:', err));

    return {
      success: true,
      message: 'Profile updated successfully',
      data: userWithoutPassword,
    };
  }

  async updatePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    user.password = hashedPassword;
    await this.userRepository.save(user);

    // Log password update
    this.logsService
      .createLog({
        module: LogModule.AUTH,
        action: 'update_password',
        user_id: userId,
        entity_id: userId,
        details: {
          user_id: userId,
        },
      })
      .catch((err) => console.error('Error logging password update:', err));

    return {
      success: true,
      message: 'Password updated successfully',
    };
  }
}

