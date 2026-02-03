import type { AgentAction, ExecutionProgress, ExecutionStatus } from '../../shared/types';
import { BrowserWindow, systemPreferences } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';

const execAsync = promisify(exec);

// Create require function for ESM context
const require = createRequire(import.meta.url);

// Robot module interface
interface RobotModule {
  moveMouse: (x: number, y: number) => void;
  mouseClick: (button?: string, double?: boolean) => void;
  keyTap: (key: string, modifiers?: string[]) => void;
  typeString: (text: string) => void;
  getMousePos: () => { x: number; y: number };
  getScreenSize: () => { width: number; height: number };
}

// Load robotjs using require (CommonJS module)
let robot: RobotModule | null = null;

function loadRobot(): RobotModule | null {
  if (!robot) {
    try {
      // Use createRequire for native CommonJS module in ESM context
      console.log('[Agent] Loading robotjs...');
      robot = require('@jitsi/robotjs') as RobotModule;
      console.log('[Agent] ✅ Robotjs loaded successfully');
      
      // Test that functions exist
      console.log('[Agent] Available functions:', {
        moveMouse: typeof robot.moveMouse,
        mouseClick: typeof robot.mouseClick,
        keyTap: typeof robot.keyTap,
        typeString: typeof robot.typeString,
      });
    } catch (err) {
      console.error('[Agent] ❌ Failed to load robotjs:', err);
    }
  }
  return robot;
}

// Get the frontmost app name on macOS
async function getFrontmostApp(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
    );
    const appName = stdout.trim();
    console.log('[Agent] 🔍 Current frontmost app:', appName);
    return appName;
  } catch (err) {
    console.error('[Agent] ❌ Failed to get frontmost app:', err);
    return null;
  }
}

// Focus an app by name on macOS
async function focusApp(appName: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  
  console.log(`[Agent] 🎯 Attempting to focus app: "${appName}"`);
  
  try {
    await execAsync(
      `osascript -e 'tell application "${appName}" to activate'`
    );
    // Verify it worked
    await new Promise(r => setTimeout(r, 200));
    const current = await getFrontmostApp();
    const success = current?.toLowerCase().includes(appName.toLowerCase()) || false;
    console.log(`[Agent] ${success ? '✅' : '⚠️'} Focus result: ${current} (expected: ${appName})`);
    return success;
  } catch (err) {
    console.error(`[Agent] ❌ Failed to focus app "${appName}":`, err);
    return false;
  }
}

// Focus app by partial window title on macOS
async function focusWindowByTitle(titleSubstring: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  
  console.log(`[Agent] 🔍 Searching for window containing: "${titleSubstring}"`);
  
  try {
    const script = `
      tell application "System Events"
        set matchedApp to ""
        repeat with proc in (every process whose background only is false)
          try
            repeat with win in (every window of proc)
              if name of win contains "${titleSubstring}" then
                set matchedApp to name of proc
                exit repeat
              end if
            end repeat
          end try
          if matchedApp is not "" then exit repeat
        end repeat
        if matchedApp is not "" then
          tell application matchedApp to activate
          return matchedApp
        else
          return ""
        end if
      end tell
    `;
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const result = stdout.trim();
    console.log(`[Agent] ${result ? '✅' : '⚠️'} Window search result: "${result || 'not found'}"`);
    return result !== '';
  } catch (err) {
    console.error(`[Agent] ❌ Failed to focus window with title "${titleSubstring}":`, err);
    return false;
  }
}

// Safety constraints
const MAX_ACTIONS = 15;
const MAX_RUNTIME_MS = 30000;
const ACTION_DELAY_MS = 150; // Increased delay between actions

export class AgentExecutor {
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private currentStep: number = 0;
  private totalSteps: number = 0;
  private progressCallback: ((progress: ExecutionProgress) => void) | null = null;
  private completedActions: string[] = [];
  private startTime: number = 0;
  private previousApp: string | null = null;
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    console.log('[Agent] Main window set');
  }

  // Call this when user starts planning to remember what app was active
  async rememberPreviousApp(): Promise<void> {
    this.previousApp = await getFrontmostApp();
    console.log('[Agent] 📝 Remembered previous app:', this.previousApp);
  }

  async checkPermissions(): Promise<{ hasPermission: boolean; platform: string }> {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // Use 'true' to prompt macOS to open System Preferences if not granted
      // This also forces macOS to refresh its permission cache
      const hasPermission = systemPreferences.isTrustedAccessibilityClient(true);
      console.log('[Agent] 🔐 Accessibility permission (with prompt):', hasPermission ? 'granted' : 'denied');
      
      if (!hasPermission) {
        // Double-check with false (no prompt) after the prompt
        await new Promise(r => setTimeout(r, 500));
        const recheckPermission = systemPreferences.isTrustedAccessibilityClient(false);
        console.log('[Agent] 🔐 Accessibility permission (recheck):', recheckPermission ? 'granted' : 'denied');
        return { hasPermission: recheckPermission, platform: 'macOS' };
      }
      
      return { hasPermission, platform: 'macOS' };
    }
    
    return { hasPermission: true, platform: platform === 'win32' ? 'Windows' : 'Linux' };
  }

  async requestPermissions(): Promise<boolean> {
    if (process.platform === 'darwin') {
      // This will open System Preferences to the Accessibility pane
      return systemPreferences.isTrustedAccessibilityClient(true);
    }
    return true;
  }

  // Force check - actually try to use robotjs to see if it works
  async testPermissions(): Promise<boolean> {
    console.log('[Agent] 🧪 Testing actual robotjs functionality...');
    try {
      const robotModule = loadRobot();
      if (!robotModule) {
        console.log('[Agent] ❌ Robotjs not loaded');
        return false;
      }
      
      // Try to get mouse position - this should work if we have permission
      const pos = robotModule.getMousePos();
      console.log('[Agent] ✅ Got mouse position:', pos, '- robotjs is working!');
      return true;
    } catch (err) {
      console.error('[Agent] ❌ Robotjs test failed:', err);
      return false;
    }
  }

  setProgressCallback(callback: (progress: ExecutionProgress) => void) {
    this.progressCallback = callback;
  }

  private emitProgress(status: ExecutionStatus, currentAction: AgentAction | null = null, error?: string) {
    const progress: ExecutionProgress = {
      status,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      currentAction,
      error,
      completedActions: [...this.completedActions],
    };
    this.progressCallback?.(progress);
  }

  stop() {
    console.log('[Agent] 🛑 Stop requested');
    this.shouldStop = true;
    this.emitProgress('stopped');
  }

  // Display bounds for coordinate offset (multi-monitor support)
  private displayBounds: { x: number; y: number; width: number; height: number } | null = null;
  // Screenshot dimensions for scaling (screenshot may be smaller than display)
  private screenshotDimensions: { width: number; height: number } | null = null;
  // Display scale factor (e.g., 2 for Retina)
  private scaleFactor: number = 1;

  setDisplayBounds(
    bounds: { x: number; y: number; width: number; height: number } | null, 
    screenshotDimensions?: { width: number; height: number },
    scaleFactor?: number
  ) {
    this.displayBounds = bounds;
    this.screenshotDimensions = screenshotDimensions || null;
    this.scaleFactor = scaleFactor || 1;
    
    console.log('[Agent] 📺 Display bounds set:', bounds);
    console.log('[Agent] 📷 Screenshot dimensions:', screenshotDimensions);
    console.log('[Agent] 🔍 Display scale factor:', this.scaleFactor);
    
    if (bounds && screenshotDimensions) {
      const scaleX = bounds.width / screenshotDimensions.width;
      const scaleY = bounds.height / screenshotDimensions.height;
      console.log(`[Agent] 📐 Screenshot-to-bounds scale: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`);
      console.log(`[Agent] 📝 Coordinate formula: absolute = (AI_coord * ${scaleX.toFixed(3)}) + offset(${bounds?.x}, ${bounds?.y})`);
    }
  }

  async execute(actions: AgentAction[]): Promise<{ success: boolean; error?: string; completedActions: string[] }> {
    console.log('[Agent] ════════════════════════════════════════════════════════════');
    console.log('[Agent] 🚀 EXECUTION START');
    console.log('[Agent] ════════════════════════════════════════════════════════════');
    console.log('[Agent] 📊 COORDINATE SYSTEM INFO:');
    console.log('[Agent]   Display bounds: ', JSON.stringify(this.displayBounds));
    console.log('[Agent]   Screenshot dimensions: ', JSON.stringify(this.screenshotDimensions));
    console.log('[Agent]   Scale factor (physical/logical): ', this.scaleFactor);
    
    // Try to get robotjs info for debug
    const debugRobot = loadRobot();
    if (debugRobot) {
      const robotScreen = debugRobot.getScreenSize();
      const robotMouse = debugRobot.getMousePos();
      console.log('[Agent]   robotjs screen size: ', JSON.stringify(robotScreen));
      console.log('[Agent]   robotjs current mouse: ', JSON.stringify(robotMouse));
      console.log('[Agent]   ');
      console.log('[Agent] 🔍 COORDINATE ANALYSIS:');
      console.log(`[Agent]   Second monitor starts at x=${this.displayBounds?.x}`);
      console.log(`[Agent]   Screenshot is ${this.screenshotDimensions?.width}x${this.screenshotDimensions?.height}`);
      console.log(`[Agent]   Formula: absolute = AI_coord + offset(${this.displayBounds?.x}, ${this.displayBounds?.y})`);
    }
    
    console.log('[Agent] ');
    console.log('[Agent] 📋 ACTIONS TO EXECUTE:', actions.length);
    console.log('[Agent] ', JSON.stringify(actions, null, 2));
    console.log('[Agent] ════════════════════════════════════════════════════════════');

    // Validate action count
    if (actions.length > MAX_ACTIONS) {
      return {
        success: false,
        error: `Too many actions (${actions.length}). Maximum is ${MAX_ACTIONS}.`,
        completedActions: [],
      };
    }

    // Check permissions
    const { hasPermission, platform } = await this.checkPermissions();
    if (!hasPermission) {
      console.log('[Agent] ❌ No accessibility permission!');
      return {
        success: false,
        error: `Accessibility permission required on ${platform}. Please enable it in System Preferences > Security & Privacy > Privacy > Accessibility.`,
        completedActions: [],
      };
    }

    // Load robotjs
    const robotModule = loadRobot();
    if (!robotModule) {
      return {
        success: false,
        error: 'Failed to load automation library. Please restart the app.',
        completedActions: [],
      };
    }

    // Test robotjs is working
    try {
      const screenSize = robotModule.getScreenSize();
      const mousePos = robotModule.getMousePos();
      console.log('[Agent] 📺 Screen size:', screenSize);
      console.log('[Agent] 🖱️ Current mouse position:', mousePos);
    } catch (err) {
      console.error('[Agent] ❌ Robotjs test failed:', err);
    }

    // Initialize state
    this.isRunning = true;
    this.shouldStop = false;
    this.currentStep = 0;
    this.totalSteps = actions.length;
    this.completedActions = [];
    this.startTime = Date.now();

    this.emitProgress('running');

    // Hide BuildBuddy and switch to the previous app
    try {
      if (this.mainWindow) {
        console.log('[Agent] 🙈 Hiding BuildBuddy window...');
        this.mainWindow.hide();
      }
      
      // Wait for window to hide
      await this.delay(200);
      
      // Check what's frontmost now
      const currentFront = await getFrontmostApp();
      console.log('[Agent] After hiding, frontmost app is:', currentFront);
      
      // If BuildBuddy is still frontmost after hiding, use AppleScript to activate the next app
      if (currentFront === 'BuildBuddy' || currentFront === 'Electron') {
        console.log('[Agent] 🔄 BuildBuddy still frontmost, activating next app via AppleScript...');
        
        // Use AppleScript to get and activate the next app (more reliable than CMD+TAB)
        try {
          const script = `
            tell application "System Events"
              set appList to name of every application process whose visible is true and name is not "BuildBuddy" and name is not "Electron"
              if (count of appList) > 0 then
                set targetApp to item 1 of appList
                tell application targetApp to activate
                return targetApp
              end if
            end tell
            return ""
          `;
          const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
          const activatedApp = stdout.trim();
          if (activatedApp) {
            console.log('[Agent] ✅ Activated app:', activatedApp);
          } else {
            console.log('[Agent] ⚠️ No other visible app found');
          }
          await this.delay(300);
        } catch (err) {
          console.error('[Agent] ❌ Failed to activate next app:', err);
        }
      }
      
      // If we know the previous app and it's not BuildBuddy, try to focus it explicitly
      if (this.previousApp && this.previousApp !== 'BuildBuddy' && this.previousApp !== 'Electron') {
        console.log('[Agent] 🎯 Focusing previous app:', this.previousApp);
        const focused = await focusApp(this.previousApp);
        if (focused) {
          console.log('[Agent] ✅ Successfully focused', this.previousApp);
        }
        await this.delay(300);
      }
      
      // Final check of frontmost app
      const finalFront = await getFrontmostApp();
      console.log('[Agent] 📍 Final frontmost app before execution:', finalFront);
      
      // If still BuildBuddy, warn but continue
      if (finalFront === 'BuildBuddy' || finalFront === 'Electron') {
        console.log('[Agent] ⚠️ WARNING: BuildBuddy is still frontmost! Keyboard shortcuts may go to BuildBuddy.');
      }
      
    } catch (err) {
      console.error('[Agent] ❌ Error preparing for execution:', err);
    }

    try {
      for (let i = 0; i < actions.length; i++) {
        // Check stop conditions
        if (this.shouldStop) {
          console.log('[Agent] 🛑 Execution stopped by user');
          this.emitProgress('stopped');
          return { success: false, error: 'Execution stopped by user.', completedActions: this.completedActions };
        }

        // Check timeout
        if (Date.now() - this.startTime > MAX_RUNTIME_MS) {
          console.log('[Agent] ⏱️ Execution timed out');
          this.emitProgress('stopped');
          return { success: false, error: 'Execution timed out (30s limit).', completedActions: this.completedActions };
        }

        const action = actions[i];
        this.currentStep = i + 1;
        console.log(`[Agent] ▶️ Step ${i + 1}/${actions.length}:`, JSON.stringify(action));
        this.emitProgress('running', action);

        try {
          await this.executeAction(robotModule, action);
          this.completedActions.push(this.describeAction(action));
          console.log(`[Agent] ✅ Step ${i + 1} completed`);
          
          // Delay between actions
          await this.delay(ACTION_DELAY_MS);
        } catch (actionError) {
          const errorMsg = actionError instanceof Error ? actionError.message : 'Unknown error';
          console.error(`[Agent] ❌ Step ${i + 1} failed:`, errorMsg);
          this.emitProgress('error', action, errorMsg);
          return { success: false, error: `Failed at step ${i + 1}: ${errorMsg}`, completedActions: this.completedActions };
        }
      }

      console.log('[Agent] 🎉 All actions completed successfully!');
      this.emitProgress('completed');
      return { success: true, completedActions: this.completedActions };
    } finally {
      this.isRunning = false;
      
      // Show BuildBuddy again after execution
      if (this.mainWindow) {
        await this.delay(1000); // Longer delay so user can see result
        console.log('[Agent] 👁️ Showing BuildBuddy window again...');
        this.mainWindow.show();
      }
    }
  }

  private async executeAction(robotModule: RobotModule, action: AgentAction): Promise<void> {
    // Log current state before action
    const currentApp = await getFrontmostApp();
    const mousePos = robotModule.getMousePos();
    console.log(`[Agent] 📍 Before action - Frontmost: "${currentApp}", Mouse: (${mousePos.x}, ${mousePos.y})`);

    switch (action.type) {
      case 'focus_window':
        console.log(`[Agent] 🪟 Focus window containing: "${action.titleIncludes}"`);
        const focused = await focusWindowByTitle(action.titleIncludes);
        if (!focused) {
          console.log('[Agent] ⚠️ Window not found, trying app name...');
          await focusApp(action.titleIncludes);
        }
        await this.delay(500);
        break;

      case 'click':
        {
          // COORDINATE SYSTEM DEBUG
          // robotjs.getScreenSize() returns DIPs (Device Independent Pixels), same as Electron bounds
          // Screenshot is captured at bounds dimensions (also DIPs)
          // So NO scaleFactor division needed - everything is in the same coordinate space!
          
          const offsetX = this.displayBounds?.x || 0;
          const offsetY = this.displayBounds?.y || 0;
          
          // Scale coordinates if screenshot size differs from display bounds (usually 1.0)
          let scaleX = 1;
          let scaleY = 1;
          if (this.displayBounds && this.screenshotDimensions) {
            scaleX = this.displayBounds.width / this.screenshotDimensions.width;
            scaleY = this.displayBounds.height / this.screenshotDimensions.height;
          }
          
          // AI gives coordinates relative to screenshot, scale to display bounds, then add offset
          const scaledX = Math.round(action.x * scaleX);
          const scaledY = Math.round(action.y * scaleY);
          const absoluteX = scaledX + offsetX;
          const absoluteY = scaledY + offsetY;
          
          // Detailed debug logging
          console.log(`[Agent] 🎯 CLICK COORDINATE DEBUG:`);
          console.log(`[Agent]   📍 AI gave: (${action.x}, ${action.y}) in screenshot space`);
          console.log(`[Agent]   📐 Screenshot: ${this.screenshotDimensions?.width}x${this.screenshotDimensions?.height}`);
          console.log(`[Agent]   📺 Display bounds: x=${offsetX}, y=${offsetY}, w=${this.displayBounds?.width}, h=${this.displayBounds?.height}`);
          console.log(`[Agent]   🔢 Scale factors: (${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`);
          console.log(`[Agent]   ➡️ Scaled: (${scaledX}, ${scaledY})`);
          console.log(`[Agent]   ➕ Offset: (${offsetX}, ${offsetY})`);
          console.log(`[Agent]   🎯 FINAL absolute: (${absoluteX}, ${absoluteY})`);
          console.log(`[Agent]   📱 robotjs screen size: ${robotModule.getScreenSize().width}x${robotModule.getScreenSize().height}`);
          console.log(`[Agent]   🖱️ Current mouse before move: (${robotModule.getMousePos().x}, ${robotModule.getMousePos().y})`);
          
          robotModule.moveMouse(absoluteX, absoluteY);
          await this.delay(100);
          
          const posAfterMove = robotModule.getMousePos();
          console.log(`[Agent]   🖱️ Mouse after moveMouse: (${posAfterMove.x}, ${posAfterMove.y})`);
          console.log(`[Agent]   ❓ Did it move correctly? Expected (${absoluteX}, ${absoluteY}), got (${posAfterMove.x}, ${posAfterMove.y})`);
          
          robotModule.mouseClick('left', false);
          console.log('[Agent] ✅ Click executed');
        }
        break;

      case 'double_click':
        {
          const offsetX = this.displayBounds?.x || 0;
          const offsetY = this.displayBounds?.y || 0;
          let scaleX = 1;
          let scaleY = 1;
          if (this.displayBounds && this.screenshotDimensions) {
            scaleX = this.displayBounds.width / this.screenshotDimensions.width;
            scaleY = this.displayBounds.height / this.screenshotDimensions.height;
          }
          const scaledX = Math.round(action.x * scaleX);
          const scaledY = Math.round(action.y * scaleY);
          const absoluteX = scaledX + offsetX;
          const absoluteY = scaledY + offsetY;
          console.log(`[Agent] 👆👆 Double-click: AI(${action.x}, ${action.y}) → scaled(${scaledX}, ${scaledY}) + offset(${offsetX}, ${offsetY}) = absolute(${absoluteX}, ${absoluteY})`);
          robotModule.moveMouse(absoluteX, absoluteY);
          await this.delay(100);
          robotModule.mouseClick('left', true);
          console.log('[Agent] ✅ Double-click executed');
        }
        break;

      case 'right_click':
        {
          const offsetX = this.displayBounds?.x || 0;
          const offsetY = this.displayBounds?.y || 0;
          let scaleX = 1;
          let scaleY = 1;
          if (this.displayBounds && this.screenshotDimensions) {
            scaleX = this.displayBounds.width / this.screenshotDimensions.width;
            scaleY = this.displayBounds.height / this.screenshotDimensions.height;
          }
          const scaledX = Math.round(action.x * scaleX);
          const scaledY = Math.round(action.y * scaleY);
          const absoluteX = scaledX + offsetX;
          const absoluteY = scaledY + offsetY;
          console.log(`[Agent] 👆 Right-click: AI(${action.x}, ${action.y}) → scaled(${scaledX}, ${scaledY}) + offset(${offsetX}, ${offsetY}) = absolute(${absoluteX}, ${absoluteY})`);
          robotModule.moveMouse(absoluteX, absoluteY);
          await this.delay(100);
          robotModule.mouseClick('right', false);
          console.log('[Agent] ✅ Right-click executed');
        }
        break;

      case 'click_element':
        // Use macOS Accessibility API to find and click UI elements by description
        console.log(`[Agent] 🔍 Looking for UI element: "${action.description}"`);
        {
          const elementDesc = action.description.replace(/"/g, '\\"');
          const elementType = action.elementType || 'any';
          
          // AppleScript to find UI element by description/title and click it
          const findAndClickScript = `
            tell application "System Events"
              set frontApp to first application process whose frontmost is true
              set appName to name of frontApp
              
              -- Try to find element by description in the frontmost window
              try
                tell frontApp
                  set allElements to entire contents of window 1
                  repeat with elem in allElements
                    try
                      set elemDesc to description of elem
                      set elemName to name of elem
                      set elemRole to role of elem
                      
                      -- Check if this element matches
                      if elemDesc contains "${elementDesc}" or elemName contains "${elementDesc}" then
                        -- Get position and size
                        set elemPos to position of elem
                        set elemSize to size of elem
                        set clickX to (item 1 of elemPos) + ((item 1 of elemSize) / 2)
                        set clickY to (item 2 of elemPos) + ((item 2 of elemSize) / 2)
                        
                        return "FOUND:" & clickX & "," & clickY & ":" & elemRole & ":" & elemName
                      end if
                    end try
                  end repeat
                end tell
              end try
              
              return "NOT_FOUND"
            end tell
          `;
          
          try {
            const { stdout } = await execAsync(`osascript -e '${findAndClickScript.replace(/'/g, "'\\''")}'`);
            const result = stdout.trim();
            
            if (result.startsWith('FOUND:')) {
              const parts = result.substring(6).split(':');
              const coords = parts[0].split(',');
              const clickX = Math.round(parseFloat(coords[0]));
              const clickY = Math.round(parseFloat(coords[1]));
              const role = parts[1] || 'unknown';
              const name = parts[2] || action.description;
              
              console.log(`[Agent] ✅ Found element: "${name}" (${role}) at (${clickX}, ${clickY})`);
              
              // Click at the element's center
              robotModule.moveMouse(clickX, clickY);
              await this.delay(100);
              robotModule.mouseClick('left', false);
              console.log(`[Agent] ✅ Clicked element at (${clickX}, ${clickY})`);
            } else {
              console.log(`[Agent] ⚠️ Element not found via Accessibility API: "${action.description}"`);
              console.log('[Agent] 💡 Falling back to asking user or trying alternative methods');
              // Could fall back to pixel coordinates if provided, or throw an error
              throw new Error(`Could not find UI element: "${action.description}"`);
            }
          } catch (err) {
            console.error(`[Agent] ❌ Failed to find/click element:`, err);
            throw err;
          }
        }
        break;

      case 'type_text':
        console.log(`[Agent] ⌨️ Type text: "${action.text.substring(0, 50)}..."`);
        robotModule.typeString(action.text);
        console.log('[Agent] ✅ Text typed');
        break;

      case 'key_press':
        console.log(`[Agent] ⌨️ Key press: "${action.keys}"`);
        await this.executeKeyPress(robotModule, action.keys);
        console.log('[Agent] ✅ Key press executed');
        break;

      case 'wait':
        console.log(`[Agent] ⏳ Wait ${action.ms}ms`);
        await this.delay(Math.min(action.ms, 5000));
        break;

      case 'done':
        console.log(`[Agent] 🏁 Done: ${action.reason}`);
        break;

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }

    // Log state after action
    const afterApp = await getFrontmostApp();
    const afterMouse = robotModule.getMousePos();
    console.log(`[Agent] 📍 After action - Frontmost: "${afterApp}", Mouse: (${afterMouse.x}, ${afterMouse.y})`);
  }

  private async executeKeyPress(robotModule: RobotModule, keys: string): Promise<void> {
    // Parse key combinations like "CMD+T", "CTRL+SHIFT+F", "ENTER"
    const isMac = process.platform === 'darwin';
    console.log(`[Agent] 🖥️ Platform: ${isMac ? 'macOS' : 'other'}`);
    
    const parts = keys.toUpperCase().split('+').map(k => k.trim());
    const modifiers: string[] = [];
    let mainKey = '';

    console.log(`[Agent] 🔑 Parsing key combo: "${keys}" -> parts:`, parts);

    for (const part of parts) {
      switch (part) {
        case 'CMD':
        case 'COMMAND':
        case 'META':
          modifiers.push('command');
          break;
        case 'CTRL':
        case 'CONTROL':
          // On Mac, convert CTRL to CMD for common shortcuts
          if (isMac) {
            console.log('[Agent] 🔄 Converting CTRL to CMD for macOS');
            modifiers.push('command');
          } else {
            modifiers.push('control');
          }
          break;
        case 'SHIFT':
          modifiers.push('shift');
          break;
        case 'ALT':
        case 'OPTION':
          modifiers.push('alt');
          break;
        case 'ENTER':
        case 'RETURN':
          mainKey = 'enter';
          break;
        case 'ESC':
        case 'ESCAPE':
          mainKey = 'escape';
          break;
        case 'TAB':
          mainKey = 'tab';
          break;
        case 'SPACE':
          mainKey = 'space';
          break;
        case 'BACKSPACE':
          mainKey = 'backspace';
          break;
        case 'DELETE':
          mainKey = 'delete';
          break;
        case 'UP':
          mainKey = 'up';
          break;
        case 'DOWN':
          mainKey = 'down';
          break;
        case 'LEFT':
          mainKey = 'left';
          break;
        case 'RIGHT':
          mainKey = 'right';
          break;
        default:
          // Single character or F-key
          if (part.length === 1) {
            mainKey = part.toLowerCase();
          } else if (part.match(/^F\d+$/)) {
            mainKey = part.toLowerCase();
          } else {
            mainKey = part.toLowerCase();
          }
      }
    }

    console.log(`[Agent] 🔑 Executing keyTap: key="${mainKey}", modifiers=`, modifiers);
    
    if (mainKey) {
      try {
        robotModule.keyTap(mainKey, modifiers);
        console.log('[Agent] ✅ keyTap completed');
      } catch (err) {
        console.error('[Agent] ❌ keyTap failed:', err);
        throw err;
      }
    } else {
      console.log('[Agent] ⚠️ No main key to press');
    }
  }

  private describeAction(action: AgentAction): string {
    switch (action.type) {
      case 'focus_window':
        return `Focused window containing "${action.titleIncludes}"`;
      case 'click':
        return `Clicked at (${action.x}, ${action.y})`;
      case 'double_click':
        return `Double-clicked at (${action.x}, ${action.y})`;
      case 'right_click':
        return `Right-clicked at (${action.x}, ${action.y})`;
      case 'click_element':
        return `Clicked element: "${action.description}"`;
      case 'type_text':
        return `Typed "${action.text.substring(0, 30)}${action.text.length > 30 ? '...' : ''}"`;
      case 'key_press':
        return `Pressed ${action.keys}`;
      case 'wait':
        return `Waited ${action.ms}ms`;
      case 'done':
        return `Completed: ${action.reason}`;
      default:
        return `Unknown action`;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
