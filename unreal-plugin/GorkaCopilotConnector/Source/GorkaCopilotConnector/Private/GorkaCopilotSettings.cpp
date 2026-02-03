// Copyright Gorka Copilot Team. All Rights Reserved.

#include "GorkaCopilotSettings.h"

UGorkaCopilotSettings::UGorkaCopilotSettings()
	: ServerHost(TEXT("127.0.0.1"))
	, ServerPort(9876)
	, bAutoConnect(true)
	, bAutoReconnect(true)
	, MaxReconnectAttempts(10)
	, LogBufferSize(200)
	, bCaptureWarnings(true)
	, bCaptureVerbose(false)
	, bStreamLogs(true)
{
}

FString UGorkaCopilotSettings::GetWebSocketURL() const
{
	return FString::Printf(TEXT("ws://%s:%d"), *ServerHost, ServerPort);
}
