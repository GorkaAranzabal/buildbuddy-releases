import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  ConnectorClient,
  ConnectorEvent,
  ConnectionStatus,
  ContextSnapshotEvent,
  ErrorBlockEvent,
  LogEntryEvent,
  ProjectInfoEvent,
  UnrealContext,
} from '../../shared/types';

type StatusChangeCallback = (status: ConnectionStatus, client: ConnectorClient | null) => void;
type ContextUpdateCallback = (context: UnrealContext) => void;

export class WebSocketServer {
  private server: WSServer | null = null;
  private clients: Map<string, { ws: WebSocket; client: ConnectorClient }> = new Map();
  private port: number = 9876;

  private statusChangeCallbacks: StatusChangeCallback[] = [];
  private contextUpdateCallbacks: ContextUpdateCallback[] = [];

  // Current context state
  private currentContext: UnrealContext = {
    projectInfo: null,
    recentLogs: [],
    lastError: null,
    lastUpdate: 0,
  };

  // Log buffer
  private readonly MAX_LOG_BUFFER = 200;

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = new WSServer({ port: this.port, host: '127.0.0.1' });

        this.server.on('listening', () => {
          console.log(`WebSocket server listening on ws://127.0.0.1:${this.port}`);
          resolve();
        });

        this.server.on('connection', (ws) => {
          this.handleConnection(ws);
        });

        this.server.on('error', (error) => {
          console.error('WebSocket server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all client connections
        for (const { ws } of this.clients.values()) {
          ws.close();
        }
        this.clients.clear();

        this.server.close(() => {
          console.log('WebSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();

    const client: ConnectorClient = {
      id: clientId,
      engine: 'unreal', // Default, will be updated with project_info
      connected: true,
      lastHeartbeat: Date.now(),
      projectInfo: null,
    };

    this.clients.set(clientId, { ws, client });

    console.log(`Client connected: ${clientId}`);

    // Send connection acknowledgment
    this.sendToClient(ws, {
      type: 'connection_ack',
      server_version: '1.0.0',
    });

    // Notify status change
    this.notifyStatusChange('connected', client);

    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ConnectorEvent;
        this.handleMessage(clientId, message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    // Handle close
    ws.on('close', () => {
      console.log(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);

      // Notify status change
      const remainingClients = this.getConnectedClients();
      this.notifyStatusChange(
        remainingClients.length > 0 ? 'connected' : 'disconnected',
        remainingClients[0] || null
      );
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`Client error (${clientId}):`, error);
    });
  }

  private handleMessage(clientId: string, event: ConnectorEvent): void {
    const clientData = this.clients.get(clientId);
    if (!clientData) return;

    const { client } = clientData;

    switch (event.type) {
      case 'project_info':
        this.handleProjectInfo(client, event as ProjectInfoEvent);
        break;

      case 'log_entry':
        this.handleLogEntry(event as LogEntryEvent);
        break;

      case 'error_block':
        this.handleErrorBlock(event as ErrorBlockEvent);
        break;

      case 'context_snapshot':
        this.handleContextSnapshot(event as ContextSnapshotEvent);
        break;

      case 'heartbeat':
        client.lastHeartbeat = Date.now();
        break;

      default:
        console.warn(`Unknown event type: ${event.type}`);
    }
  }

  private handleProjectInfo(client: ConnectorClient, event: ProjectInfoEvent): void {
    client.engine = event.engine;
    client.projectInfo = event;

    this.currentContext = {
      ...this.currentContext,
      projectInfo: event,
      lastUpdate: Date.now(),
    };

    this.notifyContextUpdate();
    this.notifyStatusChange('connected', client);
  }

  private handleLogEntry(event: LogEntryEvent): void {
    // Add to log buffer
    this.currentContext.recentLogs.push(event);

    // Trim buffer if needed
    if (this.currentContext.recentLogs.length > this.MAX_LOG_BUFFER) {
      this.currentContext.recentLogs = this.currentContext.recentLogs.slice(-this.MAX_LOG_BUFFER);
    }

    this.currentContext.lastUpdate = Date.now();
    this.notifyContextUpdate();
  }

  private handleErrorBlock(event: ErrorBlockEvent): void {
    this.currentContext.lastError = event;
    this.currentContext.lastUpdate = Date.now();
    this.notifyContextUpdate();
  }

  private handleContextSnapshot(event: ContextSnapshotEvent): void {
    this.currentContext = {
      projectInfo: event.project_info,
      recentLogs: event.recent_logs,
      lastError: event.last_error,
      lastUpdate: Date.now(),
    };
    this.notifyContextUpdate();
  }

  private sendToClient(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const { ws } of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  requestSnapshot(): void {
    this.broadcast({ type: 'request_snapshot' });
  }

  getConnectedClients(): ConnectorClient[] {
    return Array.from(this.clients.values()).map(({ client }) => client);
  }

  getCurrentContext(): UnrealContext {
    return { ...this.currentContext };
  }

  // Event handlers
  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.push(callback);
  }

  onContextUpdate(callback: ContextUpdateCallback): void {
    this.contextUpdateCallbacks.push(callback);
  }

  private notifyStatusChange(status: ConnectionStatus, client: ConnectorClient | null): void {
    for (const callback of this.statusChangeCallbacks) {
      callback(status, client);
    }
  }

  private notifyContextUpdate(): void {
    for (const callback of this.contextUpdateCallbacks) {
      callback(this.currentContext);
    }
  }
}
