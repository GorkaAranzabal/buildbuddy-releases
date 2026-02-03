// Copyright Gorka Copilot Team. All Rights Reserved.

#include "GorkaCopilotConnector.h"
#include "GorkaCopilotSettings.h"
#include "LogCapture.h"
#include "ErrorParser.h"
#include "WebSocketClient.h"
#include "Modules/ModuleManager.h"

#define LOCTEXT_NAMESPACE "FGorkaCopilotConnectorModule"

void FGorkaCopilotConnectorModule::StartupModule()
{
	// Get settings
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();

	// Create log output device
	LogOutputDevice = MakeShared<FGorkaLogOutputDevice>();
	LogOutputDevice->Initialize();

	// Create error parser
	ErrorParser = MakeShared<FGorkaErrorParser>();

	// Create WebSocket client
	WebSocketClient = MakeShared<FGorkaWebSocketClient>();
	WebSocketClient->Initialize(Settings->GetWebSocketURL());

	// Connect log capture to error parser
	LogOutputDevice->OnLogEntryCaptured.AddLambda([this](const FGorkaLogEntry& Entry)
	{
		if (ErrorParser.IsValid())
		{
			ErrorParser->ProcessLogEntry(Entry);
		}

		// Send log entry if streaming is enabled
		const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
		if (Settings->bStreamLogs && WebSocketClient.IsValid() && WebSocketClient->IsConnected())
		{
			WebSocketClient->SendLogEntry(Entry);
		}
	});

	// Connect error parser to WebSocket client
	ErrorParser->OnErrorBlockDetected.AddLambda([this](const FGorkaErrorBlock& ErrorBlock)
	{
		if (WebSocketClient.IsValid() && WebSocketClient->IsConnected())
		{
			WebSocketClient->SendErrorBlock(ErrorBlock);
		}
	});

	// Auto-connect if enabled
	if (Settings->bAutoConnect)
	{
		WebSocketClient->Connect();
	}

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot Connector module started"));
}

void FGorkaCopilotConnectorModule::ShutdownModule()
{
	// Shutdown WebSocket client
	if (WebSocketClient.IsValid())
	{
		WebSocketClient->Shutdown();
		WebSocketClient.Reset();
	}

	// Shutdown log output device
	if (LogOutputDevice.IsValid())
	{
		LogOutputDevice->Shutdown();
		LogOutputDevice.Reset();
	}

	// Clear error parser
	ErrorParser.Reset();

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot Connector module shut down"));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FGorkaCopilotConnectorModule, GorkaCopilotConnector)
