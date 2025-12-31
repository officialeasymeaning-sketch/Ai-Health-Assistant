export enum AppMode {
  STANDARD = 'STANDARD',
  LIVE = 'LIVE'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text?: string;
  image?: string;
  suggestions?: string[];
}

export interface HealthMetric {
  name: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
}