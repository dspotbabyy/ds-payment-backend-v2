import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Controller('address')
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
      throw new HttpException('Address service not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      const url = `${this.GEOAPIFY_BASE_URL}/autocomplete?text=${encodeURIComponent(text)}&apiKey=${this.GEOAPIFY_API_KEY}&lang=${lang}&limit=8&type=street,housenumber&filter=countrycode:ca&format=json`;
      
      console.log('Calling Geoapify URL:', url.replace(this.GEOAPIFY_API_KEY, 'HIDDEN'));
      
      const response = await axios.get(url, { timeout: 10000 });

      console.log('Geoapify response status:', response.status);

      const data = response.data;
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
    } catch (error: any) {
      console.error('GEOAPIFY ERROR DETAILS:', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
      });

      throw new HttpException(
        `Address lookup failed: ${error?.message || 'unknown'}`,
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
      throw new HttpException('Street and city are required', HttpStatus.BAD_REQUEST);
    }

    if (!this.GEOAPIFY_API_KEY) {
      throw new HttpException('Address service not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      const addressParts = [street, city, state, postcode, 'Canada'].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      const url = `${this.GEOAPIFY_BASE_URL}/search?text=${encodeURIComponent(fullAddress)}&apiKey=${this.GEOAPIFY_API_KEY}&lang=en&limit=1&filter=countrycode:ca&format=json`;

      const response = await axios.get(url, { timeout: 10000 });
      const data = response.data;

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
          coordinates: { lat: result.lat, lon: result.lon },
        };
      }

      return { valid: false, confidence: 0, message: 'Address could not be validated' };
    } catch (error: any) {
      console.error('VALIDATE ERROR:', error?.message);
      throw new HttpException(
        `Address validation failed: ${error?.message || 'unknown'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('health')
  async healthCheck() {
    const hasApiKey = !!this.GEOAPIFY_API_KEY;
    
    // Actually test the Geoapify connection
    if (hasApiKey) {
      try {
        const url = `${this.GEOAPIFY_BASE_URL}/autocomplete?text=test&apiKey=${this.GEOAPIFY_API_KEY}&limit=1&format=json`;
        const response = await axios.get(url, { timeout: 5000 });
        return {
          service: 'address',
          status: 'working',
          provider: 'geoapify',
          test: `Geoapify returned ${response.status}`,
        };
      } catch (error: any) {
        return {
          service: 'address',
          status: 'error',
          provider: 'geoapify',
          error: error?.message,
          responseStatus: error?.response?.status,
          responseData: error?.response?.data,
        };
      }
    }

    return { service: 'address', status: 'not_configured', provider: 'geoapify' };
  }
}
