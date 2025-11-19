import { MonacoApiClient } from './monaco-api-client';

export type MessageHandler = (message: any) => void;

export class MonacoWebSocketClient {
    private streamUrl: string;
    private apiClient: MonacoApiClient;
    private websocket: any = null;
    private isRunning: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private subscriptionRequestTimestamps: number[] = [];
    private messageHandlers: MessageHandler[] = [];
    private suppressSnapshots: boolean = false;

    constructor(streamUrl: string, apiClient: MonacoApiClient) {
        this.streamUrl = streamUrl;
        this.apiClient = apiClient;

        this.apiClient.onTokenRefreshed((newToken) => {
            this.log('Token refreshed, reconnecting WebSocket...');
            this.connect(true);
        });
    }

    public onMessage(handler: MessageHandler): void {
        this.messageHandlers.push(handler);
    }

    private log(message: string): void {
        const now = new Date();
        const time = now.toTimeString().slice(0, 8);
        console.log(`${time} MonacoWS: ${message}`);
    }

    private async checkSubscriptionRateLimit(): Promise<void> {
        const now = Date.now();
        const sixtySecondsAgo = now - (60 * 1000);
        this.subscriptionRequestTimestamps = this.subscriptionRequestTimestamps.filter(timestamp => timestamp > sixtySecondsAgo);

        if (this.subscriptionRequestTimestamps.length >= 10) {
            const oldestTimestamp = Math.min(...this.subscriptionRequestTimestamps);
            const waitTime = (60 * 1000) - (now - oldestTimestamp);
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        this.subscriptionRequestTimestamps.push(Date.now());
    }

    public async connect(suppressSnapshots: boolean = false): Promise<void> {
        this.isRunning = true;
        this.suppressSnapshots = suppressSnapshots;
        if (this.websocket) {
            this.websocket.removeAllListeners();
            this.websocket.terminate();
            this.websocket = null;
        }

        return new Promise(async (resolve, reject) => {
            try {
                const { default: WebSocket } = await import('ws');
                this.websocket = new WebSocket(this.streamUrl);

                this.websocket.on('open', async () => {
                    this.log('Connected');
                    try {
                        await this.apiClient.ensureAuthenticated();
                        this.websocket!.send(JSON.stringify({
                            action: 'authenticate',
                            accessToken: this.apiClient.getAccessToken()
                        }));
                        this.log('Sent access token');
                    } catch (error) {
                        console.error('Authentication setup failed:', error);
                        this.reconnect();
                    }
                });

                this.websocket.on('message', async (data: Buffer) => {
                    try {
                        const message = JSON.parse(data.toString());

                        if (message.type === 'AuthenticationUpdate') {
                            this.log('Authentication Confirmed');
                            await this.subscribeToUpdates();
                            resolve();
                        } else {
                            if (this.suppressSnapshots && message.updateType === 'SNAPSHOT') {
                                return;
                            }
                            this.messageHandlers.forEach(handler => handler(message));
                        }
                    } catch (error) {
                        console.error('Message error:', error);
                    }
                });

                this.websocket.on('error', (error: any) => {
                    console.error('WebSocket error:', error);
                    if (this.isRunning) {
                        this.reconnect();
                    } else {
                        reject(error);
                    }
                });

                this.websocket.on('close', () => {
                    this.log('Connection closed');
                    if (this.isRunning) {
                        this.reconnect();
                    }
                });

            } catch (error) {
                console.error('Error initiating connection:', error);
                reject(error);
            }
        });
    }

    private async subscribeToUpdates(): Promise<void> {
        if (!this.websocket || this.websocket.readyState !== 1) return;

        const subscriptions = [
            { type: 'MarketPriceUpdate', ids: ['*'] },
            { type: 'MarketStatusUpdate', ids: ['*'] },
            { type: 'EventUpdate', ids: ['*'] }
        ];

        for (const sub of subscriptions) {
            await this.checkSubscriptionRateLimit();
            this.websocket.send(JSON.stringify({
                action: 'subscribe',
                subscriptionType: sub.type,
                subscriptionIds: sub.ids
            }));
            this.log(`Subscribed to ${sub.type} (*)`);
        }
    }



    private reconnect(): void {
        if (this.reconnectTimeout) return;
        if (!this.isRunning) return;

        this.log('Attempting to reconnect in 5 seconds...');
        this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = null;
            try {
                await this.connect();
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.reconnect();
            }
        }, 5000);
    }

    public stop(): void {
        this.isRunning = false;
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

    }
}
