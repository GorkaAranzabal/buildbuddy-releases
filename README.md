# Gorka Copilot Overlay

A desktop overlay assistant for Unreal Engine developers providing AI-powered contextual help.

## Features

- **Always-on-top overlay** - Quick access without leaving Unreal Editor
- **AI-powered assistance** - Get help with packaging errors, compile issues, and more
- **Screenshot capture** - Attach screenshots for visual context
- **Real-time Unreal integration** - Automatic log and error capture via WebSocket
- **Local session history** - Review past conversations

## Installation

### Desktop App

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

### Unreal Engine Plugins

**GorkaCopilotConnector** (WebSocket overlay integration):

1. Copy `unreal-plugin/GorkaCopilotConnector` to your project's `Plugins` folder
2. Regenerate project files
3. Build and run your project
4. The plugin auto-connects to the overlay app on port 9876

**UnrealMCP** (Cursor MCP integration for Blueprints, actors, UMG widgets):

1. Copy `unreal-plugin/UnrealMCP` to your project's `Plugins` folder
2. Regenerate project files and build the project
3. The plugin starts a TCP server on port 55557 when the editor loads
4. Requires Unreal Engine 5.5+ and the EditorScriptingUtilities plugin (auto-enabled)

### Cursor MCP Server (Unreal Engine)

The project includes an MCP server that lets Cursor control Unreal Engine via natural language. It provides 30+ tools for actor management, Blueprint creation, node graph editing, UMG widgets, and more.

**Prerequisites:**
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- UnrealMCP plugin installed and enabled in your Unreal project (see above)

**Setup:**
The MCP server is already configured in `.cursor/mcp.json`. Once the UnrealMCP plugin is running in your Unreal Editor, Cursor can connect automatically.

**Available tool categories:**
- **Editor**: spawn/delete actors, set transforms, get/set properties, find actors
- **Blueprints**: create Blueprint classes, add components, set physics, compile
- **Node Graph**: add event/function nodes, connect nodes, add variables
- **UMG Widgets**: create widget blueprints, add buttons/text, bind events
- **Project**: create input mappings

## Configuration

### Desktop App

- Configure AI provider (OpenAI/Anthropic) in Settings > AI Provider
- Set custom hotkeys in Settings > Hotkeys
- Privacy controls in Settings > Privacy

### Unreal Plugin

Edit `Config/DefaultGorkaCopilot.ini` or use Project Settings > Plugins > Gorka Copilot:

```ini
[/Script/GorkaCopilotConnector.GorkaCopilotSettings]
ServerHost=127.0.0.1
ServerPort=9876
bAutoConnect=True
LogBufferSize=200
```

## Hotkeys

| Action | Default Shortcut |
|--------|------------------|
| Toggle Overlay | Cmd/Ctrl+Shift+G |
| Capture Full Screen | Cmd/Ctrl+Shift+1 |
| Capture Window | Cmd/Ctrl+Shift+2 |
| Capture Region | Cmd/Ctrl+Shift+3 |
| Quick Ask | Cmd/Ctrl+Shift+A |

## Project Structure

```
gorka-copilot-overlay/
├── src/
│   ├── main/           # Electron main process
│   │   ├── services/   # WebSocket, AI, storage services
│   │   └── ...
│   ├── renderer/       # React UI
│   │   ├── components/ # UI components
│   │   ├── store/      # Zustand state management
│   │   └── ...
│   └── shared/         # Shared types
├── unreal-plugin/      # UE5 plugins
│   ├── GorkaCopilotConnector/  # WebSocket overlay connector
│   └── UnrealMCP/              # MCP TCP server plugin
└── unreal-mcp/         # Cursor MCP server (Python)
    └── Python/         # FastMCP server + tool modules
```

## Development

### Requirements

- Node.js 20+
- npm 10+ or yarn 4+
- Unreal Engine 5.5+ (for plugin development)
- Python 3.12+ and [uv](https://docs.astral.sh/uv/) (for MCP server)

### Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run package      # Create distribution packages
npm run lint         # Run ESLint
npm run typecheck    # TypeScript type checking
```

## Privacy & Security

- All connector traffic stays on localhost
- API keys are encrypted using OS-level secure storage
- No telemetry or analytics
- Data only sent to AI when you click Ask

## License

MIT License - see LICENSE file for details
