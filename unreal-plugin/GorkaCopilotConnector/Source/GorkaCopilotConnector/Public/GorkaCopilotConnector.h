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

	/** Get the module instance */
	static FGorkaCopilotConnectorModule& Get()
	{
		return FModuleManager::GetModuleChecked<FGorkaCopilotConnectorModule>("GorkaCopilotConnector");
	}

	/** Check if module is loaded */
	static bool IsAvailable()
	{
		return FModuleManager::Get().IsModuleLoaded("GorkaCopilotConnector");
	}

private:
	/** Handle to the log capture output device */
	TSharedPtr<class FGorkaLogOutputDevice> LogOutputDevice;
	
	/** Handle to the WebSocket client */
	TSharedPtr<class FGorkaWebSocketClient> WebSocketClient;
	
	/** Handle to the error parser */
	TSharedPtr<class FGorkaErrorParser> ErrorParser;

	/** Handle to the command handler */
	TSharedPtr<class FGorkaCommandHandler> CommandHandler;
};
