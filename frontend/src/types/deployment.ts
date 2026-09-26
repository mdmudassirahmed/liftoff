// Deployment Types

export type DeploymentMode = 'Incremental' | 'Complete';
export type DeploymentStatusType = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type ResourceStatusType = 'pending' | 'creating' | 'created' | 'updating' | 'updated' | 'deleting' | 'deleted' | 'failed';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface DeploymentConfig {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  deploymentName: string;
  template: {
    code: string;
    format: 'bicep' | 'arm';
  };
  parameters?: Record<string, unknown>;
  options?: DeploymentOptions;
}

export interface DeploymentOptions {
  mode: DeploymentMode;
  whatIf: boolean;
  rollbackOnError?: boolean;
  debugSetting?: 'RequestContent' | 'ResponseContent' | 'All' | 'None';
}

export interface DeploymentStartResponse {
  deploymentId: string;
  status: 'accepted';
  armDeploymentName: string;
  trackingUrl: string;
}

export interface DeploymentStatus {
  deploymentId: string;
  status: DeploymentStatusType;
  progress: number;
  resources: ResourceStatus[];
  startTime: string;
  endTime?: string;
  duration?: number;
  error?: DeploymentError;
  correlationId?: string;
}

export interface ResourceStatus {
  name: string;
  type: string;
  status: ResourceStatusType;
  provisioningState?: string;
  error?: ResourceError;
  timestamp?: string;
}

export interface DeploymentError {
  code: string;
  message: string;
  target?: string;
  details?: DeploymentError[];
}

export interface ResourceError {
  code: string;
  message: string;
}

export interface DeploymentLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  resourceName?: string;
  resourceType?: string;
  operationId?: string;
}

export interface DeploymentLogsResponse {
  logs: DeploymentLog[];
  continuationToken?: string;
}

// WebSocket Event Types
export type WebSocketEventType = 
  | 'status'
  | 'log'
  | 'resource'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'error';

export interface WebSocketEvent {
  type: WebSocketEventType;
  timestamp: string;
}

export interface StatusEvent extends WebSocketEvent {
  type: 'status';
  status: DeploymentStatusType;
  progress: number;
}

export interface LogEvent extends WebSocketEvent {
  type: 'log';
  level: LogLevel;
  message: string;
}

export interface ResourceEvent extends WebSocketEvent {
  type: 'resource';
  name: string;
  resourceType: string;
  status: ResourceStatusType;
}

export interface ProgressEvent extends WebSocketEvent {
  type: 'progress';
  progress: number;
  currentResource?: string;
}

export interface CompletedEvent extends WebSocketEvent {
  type: 'completed';
  status: 'succeeded';
  duration: number;
  outputs?: Record<string, unknown>;
}

export interface FailedEvent extends WebSocketEvent {
  type: 'failed';
  status: 'failed';
  error: DeploymentError;
}

export type DeploymentWebSocketEvent = 
  | StatusEvent
  | LogEvent
  | ResourceEvent
  | ProgressEvent
  | CompletedEvent
  | FailedEvent;

// Auth Types
export interface AzureAuthConfig {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  scopes: string[];
}

export interface AzureTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  tokenType: string;
  scope: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  expiresAt: number | null;
  user: AzureUser | null;
  subscriptions: AzureSubscriptionInfo[];
}

export interface AzureUser {
  id: string;
  displayName: string;
  email: string;
  tenantId: string;
}

export interface AzureSubscriptionInfo {
  id: string;
  subscriptionId: string;
  displayName: string;
  tenantId: string;
  state: string;
}

// Deployment Store State
export interface DeploymentState {
  deploymentId: string | null;
  status: DeploymentStatusType;
  progress: number;
  logs: DeploymentLog[];
  resources: ResourceStatus[];
  error: DeploymentError | null;
  startTime: string | null;
  endTime: string | null;
}
