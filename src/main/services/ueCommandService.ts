/**
 * Service for executing commands in Unreal Engine via WebSocket
 */

import type { UECommandResult, UECommandType } from '../../shared/types';
import { WebSocketServer } from './websocketServer';

export class UECommandService {
  private wsServer: WebSocketServer;

  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
  }

  /**
   * Check if Unreal Engine is connected
   */
  isConnected(): boolean {
    return this.wsServer.isUnrealConnected();
  }

  /**
   * Execute a command in Unreal Engine
   */
  async executeCommand(command: UECommandType, params: Record<string, unknown> = {}): Promise<UECommandResult> {
    if (!this.isConnected()) {
      return {
        type: 'command_result',
        command_id: '',
        success: false,
        error: 'Unreal Engine is not connected. Please make sure the GorkaCopilotConnector plugin is enabled in your UE project.',
      };
    }

    try {
      const result = await this.wsServer.sendCommand(command, params);
      return result;
    } catch (error) {
      return {
        type: 'command_result',
        command_id: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===== Blueprint Commands =====

  async createBlueprint(name: string, parentClass: string = 'Actor', path: string = '/Game/Blueprints'): Promise<UECommandResult> {
    return this.executeCommand('create_blueprint', { name, parent_class: parentClass, path });
  }

  async openBlueprint(assetPath: string): Promise<UECommandResult> {
    return this.executeCommand('open_blueprint', { asset_path: assetPath });
  }

  async addComponentToBlueprint(assetPath: string, componentType: string, componentName: string): Promise<UECommandResult> {
    return this.executeCommand('add_component_to_blueprint', {
      asset_path: assetPath,
      component_type: componentType,
      component_name: componentName,
    });
  }

  async addVariableToBlueprint(assetPath: string, variableName: string, variableType: string, isPublic: boolean = true): Promise<UECommandResult> {
    return this.executeCommand('add_variable_to_blueprint', {
      asset_path: assetPath,
      variable_name: variableName,
      variable_type: variableType,
      is_public: isPublic,
    });
  }

  async compileBlueprint(assetPath: string): Promise<UECommandResult> {
    return this.executeCommand('compile_blueprint', { asset_path: assetPath });
  }

  // ===== C++ Commands =====

  async createCppClass(className: string, parentClass: string = 'Actor', moduleName?: string): Promise<UECommandResult> {
    return this.executeCommand('create_cpp_class', {
      class_name: className,
      parent_class: parentClass,
      module_name: moduleName,
    });
  }

  async openSourceFile(filePath: string, lineNumber: number = 1): Promise<UECommandResult> {
    return this.executeCommand('open_source_file', { file_path: filePath, line_number: lineNumber });
  }

  // ===== Level Commands =====

  async spawnActor(
    actorType: string,
    name?: string,
    location?: { x: number; y: number; z: number },
    rotation?: { pitch: number; yaw: number; roll: number }
  ): Promise<UECommandResult> {
    return this.executeCommand('spawn_actor', {
      actor_type: actorType,
      name,
      location,
      rotation,
    });
  }

  async deleteActor(name: string): Promise<UECommandResult> {
    return this.executeCommand('delete_actor', { name });
  }

  async getLevelActors(): Promise<UECommandResult> {
    return this.executeCommand('get_level_actors', {});
  }

  async selectActor(name: string): Promise<UECommandResult> {
    return this.executeCommand('select_actor', { name });
  }

  // ===== Asset Commands =====

  async getAssets(path: string = '/Game', type?: string): Promise<UECommandResult> {
    return this.executeCommand('get_assets', { path, type });
  }

  async browseToAsset(assetPath: string): Promise<UECommandResult> {
    return this.executeCommand('browse_to_asset', { asset_path: assetPath });
  }

  async deleteAsset(assetPath: string): Promise<UECommandResult> {
    return this.executeCommand('delete_asset', { asset_path: assetPath });
  }

  // ===== Editor Commands =====

  async playInEditor(): Promise<UECommandResult> {
    return this.executeCommand('play_in_editor', {});
  }

  async stopPlayInEditor(): Promise<UECommandResult> {
    return this.executeCommand('stop_play_in_editor', {});
  }

  async saveAll(): Promise<UECommandResult> {
    return this.executeCommand('save_all', {});
  }

  async compileProject(): Promise<UECommandResult> {
    return this.executeCommand('compile_project', {});
  }

  async getProjectInfo(): Promise<UECommandResult> {
    return this.executeCommand('get_project_info', {});
  }

  async executeConsoleCommand(command: string): Promise<UECommandResult> {
    return this.executeCommand('execute_console_command', { command });
  }
}
