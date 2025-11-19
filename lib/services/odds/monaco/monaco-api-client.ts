import axios from 'axios';
import { MonacoSession, MonacoMarket } from './types';

export class MonacoApiClient {
    private baseUrl: string;
    private appId: string;
    private apiKey: string;
    private apiRequestTimestamps: number[] = [];

    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private accessExpiresAt: Date | null = null;
    private refreshExpiresAt: Date | null = null;
    private tokenRefreshTimeout: NodeJS.Timeout | null = null;

    constructor(baseUrl: string, appId: string, apiKey: string) {
        this.baseUrl = baseUrl;
        this.appId = appId;
        this.apiKey = apiKey;
    }

    public getAccessToken(): string | null {
        return this.accessToken;
    }

    private log(message: string): void {
        const now = new Date();
        const time = now.toTimeString().slice(0, 8);
        console.log(`${time} MonacoAPI: ${message}`);
    }

    private async checkApiRateLimit(): Promise<void> {
        const now = Date.now();
        const oneSecondAgo = now - 1000;
        this.apiRequestTimestamps = this.apiRequestTimestamps.filter(timestamp => timestamp > oneSecondAgo);

        if (this.apiRequestTimestamps.length >= 1) {
            const oldestTimestamp = Math.min(...this.apiRequestTimestamps);
            const waitTime = 1000 - (now - oldestTimestamp);
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        this.apiRequestTimestamps.push(Date.now());
    }

    public async authenticate(): Promise<void> {
        try {
            await this.checkApiRateLimit();
            this.log('Authenticating...');
            const response = await axios.post(`${this.baseUrl}/sessions`, {
                appId: this.appId,
                apiKey: this.apiKey
            });

            const session = response.data.sessions?.[0];
            this.updateSession(session);
            this.log('Authentication successful');
        } catch (error: any) {
            console.error('Monaco: Authentication error:', error.response?.data || error.message);
            throw error;
        }
    }

    public async ensureAuthenticated(): Promise<void> {
        if (!this.accessToken) {
            await this.authenticate();
        } else if (this.accessExpiresAt && new Date() > this.accessExpiresAt) {
            await this.refreshTokenIfNeeded();
        }
    }

    private async refreshTokenIfNeeded(): Promise<void> {
        if (!this.refreshToken || !this.refreshExpiresAt) {
            await this.authenticate();
            return;
        }

        if (new Date() > this.refreshExpiresAt) {
            await this.authenticate();
            return;
        }

        await this.refreshAccessToken();
    }

    private async refreshAccessToken(): Promise<void> {
        try {
            await this.checkApiRateLimit();
            this.log('Refreshing access token...');
            const response = await axios.post(`${this.baseUrl}/sessions/refresh`, {
                refreshToken: this.refreshToken
            });

            const session = response.data.sessions?.[0];
            if (!session) {
                throw new Error('Token refresh failed: No session returned');
            }
            this.updateSession(session);
            this.log('Access token refreshed successfully');
        } catch (error: any) {
            console.error('Monaco token refresh failed:', error.response?.data || error.message);
            await this.authenticate();
        }
    }

    private tokenRefreshCallbacks: ((token: string) => void)[] = [];

    public onTokenRefreshed(callback: (token: string) => void): void {
        this.tokenRefreshCallbacks.push(callback);
    }

    private notifyTokenRefreshed(token: string): void {
        this.tokenRefreshCallbacks.forEach(cb => cb(token));
    }

    private updateSession(session: MonacoSession): void {
        this.accessToken = session.accessToken;
        this.refreshToken = session.refreshToken;
        this.accessExpiresAt = new Date(session.accessExpiresAt);
        this.refreshExpiresAt = new Date(session.refreshExpiresAt);
        this.scheduleTokenRefresh();
        if (this.accessToken) {
            this.notifyTokenRefreshed(this.accessToken);
        }
    }

    private scheduleTokenRefresh(): void {
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
        }

        if (!this.accessExpiresAt) return;

        const refreshTime = new Date(this.accessExpiresAt.getTime() - (2 * 60 * 1000));
        const now = new Date();
        const delay = Math.max(0, refreshTime.getTime() - now.getTime());

        if (delay > 0) {
            this.tokenRefreshTimeout = setTimeout(async () => {
                try {
                    await this.refreshAccessToken();
                } catch (error) {
                    console.error('Scheduled token refresh failed:', error);
                }
            }, delay);
        } else {
            setImmediate(() => this.refreshAccessToken());
        }
    }

    public async fetchMarkets(page = 0): Promise<any> {
        await this.ensureAuthenticated();
        await this.checkApiRateLimit();

        const response = await axios.get(`${this.baseUrl}/markets`, {
            headers: { 'Authorization': `Bearer ${this.accessToken}` },
            params: {
                marketTypeIds: 'FOOTBALL_OVER_UNDER_TOTAL_GOALS,FOOTBALL_FULL_TIME_RESULT_HANDICAP,FOOTBALL_FULL_TIME_RESULT',
                inPlayStatuses: 'PrePlay,NotApplicable',
                statuses: 'Initializing,Open,Locked,Closed',
                size: 2000,
                page
            }
        });

        return response.data;
    }

    public async fetchAllMarkets(): Promise<{ markets: MonacoMarket[]; events: any[]; eventGroups: any[] }> {
        const allMarkets: MonacoMarket[] = [];
        const allEvents: any[] = [];
        const allEventGroups: any[] = [];
        let page = 0;

        while (true) {
            const data = await this.fetchMarkets(page);
            allMarkets.push(...data.markets);
            allEvents.push(...(data.events || []));
            allEventGroups.push(...(data.eventGroups || []));

            if (data.markets.length < 2000) break;
            page++;
        }

        return { markets: allMarkets, events: allEvents, eventGroups: allEventGroups };
    }

    public stop(): void {
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
            this.tokenRefreshTimeout = null;
        }
    }
}
