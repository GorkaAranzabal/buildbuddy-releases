// Copyright Gorka Copilot Team. All Rights Reserved.

#include "GorkaCopilotConnector.h"
#include "GorkaCopilotSettings.h"
#include "LogCapture.h"
#include "ErrorParser.h"
#include "WebSocketClient.h"
#include "CommandHandler.h"
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

	// Create command handler
	CommandHandler = MakeShared<FGorkaCommandHandler>();

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

	// Connect WebSocket messages to command handler
	WebSocketClient->OnMessageReceived.AddLambda([this](const FString& Message)
	{
		TSharedPtr<FJsonObject> JsonObject;
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);

		if (FJsonSerializer::Deserialize(Reader, JsonObject) && JsonObject.IsValid())
		{
			FString Type = JsonObject->GetStringField(TEXT("type"));
			
			// Handle commands from desktop app
			if (Type == TEXT("command"))
			{
				if (CommandHandler.IsValid())
				{
					CommandHandler->ProcessCommand(JsonObject);
				}
			}
		}
	});

	// Connect command results to WebSocket
	CommandHandler->OnCommandResult.AddLambda([this](const FString& CommandId, const TSharedPtr<FJsonObject>& Result)
	{
		if (WebSocketClient.IsValid() && WebSocketClient->IsConnected() && Result.IsValid())
		{
			WebSocketClient->SendEvent(Result);
		}
	});

	// Auto-connect if enabled
	if (Settings->bAutoConnect)
	{
		WebSocketClient->Connect();
	}

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot Connector module started (with command handler)"));
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

	// Clear command handler
	CommandHandler.Reset();

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot Connector module shut down"));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FGorkaCopilotConnectorModule, GorkaCopilotConnector)
