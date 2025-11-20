import axios from 'axios';
import { PinnacleMarket } from './types';

export class PinnacleApiClient {
    private readonly rapidApiKey = process.env.RAPID_API_KEY;
    private readonly baseUrl = 'https://pinnacle-odds.p.rapidapi.com';
    private readonly headers = {
        'x-rapidapi-key': this.rapidApiKey,
        'x-rapidapi-host': 'pinnacle-odds.p.rapidapi.com'
    };

    private lastTimestamp: number | null = null;

    /**
     * Helper for consistent logging with timestamp and service prefix
     */
    private log(message: string): void {
        const now = new Date();
        const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
        console.log(`${time} Pinnacle API: ${message}`);
    }

    /**
     * Fetches odds from Pinnacle API
     */
    async fetchOdds(): Promise<PinnacleMarket | null> {
        try {
            const params: any = {
                event_type: 'prematch',
                sport_id: 1, // Football
            };

            // Use last timestamp if available, otherwise use current timestamp
            if (this.lastTimestamp) {
                params.since = this.lastTimestamp;
            } else {
                params.since = Math.floor(Date.now() / 1000);
            }

            const response = await axios.get(`${this.baseUrl}/kit/v1/markets`, {
                headers: this.headers,
                params,
                timeout: 1000 // 1 second timeout
            });

            if (response.data && response.data.last !== undefined) {
                // Update last timestamp for next call
                this.lastTimestamp = response.data.last;
            }

            return response.data;
        } catch (error) {
            console.error('Pinnacle API timeout');
            return null;
        }
    }
}
