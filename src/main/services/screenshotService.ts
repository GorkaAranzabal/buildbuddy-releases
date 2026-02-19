import { desktopCapturer, screen, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { CaptureResult, RegionSelection } from '../../shared/types';

export class ScreenshotService {
  private tempDir: string;

  constructor() {
    // Create temp directory for screenshots
    this.tempDir = path.join(
      process.platform === 'darwin'
        ? path.join(process.env.HOME || '', 'Library', 'Application Support', 'GorkaCopilot', 'temp')
        : path.join(process.env.APPDATA || '', 'GorkaCopilot', 'temp')
    );

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Find the desktopCapturer source that corresponds to a specific display.
   *
   * Strategy 1: display_id property (Electron 26+) — the HMONITOR handle on Windows
   *   that directly matches display.id. Most reliable when available.
   * Strategy 2: ID-embedded match — parses the numeric part of "screen:N:0".
   *   Reliable on macOS where N matches the Electron display id.
   * Strategy 3: Position-sorted index (Windows fallback) — screen.getAllDisplays()
   *   always puts the primary display first regardless of position, while
   *   desktopCapturer.getSources() on Windows enumerates left-to-right by screen
   *   bounds. Sorting both arrays by x-position gives a consistent mapping.
   * Strategy 4: Raw index fallback.
   */
  private findSourceForDisplay(
    sources: Electron.DesktopCapturerSource[],
    targetDisplay: Electron.Display,
    displayIndex: number
  ): Electron.DesktopCapturerSource {
    // Strategy 1: display_id (Electron 26+, works on both macOS and Windows)
    for (const source of sources) {
      const displayId = (source as any).display_id;
      if (displayId !== undefined && displayId !== '') {
        if (String(displayId) === String(targetDisplay.id)) {
          console.log(`[Screenshot] Matched source ${source.id} to display ${targetDisplay.id} via display_id`);
          return source;
        }
      }
    }

    // Strategy 2: numeric ID embedded in source.id string (macOS)
    for (const source of sources) {
      const parts = source.id.split(':');
      if (parts.length >= 2) {
        const sourceDisplayId = parseInt(parts[1], 10);
        if (sourceDisplayId === targetDisplay.id) {
          console.log(`[Screenshot] Matched source ${source.id} to display ${targetDisplay.id} via source ID`);
          return source;
        }
      }
    }

    // Strategy 3: Windows — sort displays by x-position to match desktopCapturer's order
    if (process.platform === 'win32') {
      const allDisplays = screen.getAllDisplays();
      const sortedDisplays = [...allDisplays].sort((a, b) =>
        a.bounds.x !== b.bounds.x ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y
      );
      const positionIndex = sortedDisplays.findIndex(d => d.id === targetDisplay.id);
      if (positionIndex >= 0 && positionIndex < sources.length) {
        console.log(`[Screenshot] Windows: position-sorted index ${positionIndex} for display at x=${targetDisplay.bounds.x}`);
        return sources[positionIndex] ?? sources[0];
      }
    }

    // Strategy 4: raw index fallback (macOS when strategies 1 & 2 both miss)
    console.log(`[Screenshot] Fallback to display index ${displayIndex}`);
    return sources[displayIndex] ?? sources[0];
  }

  async captureFullScreen(targetDisplayId?: number): Promise<CaptureResult> {
    // Get all displays and find the target
    const allDisplays = screen.getAllDisplays();
    let targetDisplay = screen.getPrimaryDisplay();
    let displayIndex = 0;
    
    if (targetDisplayId !== undefined) {
      const foundDisplay = allDisplays.find(d => d.id === targetDisplayId);
      if (foundDisplay) {
        targetDisplay = foundDisplay;
        displayIndex = allDisplays.indexOf(foundDisplay);
      }
    }
    
    const displayBounds = targetDisplay.bounds;
    const scaleFactor = targetDisplay.scaleFactor || 1;
    console.log(`Capturing display ${displayIndex} (ID: ${targetDisplay.id}), size: ${targetDisplay.size.width}x${targetDisplay.size.height}, bounds: x=${displayBounds.x}, y=${displayBounds.y}, scaleFactor: ${scaleFactor}`);

    // Request screenshot at the display's LOGICAL size (bounds), not physical pixels
    // This ensures coordinates in the screenshot match macOS coordinate system
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { 
        width: displayBounds.width, 
        height: displayBounds.height 
      },
    });
    console.log(`Requested thumbnail at ${displayBounds.width}x${displayBounds.height}`);
    
    console.log(`Found ${sources.length} screen sources:`, sources.map(s => s.id));

    if (sources.length === 0) {
      throw new Error('No screen sources found');
    }

    const targetSource = this.findSourceForDisplay(sources, targetDisplay, displayIndex);
    console.log(`Using source: ${targetSource.id} (${targetSource.name})`);

    const thumbnail = targetSource.thumbnail;
    
    if (!thumbnail || thumbnail.isEmpty()) {
      console.error('Thumbnail is empty! Trying first available source...');
      // Fallback: try each source until we get a valid thumbnail
      for (const source of sources) {
        if (source.thumbnail && !source.thumbnail.isEmpty()) {
          console.log(`Fallback to source: ${source.id}`);
          const fallbackThumbnail = source.thumbnail;
          const pngData = fallbackThumbnail.toPNG();
          const id = uuidv4();
          const imagePath = path.join(this.tempDir, `${id}.png`);
          fs.writeFileSync(imagePath, pngData);
          
          return {
            id,
            mode: 'fullscreen',
            timestamp: Date.now(),
            imagePath,
            imageBase64: pngData.toString('base64'),
            dimensions: {
              width: fallbackThumbnail.getSize().width,
              height: fallbackThumbnail.getSize().height,
            },
            displayBounds: {
              x: displayBounds.x,
              y: displayBounds.y,
              width: displayBounds.width,
              height: displayBounds.height,
            },
            scaleFactor,
          };
        }
      }
      throw new Error('All screen thumbnails are empty');
    }

    const id = uuidv4();
    const imagePath = path.join(this.tempDir, `${id}.png`);
    const pngData = thumbnail.toPNG();
    
    console.log(`Screenshot captured: ${pngData.length} bytes, ${thumbnail.getSize().width}x${thumbnail.getSize().height}`);
    fs.writeFileSync(imagePath, pngData);

    return {
      id,
      mode: 'fullscreen',
      timestamp: Date.now(),
      imagePath,
      imageBase64: pngData.toString('base64'),
      dimensions: {
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      },
      displayBounds: {
        x: displayBounds.x,
        y: displayBounds.y,
        width: displayBounds.width,
        height: displayBounds.height,
      },
      scaleFactor,
    };
  }

  async captureWindow(windowId: string): Promise<CaptureResult> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    const windowSource = sources.find((s) => s.id === windowId);
    if (!windowSource) {
      throw new Error(`Window not found: ${windowId}`);
    }

    const thumbnail = windowSource.thumbnail;
    const id = uuidv4();
    const imagePath = path.join(this.tempDir, `${id}.png`);

    // Save to file
    fs.writeFileSync(imagePath, thumbnail.toPNG());

    return {
      id,
      mode: 'window',
      timestamp: Date.now(),
      imagePath,
      imageBase64: thumbnail.toPNG().toString('base64'),
      dimensions: {
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      },
      windowTitle: windowSource.name,
    };
  }

  async captureRegion(mainWindow: BrowserWindow): Promise<CaptureResult> {
    // First, capture the full screen
    const fullScreenCapture = await this.captureFullScreen();

    // Show region selector window
    const region = await this.showRegionSelector(mainWindow, fullScreenCapture.imageBase64);

    // Crop the image
    const fullImage = nativeImage.createFromPath(fullScreenCapture.imagePath);
    const croppedImage = this.cropImage(fullImage, region);

    const id = uuidv4();
    const imagePath = path.join(this.tempDir, `${id}.png`);

    // Save cropped image
    fs.writeFileSync(imagePath, croppedImage.toPNG());

    // Clean up full screen capture
    if (fs.existsSync(fullScreenCapture.imagePath)) {
      fs.unlinkSync(fullScreenCapture.imagePath);
    }

    return {
      id,
      mode: 'region',
      timestamp: Date.now(),
      imagePath,
      imageBase64: croppedImage.toPNG().toString('base64'),
      dimensions: {
        width: region.width,
        height: region.height,
      },
    };
  }

  private async showRegionSelector(
    mainWindow: BrowserWindow,
    screenshotBase64: string
  ): Promise<RegionSelection> {
    return new Promise((resolve, reject) => {
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.size;

      // Create fullscreen transparent window for region selection
      const selectorWindow = new BrowserWindow({
        width,
        height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      // Hide main window temporarily
      mainWindow.hide();

      // Load region selector HTML
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              width: 100vw;
              height: 100vh;
              overflow: hidden;
              cursor: crosshair;
              position: relative;
            }
            #background {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            #overlay {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.5);
            }
            #selection {
              position: absolute;
              border: 2px solid #3b82f6;
              background: transparent;
              display: none;
            }
            #instructions {
              position: fixed;
              bottom: 20px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(0, 0, 0, 0.8);
              color: white;
              padding: 10px 20px;
              border-radius: 8px;
              font-family: system-ui, sans-serif;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <img id="background" src="data:image/png;base64,${screenshotBase64}" />
          <div id="overlay"></div>
          <div id="selection"></div>
          <div id="instructions">Click and drag to select region. Press ESC to cancel.</div>
          <script>
            const { ipcRenderer } = require('electron');
            
            let startX, startY, isDrawing = false;
            const selection = document.getElementById('selection');
            const overlay = document.getElementById('overlay');
            
            document.addEventListener('mousedown', (e) => {
              isDrawing = true;
              startX = e.clientX;
              startY = e.clientY;
              selection.style.display = 'block';
              selection.style.left = startX + 'px';
              selection.style.top = startY + 'px';
              selection.style.width = '0px';
              selection.style.height = '0px';
            });
            
            document.addEventListener('mousemove', (e) => {
              if (!isDrawing) return;
              
              const currentX = e.clientX;
              const currentY = e.clientY;
              
              const left = Math.min(startX, currentX);
              const top = Math.min(startY, currentY);
              const width = Math.abs(currentX - startX);
              const height = Math.abs(currentY - startY);
              
              selection.style.left = left + 'px';
              selection.style.top = top + 'px';
              selection.style.width = width + 'px';
              selection.style.height = height + 'px';
              
              // Update overlay clip path
              overlay.style.clipPath = \`polygon(
                0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                \${left}px \${top}px,
                \${left}px \${top + height}px,
                \${left + width}px \${top + height}px,
                \${left + width}px \${top}px,
                \${left}px \${top}px
              )\`;
            });
            
            document.addEventListener('mouseup', (e) => {
              if (!isDrawing) return;
              isDrawing = false;
              
              const currentX = e.clientX;
              const currentY = e.clientY;
              
              const left = Math.min(startX, currentX);
              const top = Math.min(startY, currentY);
              const width = Math.abs(currentX - startX);
              const height = Math.abs(currentY - startY);
              
              if (width > 10 && height > 10) {
                ipcRenderer.send('region-selected', { x: left, y: top, width, height });
              }
            });
            
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                ipcRenderer.send('region-cancelled');
              }
            });
          </script>
        </body>
        </html>
      `;

      selectorWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);

      // Handle region selection
      const { ipcMain } = require('electron');

      const handleRegionSelected = (_event: Electron.IpcMainEvent, region: RegionSelection) => {
        ipcMain.removeListener('region-selected', handleRegionSelected);
        ipcMain.removeListener('region-cancelled', handleRegionCancelled);
        selectorWindow.close();
        mainWindow.show();
        resolve(region);
      };

      const handleRegionCancelled = () => {
        ipcMain.removeListener('region-selected', handleRegionSelected);
        ipcMain.removeListener('region-cancelled', handleRegionCancelled);
        selectorWindow.close();
        mainWindow.show();
        reject(new Error('Region selection cancelled'));
      };

      ipcMain.on('region-selected', handleRegionSelected);
      ipcMain.on('region-cancelled', handleRegionCancelled);

      selectorWindow.on('closed', () => {
        ipcMain.removeListener('region-selected', handleRegionSelected);
        ipcMain.removeListener('region-cancelled', handleRegionCancelled);
        mainWindow.show();
      });
    });
  }

  private cropImage(
    image: Electron.NativeImage,
    region: RegionSelection
  ): Electron.NativeImage {
    const { x, y, width, height } = region;
    return image.crop({ x, y, width, height });
  }

  async getAvailableWindows(): Promise<Array<{ id: string; name: string; thumbnail: string }>> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 200, height: 150 },
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  }

  clearTempFiles(): void {
    if (fs.existsSync(this.tempDir)) {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    }
  }
}
