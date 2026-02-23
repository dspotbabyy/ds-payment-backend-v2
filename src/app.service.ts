import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      success: true,
      message: 'E-Transfer API - Order Management',
      version: '1.0.0',
      endpoints: {
        Orders: {
          'Create Order': 'POST /api/orders',
          'Get Orders List': 'GET /api/orders',
          'Get My Orders (Role-based)': 'GET /api/orders/my-orders?user_email=USER_EMAIL',
          'Get Filtered Orders': 'GET /api/orders/filtered?user_email=USER_EMAIL&...',
          'View Order Details': 'GET /api/orders/:id?user_email=USER_EMAIL',
          'Check Payment Status (Real-time with Auto Email)': 'GET /api/orders/:id/check-status?user_email=USER_EMAIL',
          'Update Order': 'PUT /api/orders/:id?user_email=USER_EMAIL',
          'Delete Order': 'DELETE /api/orders/:id?user_email=USER_EMAIL',
          'Summary by Accounts': 'GET /api/orders/summary/accounts?user_email=ADMIN_EMAIL',
          'Summary by Days': 'GET /api/orders/summary/days?user_email=USER_EMAIL&...',
          'Merchant Statistics': 'GET /api/orders/stats/merchant',
          'Order Statistics': 'GET /api/orders/stats',
        },
        Authentication: {
          'Register': 'POST /api/auth/register',
          'Login': 'POST /api/auth/login',
          'Get Profile': 'GET /api/auth/profile (requires JWT token)',
          'Update Profile': 'PUT /api/auth/profile (requires JWT token)',
          'Update Password': 'PUT /api/auth/password (requires JWT token)',
        },
        Fraud: {
          'Create Fraud Rule': 'POST /api/fraud',
          'Get All Fraud Rules': 'GET /api/fraud?type=TYPE&is_active=BOOLEAN',
          'Get Fraud Rule': 'GET /api/fraud/:id',
          'Update Fraud Rule': 'PATCH /api/fraud/:id',
          'Delete Fraud Rule': 'DELETE /api/fraud/:id',
        },
        Licenses: {
          'Create License': 'POST /api/licenses',
          'Get All Licenses': 'GET /api/licenses?is_active=BOOLEAN',
          'Get License': 'GET /api/licenses/:id',
          'Update License': 'PATCH /api/licenses/:id',
          'Delete License': 'DELETE /api/licenses/:id',
          'Validate License': 'POST /api/licenses/validate',
          'Regenerate License Key': 'POST /api/licenses/:id/regenerate',
        },
        Logs: {
          'Get All Logs': 'GET /api/logs?module=MODULE&user_id=ID&entity_id=ID&start_date=DATE&end_date=DATE&limit=N&offset=N',
          'Get Log Statistics': 'GET /api/logs/statistics',
        },
        Merchants: {
          'Register Merchant': 'POST /api/merchants (requires JWT token)',
          'Get All Merchants': 'GET /api/merchants?domain=DOMAIN&contact_email=EMAIL&limit=N&offset=N',
          'Get Merchant': 'GET /api/merchants/:id',
          'Update Merchant': 'PUT /api/merchants/:id (requires JWT token)',
        },
        System: {
          'Health check': 'GET /api/health',
        },
      },
    };
  }

  getHealth() {
    return {
      success: true,
      message: 'API is running normally',
      timestamp: new Date().toISOString(),
    };
  }
}

