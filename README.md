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

### Unreal Engine Plugin

1. Copy `unreal-plugin/GorkaCopilotConnector` to your project's `Plugins` folder
2. Regenerate project files
3. Build and run your project
4. The plugin auto-connects to the overlay app on port 9876

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
└── unreal-plugin/      # UE5 connector plugin
    └── GorkaCopilotConnector/
```

## Development

### Requirements

- Node.js 20+
- npm 10+ or yarn 4+
- Unreal Engine 5.3+ (for plugin development)

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
