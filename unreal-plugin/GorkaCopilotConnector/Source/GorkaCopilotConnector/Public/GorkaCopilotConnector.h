// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FGorkaCopilotConnectorModule : public IModuleInterface
{
public:
	/** IModuleInterface implementation */
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	/** Handle to the log capture output device */
	TSharedPtr<class FGorkaLogOutputDevice> LogOutputDevice;
	
	/** Handle to the WebSocket client */
	TSharedPtr<class FGorkaWebSocketClient> WebSocketClient;
	
	/** Handle to the error parser */
	TSharedPtr<class FGorkaErrorParser> ErrorParser;
};
