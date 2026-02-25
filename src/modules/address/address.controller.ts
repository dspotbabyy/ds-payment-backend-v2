import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';

@Controller('api/address')
export class AddressController {
  private readonly GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';
  private readonly GEOAPIFY_BASE_URL = 'https://api.geoapify.com/v1/geocode';

  @Get('autocomplete')
  async autocomplete(
    @Query('text') text: string,
    @Query('lang') lang: string = 'en',
  ) {
    if (!text || text.length < 2) {
      return { results: [] };
    }

    if (!this.GEOAPIFY_API_KEY) {
      console.error('GEOAPIFY_API_KEY not configured');
      throw new HttpException(
        'Address service not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const params = new URLSearchParams({
        text: text,
        apiKey: this.GEOAPIFY_API_KEY,
        lang: lang,
        limit: '8',
        type: 'street,housenumber',
        filter: 'countrycode:ca',
        format: 'json',
      });

      const response = await fetch(
        `${this.GEOAPIFY_BASE_URL}/autocomplete?${params.toString()}`,
      );

      if (!response.ok) {
        console.error('Geoapify API error:', response.status, response.statusText);
        throw new HttpException(
          'Address service error',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = await response.json();

      const results = (data.results || []).map((result: any) => ({
        formatted: result.formatted,
        street: result.street,
        housenumber: result.housenumber,
        city: result.city,
        state: result.state,
        state_code: result.state_code,
        postcode: result.postcode,
        country: result.country,
        country_code: result.country_code,
        lat: result.lat,
        lon: result.lon,
      }));

      return { results };
    } catch (error) {
      console.error('Address autocomplete error:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Address lookup failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('validate')
  async validate(
    @Query('street') street: string,
    @Query('city') city: string,
    @Query('state') state: string,
    @Query('postcode') postcode: string,
  ) {
    if (!street || !city) {
      throw new HttpException(
        'Street and city are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.GEOAPIFY_API_KEY) {
      console.error('GEOAPIFY_API_KEY not configured');
      throw new HttpException(
        'Address service not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const addressParts = [street, city, state, postcode, 'Canada'].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      const params = new URLSearchParams({
        text: fullAddress,
        apiKey: this.GEOAPIFY_API_KEY,
        lang: 'en',
        limit: '1',
        filter: 'countrycode:ca',
        format: 'json',
      });

      const response = await fetch(
        `${this.GEOAPIFY_BASE_URL}/search?${params.toString()}`,
      );

      if (!response.ok) {
        console.error('Geoapify API error:', response.status);
        throw new HttpException(
          'Address validation error',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        return {
          valid: true,
          confidence: result.rank?.confidence || 0,
          formatted: result.formatted,
          components: {
            street: result.street,
            housenumber: result.housenumber,
            city: result.city,
            state: result.state,
            state_code: result.state_code,
            postcode: result.postcode,
          },
          coordinates: {
            lat: result.lat,
            lon: result.lon,
          },
        };
      }

      return {
        valid: false,
        confidence: 0,
        message: 'Address could not be validated',
      };
    } catch (error) {
      console.error('Address validation error:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Address validation failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('health')
  async healthCheck() {
    const hasApiKey = !!this.GEOAPIFY_API_KEY;
    return {
      service: 'address',
      status: hasApiKey ? 'configured' : 'not_configured',
      provider: 'geoapify',
    };
  }
}
