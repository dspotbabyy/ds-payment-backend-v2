import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { EmailService } from '../email/email.service';

@Injectable()
export class MonitorOrdersService implements OnModuleInit {
  private readonly logger = new Logger(MonitorOrdersService.name);
  // In-memory cache to track last seen status for orders
  // Format: { orderId: lastSeenStatus }
  private orderStatusCache = new Map<number, string>();

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private emailService: EmailService,
  ) {}

  onModuleInit() {
    // Run immediately on startup (after 5 seconds to let server initialize)
    setTimeout(() => {
      this.logger.log('🚀 Initial order monitoring check (5s delay)...');
      this.monitorOrders();
    }, 5000);

    this.logger.log(
      '✅ Order monitoring scheduler initialized - monitoring last 5 non-completed orders, runs every 15 seconds',
    );
  }

  /**
   * Monitor last 5 non-completed orders for status changes
   * Send emails when status changes
   * Completed orders are automatically excluded from monitoring
   */
  @Cron('*/15 * * * * *') // Every 15 seconds
  async monitorOrders() {
    try {
      this.logger.log(
        `🔍 Starting order monitoring job at ${new Date().toISOString()}`,
      );

      // Get last 5 non-completed orders
      // Completed orders are automatically excluded, so we always monitor the most recent 5 non-completed orders
      const recentOrders = await this.orderRepository.find({
        where: {
          status: Not(In(['completed', 'cancelled'])),
        },
        order: { id: 'DESC' },
        take: 5,
      });

      this.logger.log(
        `📊 Found ${recentOrders.length} non-completed orders to monitor (monitoring last 5 non-completed orders)`,
      );
      this.logger.log(
        `📦 Current cache size: ${this.orderStatusCache.size} orders`,
      );
      this.logger.log(
        `📦 Cached order IDs: ${Array.from(this.orderStatusCache.keys())}`,
      );

      // Process each order (even if recentOrders is empty, we still need to check cached orders that disappeared)
      if (recentOrders.length === 0 && this.orderStatusCache.size === 0) {
        this.logger.log(
          '✅ No orders to monitor and no cached orders to check',
        );
        return;
      }

      if (recentOrders.length === 0 && this.orderStatusCache.size > 0) {
        this.logger.log(
          `⚠️ No recent orders found, but ${this.orderStatusCache.size} cached orders exist - checking for completed orders...`,
        );
      }

      for (const order of recentOrders) {
        try {
          const orderId = order.id;
          // Normalize status: lowercase and trim, default to 'pending'
          const rawStatus = order.status || 'pending';
          const currentStatus = String(rawStatus).toLowerCase().trim();
          const lastSeenStatus = this.orderStatusCache.get(orderId);

          // Normalize cached status if it exists
          const normalizedLastSeenStatus = lastSeenStatus
            ? String(lastSeenStatus).toLowerCase().trim()
            : null;

          this.logger.log(`🔍 Checking order ${orderId}:`, {
            rawStatus: rawStatus,
            currentStatus: currentStatus,
            lastSeenStatus: normalizedLastSeenStatus || 'not seen before',
            statusChanged: normalizedLastSeenStatus
              ? normalizedLastSeenStatus !== currentStatus
              : false,
            customerEmail: order.customer_email,
          });

          // If status changed, send emails
          if (
            normalizedLastSeenStatus &&
            normalizedLastSeenStatus !== currentStatus
          ) {
            this.logger.log(
              `📧 Status changed for order ${orderId}: ${normalizedLastSeenStatus} → ${currentStatus}`,
            );

            // Get merchant email directly from orders table (stored when order was created)
            const merchantEmail = order.merchant_email || null;

            if (!merchantEmail) {
              this.logger.warn(
                `⚠️ Skipping email for order ${orderId} - merchant email not found`,
              );
              // Update cache anyway
              this.orderStatusCache.set(orderId, currentStatus);
              continue;
            }

            this.logger.log(
              `✅ Merchant email found from orders table: ${merchantEmail} for order ${orderId}`,
            );

            // Send email notifications
            this.logger.log(`📧 Sending email notifications for order ${orderId}:`, {
              customerEmail: order.customer_email,
              merchantEmail: merchantEmail,
              oldStatus: normalizedLastSeenStatus,
              newStatus: currentStatus,
            });

            try {
              await this.emailService.sendOrderStatusEmails(
                order,
                normalizedLastSeenStatus,
                merchantEmail,
              );
              this.logger.log(`✅ Emails sent successfully for order ${orderId}`);
            } catch (emailError) {
              this.logger.error(
                `❌ Error sending emails for order ${orderId}:`,
                emailError,
              );
            }
          } else if (!lastSeenStatus) {
            // First time seeing this order - just cache the status, don't send email
            this.logger.log(
              `📝 First time seeing order ${orderId} - caching status: ${currentStatus}`,
            );
          } else {
            // Status hasn't changed
            this.logger.log(
              `✅ Order ${orderId} status unchanged: ${currentStatus}`,
            );
          }

          // Update cache with current status (AFTER checking for changes)
          const previousCacheStatus = this.orderStatusCache.get(orderId);
          this.orderStatusCache.set(orderId, currentStatus);
          this.logger.log(
            `💾 Updated cache for order ${orderId}: ${previousCacheStatus || 'null'} → ${currentStatus}`,
          );
        } catch (error) {
          this.logger.error(`❌ Error processing order ${order.id}:`, error);
          // Continue with next order
        }
      }

      // Check for orders that were being monitored but are now completed
      // These orders disappeared from the query results because they're now completed
      // FLOW:
      // 1. Order was in cache with status "pending" (one of last 5 non-completed)
      // 2. Order status changed to "completed" (via API or other means)
      // 3. Next cron run: Order is no longer in query results (excluded by WHERE status NOT IN ('completed', 'cancelled'))
      // 4. We detect it disappeared from results, query database for current status
      // 5. If status is "completed" and was previously non-completed → send email
      const currentOrderIds = new Set(recentOrders.map((order) => order.id));
      const cachedOrdersToCheck = [];

      for (const [cachedOrderId, cachedStatus] of this.orderStatusCache.entries()) {
        if (!currentOrderIds.has(cachedOrderId)) {
          // This order is no longer in the monitoring set (might be completed)
          // Store it to check if it transitioned to "completed"
          cachedOrdersToCheck.push({
            id: cachedOrderId,
            lastSeenStatus: cachedStatus,
          });
        }
      }

      // Check cached orders that disappeared from the query results
      if (cachedOrdersToCheck.length > 0) {
        this.logger.log(
          `🔍 Checking ${cachedOrdersToCheck.length} cached orders that disappeared from query results...`,
        );

        for (const cachedOrder of cachedOrdersToCheck) {
          try {
            // Get current order status from database
            const currentOrder = await this.orderRepository.findOne({
              where: { id: cachedOrder.id },
            });

            if (currentOrder) {
              const normalizedCachedStatus = cachedOrder.lastSeenStatus
                ? String(cachedOrder.lastSeenStatus).toLowerCase().trim()
                : null;
              const currentStatus = currentOrder.status
                ? String(currentOrder.status).toLowerCase().trim()
                : null;

              // If order transitioned to "completed", send email
              if (
                normalizedCachedStatus &&
                normalizedCachedStatus !== 'completed' &&
                normalizedCachedStatus !== 'cancelled' &&
                currentStatus === 'completed'
              ) {
                this.logger.log(
                  `📧 Order ${cachedOrder.id} transitioned to completed: ${normalizedCachedStatus} → ${currentStatus}`,
                );

                // Get merchant email directly from orders table (stored when order was created)
                const merchantEmail = currentOrder.merchant_email || null;

                if (!merchantEmail) {
                  this.logger.warn(
                    `⚠️ Skipping completed email for order ${cachedOrder.id} - merchant email not found`,
                  );
                } else {
                  this.logger.log(
                    `✅ Merchant email found from orders table: ${merchantEmail} for order ${cachedOrder.id}`,
                  );

                  // Send "completed" email notifications
                  this.logger.log(
                    `📧 Sending completed email notifications for order ${cachedOrder.id}:`,
                    {
                      customerEmail: currentOrder.customer_email,
                      merchantEmail: merchantEmail,
                      oldStatus: normalizedCachedStatus,
                      newStatus: currentStatus,
                    },
                  );

                  try {
                    await this.emailService.sendOrderStatusEmails(
                      currentOrder,
                      normalizedCachedStatus,
                      merchantEmail,
                    );
                    this.logger.log(
                      `✅ Completed emails sent successfully for order ${cachedOrder.id}`,
                    );
                  } catch (emailError) {
                    this.logger.error(
                      `❌ Error sending completed emails for order ${cachedOrder.id}:`,
                      emailError,
                    );
                    this.logger.error(
                      `❌ Email error details:`,
                      emailError.message,
                      emailError.stack,
                    );
                  }
                }
              } else {
                // Order status is not "completed" - log why we're not sending email
                this.logger.log(`ℹ️ Order ${cachedOrder.id} status check:`, {
                  cachedStatus: normalizedCachedStatus,
                  currentStatus: currentStatus,
                  willSendEmail: false,
                  reason:
                    normalizedCachedStatus === 'completed' ||
                    normalizedCachedStatus === 'cancelled'
                      ? 'Order was already completed/cancelled in cache'
                      : currentStatus !== 'completed'
                        ? `Order is not completed (current status: ${currentStatus})`
                        : 'No cached status to compare',
                });
              }

              // Remove from cache only if order is completed or cancelled
              // (Orders that dropped from top 5 but are still non-completed will be removed)
              // This is fine because we only monitor the last 5 orders
              if (currentStatus === 'completed' || currentStatus === 'cancelled') {
                this.orderStatusCache.delete(cachedOrder.id);
                this.logger.log(
                  `🗑️ Removed order ${cachedOrder.id} from cache (status: ${currentStatus})`,
                );
              } else {
                // Order is still non-completed but dropped from top 5 - remove from cache
                // (We only monitor the last 5 orders, so older orders don't need monitoring)
                this.orderStatusCache.delete(cachedOrder.id);
                this.logger.log(
                  `🗑️ Removed order ${cachedOrder.id} from cache (dropped from top 5, status: ${currentStatus})`,
                );
              }
            } else {
              // Order not found in database (might have been deleted)
              this.orderStatusCache.delete(cachedOrder.id);
              this.logger.log(
                `🗑️ Removed order ${cachedOrder.id} from cache (order not found in database)`,
              );
            }
          } catch (error) {
            this.logger.error(
              `❌ Error checking cached order ${cachedOrder.id}:`,
              error,
            );
            // Remove from cache on error to prevent infinite retries
            this.orderStatusCache.delete(cachedOrder.id);
          }
        }
      }

      this.logger.log(
        `✅ Order monitoring job completed - monitoring ${recentOrders.length} orders, cache size: ${this.orderStatusCache.size}`,
      );
    } catch (error) {
      this.logger.error('❌ Error in order monitoring job:', error);
    }
  }
}

