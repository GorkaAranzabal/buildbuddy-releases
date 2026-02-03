// Copyright Gorka Copilot Team. All Rights Reserved.

#include "WebSocketClient.h"
#include "GorkaCopilotSettings.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/App.h"
#include "GenericPlatform/GenericPlatformMisc.h"
#include "Interfaces/IPluginManager.h"
#include "TimerManager.h"

const float FGorkaWebSocketClient::HeartbeatInterval = 5.0f;
const float FGorkaWebSocketClient::ReconnectDelay = 2.0f;

FGorkaWebSocketClient::FGorkaWebSocketClient()
	: bIsConnected(false)
	, ReconnectAttempts(0)
{
}

FGorkaWebSocketClient::~FGorkaWebSocketClient()
{
	Shutdown();
}

void FGorkaWebSocketClient::Initialize(const FString& InServerUrl)
{
	ServerUrl = InServerUrl;

	// Load the WebSockets module
	FModuleManager::Get().LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
}

void FGorkaWebSocketClient::Shutdown()
{
	StopHeartbeat();
	CancelReconnect();
	Disconnect();

	WebSocket.Reset();
}

void FGorkaWebSocketClient::Connect()
{
	if (bIsConnected)
	{
		return;
	}

	if (!WebSocket.IsValid())
	{
		// Create WebSocket
		WebSocket = FWebSocketsModule::Get().CreateWebSocket(ServerUrl, TEXT(""));

		// Bind events
		WebSocket->OnConnected().AddRaw(this, &FGorkaWebSocketClient::OnWebSocketConnected);
		WebSocket->OnConnectionError().AddRaw(this, &FGorkaWebSocketClient::OnWebSocketConnectionError);
		WebSocket->OnClosed().AddRaw(this, &FGorkaWebSocketClient::OnWebSocketClosed);
		WebSocket->OnMessage().AddRaw(this, &FGorkaWebSocketClient::OnWebSocketMessage);
	}

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Connecting to %s"), *ServerUrl);
	WebSocket->Connect();
}

void FGorkaWebSocketClient::Disconnect()
{
	StopHeartbeat();

	if (WebSocket.IsValid() && WebSocket->IsConnected())
	{
		WebSocket->Close();
	}

	bIsConnected = false;
}

bool FGorkaWebSocketClient::IsConnected() const
{
	return bIsConnected && WebSocket.IsValid() && WebSocket->IsConnected();
}

void FGorkaWebSocketClient::SendEvent(const TSharedPtr<FJsonObject>& Event)
{
	if (!IsConnected())
	{
		return;
	}

	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(Event.ToSharedRef(), Writer);

	WebSocket->Send(OutputString);
}

void FGorkaWebSocketClient::SendProjectInfo()
{
	TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();

	Event->SetStringField(TEXT("type"), TEXT("project_info"));
	Event->SetStringField(TEXT("engine"), TEXT("unreal"));
	Event->SetStringField(TEXT("project_name"), FApp::GetProjectName());
	Event->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
	
#if PLATFORM_WINDOWS
	Event->SetStringField(TEXT("platform"), TEXT("Windows"));
#elif PLATFORM_MAC
	Event->SetStringField(TEXT("platform"), TEXT("macOS"));
#elif PLATFORM_LINUX
	Event->SetStringField(TEXT("platform"), TEXT("Linux"));
#else
	Event->SetStringField(TEXT("platform"), TEXT("Unknown"));
#endif

	Event->SetNumberField(TEXT("timestamp"), GetTimestamp());

	SendEvent(Event);
}

void FGorkaWebSocketClient::SendLogEntry(const FGorkaLogEntry& Entry)
{
	TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();

	Event->SetStringField(TEXT("type"), TEXT("log_entry"));
	Event->SetStringField(TEXT("engine"), TEXT("unreal"));
	Event->SetStringField(TEXT("category"), Entry.Category.ToString());
	Event->SetStringField(TEXT("verbosity"), VerbosityToString(Entry.Verbosity));
	Event->SetStringField(TEXT("message"), Entry.Message);
	Event->SetNumberField(TEXT("timestamp"), GetTimestamp());

	SendEvent(Event);
}

void FGorkaWebSocketClient::SendErrorBlock(const FGorkaErrorBlock& ErrorBlock)
{
	TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();

	Event->SetStringField(TEXT("type"), TEXT("error_block"));
	Event->SetStringField(TEXT("engine"), TEXT("unreal"));
	Event->SetStringField(TEXT("error_type"), ErrorTypeToString(ErrorBlock.Type));
	Event->SetStringField(TEXT("raw_block"), ErrorBlock.RawBlock);

	// File paths
	TArray<TSharedPtr<FJsonValue>> FilePathsArray;
	for (const FString& Path : ErrorBlock.FilePaths)
	{
		FilePathsArray.Add(MakeShared<FJsonValueString>(Path));
	}
	Event->SetArrayField(TEXT("file_paths"), FilePathsArray);

	// Asset paths
	TArray<TSharedPtr<FJsonValue>> AssetPathsArray;
	for (const FString& Path : ErrorBlock.AssetPaths)
	{
		AssetPathsArray.Add(MakeShared<FJsonValueString>(Path));
	}
	Event->SetArrayField(TEXT("asset_paths"), AssetPathsArray);

	// Line numbers
	TArray<TSharedPtr<FJsonValue>> LineNumbersArray;
	for (int32 LineNum : ErrorBlock.LineNumbers)
	{
		LineNumbersArray.Add(MakeShared<FJsonValueNumber>(LineNum));
	}
	Event->SetArrayField(TEXT("line_numbers"), LineNumbersArray);

	Event->SetNumberField(TEXT("timestamp"), GetTimestamp());

	SendEvent(Event);
}

void FGorkaWebSocketClient::SendContextSnapshot(const TArray<FGorkaLogEntry>& Logs, const FGorkaErrorBlock* LastError)
{
	TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();

	Event->SetStringField(TEXT("type"), TEXT("context_snapshot"));
	Event->SetStringField(TEXT("engine"), TEXT("unreal"));

	// Project info
	TSharedPtr<FJsonObject> ProjectInfo = MakeShared<FJsonObject>();
	ProjectInfo->SetStringField(TEXT("type"), TEXT("project_info"));
	ProjectInfo->SetStringField(TEXT("engine"), TEXT("unreal"));
	ProjectInfo->SetStringField(TEXT("project_name"), FApp::GetProjectName());
	ProjectInfo->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
#if PLATFORM_WINDOWS
	ProjectInfo->SetStringField(TEXT("platform"), TEXT("Windows"));
#elif PLATFORM_MAC
	ProjectInfo->SetStringField(TEXT("platform"), TEXT("macOS"));
#else
	ProjectInfo->SetStringField(TEXT("platform"), TEXT("Linux"));
#endif
	Event->SetObjectField(TEXT("project_info"), ProjectInfo);

	// Recent logs
	TArray<TSharedPtr<FJsonValue>> LogsArray;
	for (const FGorkaLogEntry& Entry : Logs)
	{
		TSharedPtr<FJsonObject> LogObj = MakeShared<FJsonObject>();
		LogObj->SetStringField(TEXT("type"), TEXT("log_entry"));
		LogObj->SetStringField(TEXT("engine"), TEXT("unreal"));
		LogObj->SetStringField(TEXT("category"), Entry.Category.ToString());
		LogObj->SetStringField(TEXT("verbosity"), VerbosityToString(Entry.Verbosity));
		LogObj->SetStringField(TEXT("message"), Entry.Message);
		LogObj->SetNumberField(TEXT("timestamp"), Entry.Timestamp.ToUnixTimestamp() * 1000);
		LogsArray.Add(MakeShared<FJsonValueObject>(LogObj));
	}
	Event->SetArrayField(TEXT("recent_logs"), LogsArray);

	// Last error
	if (LastError && !LastError->RawBlock.IsEmpty())
	{
		TSharedPtr<FJsonObject> ErrorObj = MakeShared<FJsonObject>();
		ErrorObj->SetStringField(TEXT("type"), TEXT("error_block"));
		ErrorObj->SetStringField(TEXT("engine"), TEXT("unreal"));
		ErrorObj->SetStringField(TEXT("error_type"), ErrorTypeToString(LastError->Type));
		ErrorObj->SetStringField(TEXT("raw_block"), LastError->RawBlock);

		TArray<TSharedPtr<FJsonValue>> FilePathsArray;
		for (const FString& Path : LastError->FilePaths)
		{
			FilePathsArray.Add(MakeShared<FJsonValueString>(Path));
		}
		ErrorObj->SetArrayField(TEXT("file_paths"), FilePathsArray);

		TArray<TSharedPtr<FJsonValue>> AssetPathsArray;
		for (const FString& Path : LastError->AssetPaths)
		{
			AssetPathsArray.Add(MakeShared<FJsonValueString>(Path));
		}
		ErrorObj->SetArrayField(TEXT("asset_paths"), AssetPathsArray);

		Event->SetObjectField(TEXT("last_error"), ErrorObj);
	}
	else
	{
		Event->SetField(TEXT("last_error"), MakeShared<FJsonValueNull>());
	}

	Event->SetNumberField(TEXT("timestamp"), GetTimestamp());

	SendEvent(Event);
}

void FGorkaWebSocketClient::OnWebSocketConnected()
{
	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Connected to server"));
	bIsConnected = true;
	ReconnectAttempts = 0;

	// Send project info
	SendProjectInfo();

	// Start heartbeat
	StartHeartbeat();

	// Fire event
	OnConnected.Broadcast(true);
}

void FGorkaWebSocketClient::OnWebSocketConnectionError(const FString& Error)
{
	UE_LOG(LogTemp, Warning, TEXT("Gorka Copilot: Connection error: %s"), *Error);
	bIsConnected = false;

	// Schedule reconnect
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
	if (Settings && Settings->bAutoReconnect)
	{
		ScheduleReconnect();
	}

	OnConnected.Broadcast(false);
}

void FGorkaWebSocketClient::OnWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Connection closed (code: %d, reason: %s)"), StatusCode, *Reason);
	bIsConnected = false;
	StopHeartbeat();

	// Schedule reconnect
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
	if (Settings && Settings->bAutoReconnect)
	{
		ScheduleReconnect();
	}
}

void FGorkaWebSocketClient::OnWebSocketMessage(const FString& Message)
{
	TSharedPtr<FJsonObject> JsonObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);

	if (FJsonSerializer::Deserialize(Reader, JsonObject) && JsonObject.IsValid())
	{
		FString Type = JsonObject->GetStringField(TEXT("type"));

		if (Type == TEXT("request_snapshot"))
		{
			// Server is requesting a context snapshot
			// This would be handled by the module to get logs from LogCapture
			UE_LOG(LogTemp, Verbose, TEXT("Gorka Copilot: Snapshot requested"));
		}
		else if (Type == TEXT("connection_ack"))
		{
			FString ServerVersion = JsonObject->GetStringField(TEXT("server_version"));
			UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Server version: %s"), *ServerVersion);
		}
	}

	OnMessageReceived.Broadcast(Message);
}

void FGorkaWebSocketClient::ScheduleReconnect()
{
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
	if (!Settings)
	{
		return;
	}

	if (ReconnectAttempts >= Settings->MaxReconnectAttempts)
	{
		UE_LOG(LogTemp, Warning, TEXT("Gorka Copilot: Max reconnect attempts reached"));
		return;
	}

	ReconnectAttempts++;
	float Delay = ReconnectDelay * FMath::Min(ReconnectAttempts, 5); // Exponential backoff, max 5x

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Scheduling reconnect in %.1f seconds (attempt %d/%d)"),
		Delay, ReconnectAttempts, Settings->MaxReconnectAttempts);

	// Use game thread timer
	if (GEngine && GEngine->GetWorld())
	{
		GEngine->GetWorld()->GetTimerManager().SetTimer(
			ReconnectTimerHandle,
			FTimerDelegate::CreateRaw(this, &FGorkaWebSocketClient::Connect),
			Delay,
			false
		);
	}
}

void FGorkaWebSocketClient::CancelReconnect()
{
	if (GEngine && GEngine->GetWorld())
	{
		GEngine->GetWorld()->GetTimerManager().ClearTimer(ReconnectTimerHandle);
	}
}

void FGorkaWebSocketClient::SendHeartbeat()
{
	if (!IsConnected())
	{
		return;
	}

	TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();
	Event->SetStringField(TEXT("type"), TEXT("heartbeat"));
	Event->SetStringField(TEXT("engine"), TEXT("unreal"));
	Event->SetNumberField(TEXT("uptime_seconds"), FPlatformTime::Seconds());
	Event->SetNumberField(TEXT("timestamp"), GetTimestamp());

	SendEvent(Event);
}

void FGorkaWebSocketClient::StartHeartbeat()
{
	if (GEngine && GEngine->GetWorld())
	{
		GEngine->GetWorld()->GetTimerManager().SetTimer(
			HeartbeatTimerHandle,
			FTimerDelegate::CreateRaw(this, &FGorkaWebSocketClient::SendHeartbeat),
			HeartbeatInterval,
			true  // Looping
		);
	}
}

void FGorkaWebSocketClient::StopHeartbeat()
{
	if (GEngine && GEngine->GetWorld())
	{
		GEngine->GetWorld()->GetTimerManager().ClearTimer(HeartbeatTimerHandle);
	}
}

FString FGorkaWebSocketClient::VerbosityToString(ELogVerbosity::Type Verbosity)
{
	switch (Verbosity)
	{
	case ELogVerbosity::Fatal:
		return TEXT("Fatal");
	case ELogVerbosity::Error:
		return TEXT("Error");
	case ELogVerbosity::Warning:
		return TEXT("Warning");
	case ELogVerbosity::Display:
		return TEXT("Display");
	case ELogVerbosity::Log:
		return TEXT("Log");
	case ELogVerbosity::Verbose:
		return TEXT("Verbose");
	case ELogVerbosity::VeryVerbose:
		return TEXT("VeryVerbose");
	default:
		return TEXT("Unknown");
	}
}

FString FGorkaWebSocketClient::ErrorTypeToString(EGorkaErrorType Type)
{
	switch (Type)
	{
	case EGorkaErrorType::Packaging:
		return TEXT("packaging");
	case EGorkaErrorType::Compile:
		return TEXT("compile");
	case EGorkaErrorType::Runtime:
		return TEXT("runtime");
	case EGorkaErrorType::Blueprint:
		return TEXT("blueprint");
	default:
		return TEXT("unknown");
	}
}

int64 FGorkaWebSocketClient::GetTimestamp()
{
	return FDateTime::UtcNow().ToUnixTimestamp() * 1000;
}
